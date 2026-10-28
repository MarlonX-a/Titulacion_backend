import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CorreoSalida } from '../auth/entities/correo-salida.entity.js';
import { CredencialUsuario } from '../auth/entities/credencial-usuario.entity.js';
import { LoteImportacion } from './entities/lote-importacion.entity.js';
import { PreparacionImportacion } from './entities/preparacion-importacion.entity.js';
import { PreparacionImportacionEstado as Estado } from './enums/preparacion-importacion-estado.enum.js';
import { LoteImportacionTipo } from './enums/lote-importacion-tipo.enum.js';
import { ImportacionesDocentesService } from './importaciones-docentes.service.js';

type Row = Record<string, unknown>;

function matches(record: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = record[key];
    if (value !== null && typeof value === 'object') {
      return actual !== null && typeof actual === 'object' && matches(actual as Row, value as Row);
    }
    return actual === value;
  });
}

function memoryRepository(rows: Row[]) {
  return {
    rows,
    create: (value: Row) => ({ ...value }),
    save: async (value: Row) => {
      const stored = { id: value.id ?? randomBytes(8).toString('hex'), creada_en: value.creada_en ?? new Date(), ...value };
      const index = rows.findIndex((row) => row.id === stored.id);
      if (index >= 0) rows[index] = stored; else rows.push(stored);
      Object.assign(value, stored);
      return stored;
    },
    findOne: async (options: { where: Row }) => rows.find((row) => matches(row, options.where)) ?? null,
    update: async (where: Row, values: Row) => { rows.filter((row) => matches(row, where)).forEach((row) => Object.assign(row, values)); },
  };
}

async function teacherWorkbook(rows: unknown[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Docentes');
  ['cedula', 'nombres', 'apellidos', 'email', 'titulo', 'departamento', 'habilitado_tutoria'].forEach((value, index) => { sheet.getCell(1, index + 1).value = value; });
  rows.forEach((values, rowIndex) => values.forEach((value, index) => { sheet.getCell(rowIndex + 2, index + 1).value = value as ExcelJS.CellValue; }));
  return Buffer.from(await book.xlsx.writeBuffer() as ArrayBuffer);
}

function setup(buffer: Buffer) {
  const keyDir = mkdtempSync(join(tmpdir(), 'docentes-import-'));
  const keyPath = join(keyDir, 'outbox.key');
  writeFileSync(keyPath, randomBytes(32));
  const admin = { id: 'admin', email: 'admin@uleam.edu.ec', rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO } as Usuario;
  const repos = new Map<unknown, ReturnType<typeof memoryRepository>>([
    [PreparacionImportacion, memoryRepository([])],
    [Usuario, memoryRepository([])],
    [Docente, memoryRepository([])],
    [CredencialUsuario, memoryRepository([])],
    [CorreoSalida, memoryRepository([])],
    [LoteImportacion, memoryRepository([])],
  ]);
  const manager = { getRepository: (entity: unknown) => repos.get(entity) };
  const dataSource = {
    manager,
    getRepository: (entity: unknown) => repos.get(entity),
    transaction: async (isolation: unknown, callback?: (value: unknown) => Promise<unknown>) =>
      (typeof isolation === 'function' ? isolation : callback!)(manager),
  };
  const storage = { savePrivate: vi.fn().mockResolvedValue('clave'), readPrivate: vi.fn().mockResolvedValue(buffer), removePrivate: vi.fn() };
  const auditoria = { registrar: vi.fn().mockResolvedValue(undefined) };
  const queue = { add: vi.fn().mockResolvedValue(undefined), getJob: vi.fn().mockResolvedValue(undefined) };
  const config = { get: () => keyPath };
  const service = new ImportacionesDocentesService(dataSource as never, storage as never, auditoria as never, config as never, queue as never);
  return { service, repos, admin, auditoria, queue };
}

const ROSA = ['1316661675', 'Rosa', 'Mera', 'rosa@uleam.edu.ec', 'Magíster', 'Sistemas', 'SI'];
const LUIS = ['0102030400', 'Luis', 'Vera', 'luis@live.uleam.edu.ec', 'Ing.', 'Software', 'NO'];

async function prepared(rows: unknown[][]) {
  const buffer = await teacherWorkbook(rows);
  const context = setup(buffer);
  const { id } = await context.service.submit(context.admin, 'docentes.xlsx', buffer, '127.0.0.1');
  await context.service.validateFile(id);
  return { ...context, id };
}

describe('ImportacionesDocentesService', () => {
  it('valida sin período, crea la vista previa y la encola para validar', async () => {
    const { service, repos, id, queue, auditoria } = await prepared([ROSA, LUIS]);
    const record = repos.get(PreparacionImportacion)!.rows[0];
    expect(record).toMatchObject({ periodo: null, tipo: LoteImportacionTipo.DOCENTES, estado: Estado.LISTA });
    expect(queue.add).toHaveBeenCalledWith('validar-docentes', { id }, expect.anything());
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'SOLICITAR_IMPORTACION_DOCENTES' }));
    const summary = await service.get(id);
    expect(summary.vista_previa.map((row) => row.email)).toEqual(['rosa@uleam.edu.ec', 'luis@live.uleam.edu.ec']);
  });

  it('confirma, crea cuenta DOCENTE, perfil, credencial con la cédula y correo ACCESO; omite registros idénticos', async () => {
    const buffer = await teacherWorkbook([ROSA, LUIS]);
    const context = setup(buffer);
    const existingUser = await context.repos.get(Usuario)!.save({ email: 'luis@live.uleam.edu.ec', nombres: 'Luis', apellidos: 'Vera', rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO });
    await context.repos.get(Docente)!.save({ usuario: existingUser, cedula: '0102030400', titulo_academico: 'Ing.', departamento: 'Software', habilitado_tutoria: false });
    await context.repos.get(CredencialUsuario)!.save({ id: 'cred-luis', usuario_id: existingUser.id, requiere_cambio: false });
    const { id } = await context.service.submit(context.admin, 'docentes.xlsx', buffer, null);
    await context.service.validateFile(id);
    await context.service.confirm(id, context.admin, null);
    expect(context.queue.add).toHaveBeenCalledWith('importar-docentes', { id }, expect.anything());
    await context.service.importConfirmed(id);

    const rosa = context.repos.get(Usuario)!.rows.find((row) => row.email === 'rosa@uleam.edu.ec');
    expect(rosa).toMatchObject({ rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO });
    expect(context.repos.get(Docente)!.rows).toHaveLength(2);
    const credentials = context.repos.get(CredencialUsuario)!.rows;
    expect(credentials.find((row) => row.usuario_id === rosa!.id)).toMatchObject({ requiere_cambio: true });
    expect(credentials.find((row) => row.usuario_id === existingUser.id)).toMatchObject({ requiere_cambio: false });
    expect(context.repos.get(CorreoSalida)!.rows).toEqual([expect.objectContaining({ usuario_id: rosa!.id, tipo: 'ACCESO' })]);
    expect(context.repos.get(LoteImportacion)!.rows[0]).toMatchObject({ periodo: null, tipo: LoteImportacionTipo.DOCENTES, filas_ok: 2, estado: 'COMPLETADO' });
    expect(context.repos.get(PreparacionImportacion)!.rows[0]).toMatchObject({ estado: Estado.COMPLETADA });
    expect(context.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'COMPLETAR_IMPORTACION_DOCENTES', valores_nuevos: expect.objectContaining({ docentes_creados: 1, omitidos: 1 }) }));
    await expect(context.service.confirm(id, context.admin, null)).rejects.toBeInstanceOf(ConflictException);
  });

  it('marca como error de fila los conflictos con cuentas o cédulas existentes y no permite confirmar', async () => {
    const buffer = await teacherWorkbook([ROSA, LUIS]);
    const context = setup(buffer);
    await context.repos.get(Usuario)!.save({ email: 'rosa@uleam.edu.ec', nombres: 'Rosa', apellidos: 'Mera', rol: UsuarioRol.ESTUDIANTE, estado: UsuarioEstado.ACTIVO });
    const other = await context.repos.get(Usuario)!.save({ email: 'otro@uleam.edu.ec', nombres: 'Otro', apellidos: 'Docente', rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO });
    await context.repos.get(Docente)!.save({ usuario: other, cedula: '0102030400', titulo_academico: 'Ing.', departamento: 'Software', habilitado_tutoria: false });
    const { id } = await context.service.submit(context.admin, 'docentes.xlsx', buffer, null);
    await context.service.validateFile(id);
    const summary = await context.service.get(id);
    expect(summary.estado).toBe(Estado.INVALIDA);
    expect(summary.errores).toEqual([
      expect.objectContaining({ fila: 2, columna: 'email' }),
      expect.objectContaining({ fila: 3, columna: 'cedula' }),
    ]);
    await expect(context.service.confirm(id, context.admin, null)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza el archivo cuyo hash cambió y responde 404 para preparaciones inexistentes', async () => {
    const buffer = await teacherWorkbook([ROSA]);
    const context = setup(buffer);
    const { id } = await context.service.submit(context.admin, 'docentes.xlsx', buffer, null);
    const record = context.repos.get(PreparacionImportacion)!.rows[0];
    record.sha256 = createHash('sha256').update('otro').digest('hex');
    await context.service.validateFile(id);
    expect(record.estado).toBe(Estado.INVALIDA);
    await expect(context.service.get('no-existe')).rejects.toBeInstanceOf(NotFoundException);
  });
});
