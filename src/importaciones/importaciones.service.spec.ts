import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { AcademicoService } from '../academico/academico.service.js';
import { Carrera } from '../academico/entities/carrera.entity.js';
import { Facultad } from '../academico/entities/facultad.entity.js';
import { CorreoSalida } from '../auth/entities/correo-salida.entity.js';
import { CredencialUsuario } from '../auth/entities/credencial-usuario.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { LoteImportacion } from './entities/lote-importacion.entity.js';
import { PreparacionImportacion } from './entities/preparacion-importacion.entity.js';
import { PreparacionImportacionEstado as Estado } from './enums/preparacion-importacion-estado.enum.js';
import { ImportacionesService } from './importaciones.service.js';

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
    find: async () => rows,
    create: (value: Row) => ({ ...value }),
    save: async (value: Row) => {
      const stored = { id: value.id ?? randomBytes(8).toString('hex'), creada_en: value.creada_en ?? new Date(), ...value };
      const index = rows.findIndex((row) => row.id === stored.id);
      if (index >= 0) rows[index] = stored; else rows.push(stored);
      Object.assign(value, stored);
      return stored;
    },
    findOne: async (options: { where: Row }) => rows.find((row) => matches(row, options.where)) ?? null,
    findOneBy: async (where: Row) => rows.find((row) => matches(row, where)) ?? null,
    update: async (where: Row, values: Row) => { rows.filter((row) => matches(row, where)).forEach((row) => Object.assign(row, values)); },
  };
}

async function studentWorkbook(career: string | null): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Estudiantes');
  sheet.getCell('A1').value = 'LISTA DE ESTUDIANTES QUE PUEDEN ACCEDER AL PROCESO';
  if (career) sheet.getCell('A2').value = career;
  ['#', 'Campus', 'Identificación', 'Apellidos', 'Nombres', 'nivel', 'ACADEMICO', 'INGLES'].forEach((value, index) => { sheet.getCell(6, index + 1).value = value; });
  [1, 'MANTA', '1316661675', 'ZAMBRANO VERA', 'ORLEY ANTONIO', 7, 'SI', 'SI'].forEach((value, index) => { sheet.getCell(7, index + 1).value = value; });
  return Buffer.from(await book.xlsx.writeBuffer() as ArrayBuffer);
}

function setup(buffer: Buffer) {
  const keyDir = mkdtempSync(join(tmpdir(), 'estudiantes-import-'));
  const keyPath = join(keyDir, 'outbox.key');
  writeFileSync(keyPath, randomBytes(32));
  const admin = { id: 'admin', email: 'admin@uleam.edu.ec', rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO } as Usuario;
  const periodo = { id: 'periodo-1', estado: PeriodoEstado.BORRADOR, facultad_id: 'fac-vida' };
  const repos = new Map<unknown, ReturnType<typeof memoryRepository>>([
    [PeriodoTitulacion, memoryRepository([periodo])],
    [PreparacionImportacion, memoryRepository([])],
    [Usuario, memoryRepository([])],
    [Estudiante, memoryRepository([])],
    [EstudianteHabilitado, memoryRepository([])],
    [CredencialUsuario, memoryRepository([])],
    [CorreoSalida, memoryRepository([])],
    [LoteImportacion, memoryRepository([])],
    [Facultad, memoryRepository([
      { id: 'fac-vida', codigo: 'VIDA', nombre: 'Facultad Ciencias de la Vida y Tecnologías' },
      { id: 'fac-salud', codigo: 'SALUD', nombre: 'Facultad Ciencias de la Salud' },
    ])],
    [Carrera, memoryRepository([
      { id: 'car-software', codigo: 'INGENIERIA_EN_SOFTWARE', nombre: 'Ingeniería en Software', facultad_id: 'fac-vida' },
      { id: 'car-medicina', codigo: 'MEDICINA', nombre: 'Medicina', facultad_id: 'fac-salud' },
    ])],
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
  const service = new ImportacionesService(dataSource as never, storage as never, auditoria as never, config as never, queue as never, new AcademicoService());
  return { service, repos, admin, auditoria };
}

describe('ImportacionesService carrera de la importación', () => {
  it('rechaza una carrera de otra facultad al enviar el archivo sin crear la preparación', async () => {
    const buffer = await studentWorkbook('CARRERA SOFTWARE');
    const context = setup(buffer);
    await expect(context.service.submit('periodo-1', context.admin, 'estudiantes.xlsx', buffer, null, 'car-medicina'))
      .rejects.toThrow('La carrera «Medicina» no pertenece a la facultad «Facultad Ciencias de la Vida y Tecnologías» del período.');
    await expect(context.service.submit('periodo-1', context.admin, 'estudiantes.xlsx', buffer, null, 'nope')).rejects.toThrow('No existe la carrera indicada.');
    expect(context.repos.get(PreparacionImportacion)!.rows).toHaveLength(0);
  });

  it.each([
    ['sin celda de carrera', null],
    ['con el marcador de la plantilla', 'CARRERA <NOMBRE>'],
    ['con otra carrera en el título', 'CARRERA MEDICINA'],
  ])('usa solo la carrera elegida e ignora el título del archivo (%s)', async (_caso, career) => {
    const buffer = await studentWorkbook(career);
    const context = setup(buffer);
    const { id } = await context.service.submit('periodo-1', context.admin, 'estudiantes.xlsx', buffer, null, 'car-software');
    expect(context.repos.get(PreparacionImportacion)!.rows[0]).toMatchObject({ carrera_id: 'car-software' });
    expect(context.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'SOLICITAR_IMPORTACION_ESTUDIANTES', valores_nuevos: expect.objectContaining({ carrera_id: 'car-software' }) }));
    await context.service.validateFile(id);
    const summary = await context.service.get('periodo-1', id);
    expect(summary.estado).toBe(Estado.LISTA);
    expect(summary.errores).toEqual([]);
    await context.service.confirm('periodo-1', id, context.admin, null);
    await context.service.importConfirmed(id);
    expect(context.repos.get(Estudiante)!.rows).toEqual([expect.objectContaining({ cedula: '1316661675', carrera_id: 'car-software' })]);
  });

  it('marca como error la fila de un estudiante existente de otra carrera', async () => {
    const buffer = await studentWorkbook(null);
    const context = setup(buffer);
    const user = await context.repos.get(Usuario)!.save({ email: 'e1316661675@live.uleam.edu.ec', nombres: 'ORLEY ANTONIO', apellidos: 'ZAMBRANO VERA', rol: UsuarioRol.ESTUDIANTE, estado: UsuarioEstado.ACTIVO });
    await context.repos.get(Estudiante)!.save({ usuario: user, cedula: '1316661675', matricula: '1316661675', carrera_id: 'car-medicina', nivel: 7 });
    const { id } = await context.service.submit('periodo-1', context.admin, 'estudiantes.xlsx', buffer, null, 'car-software');
    await context.service.validateFile(id);
    const summary = await context.service.get('periodo-1', id);
    expect(summary.estado).toBe(Estado.INVALIDA);
    expect(summary.errores).toEqual([expect.objectContaining({ fila: 7 })]);
  });
});
