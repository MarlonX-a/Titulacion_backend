import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { importacionesHarness, memoryRepository, type MemoryRepository } from '../../test/support/importaciones-harness.js';
import { Carrera } from '../academico/entities/carrera.entity.js';
import { Facultad } from '../academico/entities/facultad.entity.js';
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

async function teacherWorkbook(rows: unknown[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Tutores');
  ['DOCENTES', 'Tipo', 'CARRERA'].forEach((value, index) => { sheet.getCell(1, index + 1).value = value; });
  rows.forEach((values, rowIndex) => values.forEach((value, index) => { sheet.getCell(rowIndex + 2, index + 1).value = value as ExcelJS.CellValue; }));
  return Buffer.from(await book.xlsx.writeBuffer() as ArrayBuffer);
}

function setup(buffer: Buffer) {
  const repos = new Map<unknown, MemoryRepository>([
    [PreparacionImportacion, memoryRepository([])],
    [Usuario, memoryRepository([])],
    [Docente, memoryRepository([])],
    [CredencialUsuario, memoryRepository([])],
    [CorreoSalida, memoryRepository([])],
    [LoteImportacion, memoryRepository([])],
    [Facultad, memoryRepository([{ id: 'fac-1', codigo: 'FAC', nombre: 'Facultad' }])],
    [Carrera, memoryRepository([{ id: 'car-1', codigo: 'SOFTWARE', nombre: 'Ingeniería en Software', facultad_id: 'fac-1' }, { id: 'car-2', codigo: 'SISTEMAS', nombre: 'Ingeniería en Sistemas', facultad_id: 'fac-1' }])],
  ]);
  const harness = importacionesHarness(repos, buffer, 'docentes-import-');
  return { service: new ImportacionesDocentesService(...harness.args), repos, admin: harness.admin, auditoria: harness.auditoria, queue: harness.queue };
}


const EDISON = ['ALMEIDA ZAMBRANO EDISON ERNESTO', 'Nombramiento', 'SOFTWARE'];
const GABRIELA = ['VELASQUEZ MOREIRA GABRIELA MAHOLY', 'Contratos', 'SOFTWARE'];
const JOFFRE = ['PANCHANA FLORES JOFFRE EDGARDO', null, 'SOFTWARE'];
const EDISON_EMAIL = 'edison.almeida@live.uleam.edu.ec';
const GABRIELA_EMAIL = 'gabriela.velasquez@live.uleam.edu.ec';

async function prepared(rows: unknown[][]) {
  const buffer = await teacherWorkbook(rows);
  const context = setup(buffer);
  const { id } = await context.service.submit(context.admin, 'docentes.xlsx', buffer, '127.0.0.1', 'car-1');
  await context.service.validateFile(id);
  return { ...context, id };
}

describe('ImportacionesDocentesService', () => {
  it('valida sin período, deduplica y expone advertencias no bloqueantes en la vista previa', async () => {
    const { service, repos, id, queue, auditoria } = await prepared([EDISON, GABRIELA, JOFFRE, EDISON]);
    const record = repos.get(PreparacionImportacion)!.rows[0];
    expect(record).toMatchObject({ periodo: null, tipo: LoteImportacionTipo.DOCENTES, estado: Estado.LISTA });
    expect(queue.add).toHaveBeenCalledWith('validar-docentes', { id }, expect.anything());
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'SOLICITAR_IMPORTACION_DOCENTES' }));
    const summary = await service.get(id);
    expect(summary.vista_previa.map((row) => row.email)).toEqual([EDISON_EMAIL, GABRIELA_EMAIL, 'joffre.panchana@live.uleam.edu.ec']);
    expect(summary.errores).toEqual([]);
    expect(summary.advertencias).toEqual([expect.objectContaining({ fila: 4, columna: 'Tipo' })]);
  });

  it('confirma: crea cuenta, perfil sin cédula, credencial aleatoria y correo ACCESO; actualiza u omite docentes existentes', async () => {
    const buffer = await teacherWorkbook([EDISON, GABRIELA, JOFFRE]);
    const context = setup(buffer);
    const users = context.repos.get(Usuario)!;
    const gabriela = await users.save({ email: GABRIELA_EMAIL, nombres: 'GABRIELA  maholy', apellidos: 'Velásquez Moreira', rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO });
    await context.repos.get(Docente)!.save({ id: 'doc-gabriela', usuario: gabriela, cedula: '0102030400', titulo_academico: 'Ing.', carrera_id: 'car-1', habilitado_tutoria: true });
    await context.repos.get(CredencialUsuario)!.save({ id: 'cred-gabriela', usuario_id: gabriela.id, requiere_cambio: false });
    const joffre = await users.save({ email: 'joffre.panchana@live.uleam.edu.ec', nombres: 'Joffre Edgardo', apellidos: 'Panchana Flores', rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO });
    await context.repos.get(Docente)!.save({ id: 'doc-joffre', usuario: joffre, cedula: null, titulo_academico: null, carrera_id: 'car-1', habilitado_tutoria: false });
    await context.repos.get(CredencialUsuario)!.save({ id: 'cred-joffre', usuario_id: joffre.id, requiere_cambio: false });
    const { id } = await context.service.submit(context.admin, 'docentes.xlsx', buffer, null, 'car-1');
    await context.service.validateFile(id);
    await context.service.confirm(id, context.admin, null);
    expect(context.queue.add).toHaveBeenCalledWith('importar-docentes', { id }, expect.anything());
    await context.service.importConfirmed(id);

    const edison = users.rows.find((row) => row.email === EDISON_EMAIL);
    expect(edison).toMatchObject({ nombres: 'Edison Ernesto', apellidos: 'Almeida Zambrano', rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO });
    const teachers = context.repos.get(Docente)!.rows;
    expect(teachers).toHaveLength(3);
    expect(teachers.find((row) => (row.usuario as Usuario).id === edison!.id)).toMatchObject({ cedula: null, titulo_academico: null, carrera_id: 'car-1', habilitado_tutoria: true });
    expect(teachers.find((row) => row.id === 'doc-gabriela')).toMatchObject({ cedula: '0102030400', habilitado_tutoria: false });
    expect(gabriela).toMatchObject({ nombres: 'GABRIELA  maholy', apellidos: 'Velásquez Moreira' });
    const credentials = context.repos.get(CredencialUsuario)!.rows;
    const edisonCredential = credentials.find((row) => row.usuario_id === edison!.id);
    expect(edisonCredential).toMatchObject({ requiere_cambio: true, password_hash: expect.stringMatching(/^\$argon2id\$/) });
    expect(context.repos.get(CorreoSalida)!.rows).toEqual([expect.objectContaining({ usuario_id: edison!.id, tipo: 'ACCESO' })]);
    expect(context.repos.get(LoteImportacion)!.rows[0]).toMatchObject({ periodo: null, tipo: LoteImportacionTipo.DOCENTES, filas_ok: 3, estado: 'COMPLETADO' });
    expect(context.repos.get(PreparacionImportacion)!.rows[0]).toMatchObject({ estado: Estado.COMPLETADA });
    expect(context.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'IMPORTAR_DOCENTE', entidad_tipo: 'docente' }));
    expect(context.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'ACTUALIZAR_DOCENTE_IMPORTACION', entidad_id: 'doc-gabriela', valores_anteriores: { habilitado_tutoria: true } }));
    expect(context.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'COMPLETAR_IMPORTACION_DOCENTES', valores_nuevos: expect.objectContaining({ docentes_creados: 1, docentes_actualizados: 1, omitidos: 1 }) }));
    await expect(context.service.confirm(id, context.admin, null)).rejects.toBeInstanceOf(ConflictException);
  });

  it('marca como error de fila el correo generado que pertenece a una cuenta con otro rol y no permite confirmar', async () => {
    const buffer = await teacherWorkbook([EDISON, GABRIELA]);
    const context = setup(buffer);
    await context.repos.get(Usuario)!.save({ email: EDISON_EMAIL, nombres: 'Edison', apellidos: 'Almeida', rol: UsuarioRol.ESTUDIANTE, estado: UsuarioEstado.ACTIVO });
    const { id } = await context.service.submit(context.admin, 'docentes.xlsx', buffer, null, 'car-1');
    await context.service.validateFile(id);
    const summary = await context.service.get(id);
    expect(summary.estado).toBe(Estado.INVALIDA);
    expect(summary.errores).toEqual([expect.objectContaining({ fila: 2, columna: 'DOCENTES', mensaje: expect.stringContaining('ESTUDIANTE') })]);
    await expect(context.service.confirm(id, context.admin, null)).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    ['otro docente con el mismo correo', { nombres: 'Gabriela Alexandra', apellidos: 'Velásquez Mendoza', estado: UsuarioEstado.ACTIVO }, 'ya pertenece a otro docente (Gabriela Alexandra Velásquez Mendoza)'],
    ['un docente INACTIVO', { nombres: 'Gabriela Maholy', apellidos: 'Velasquez Moreira', estado: UsuarioEstado.INACTIVO }, 'pertenece a una cuenta inactiva'],
  ])('marca como error de fila el correo generado que pertenece a %s y no actualiza su perfil', async (_case, account, message) => {
    const buffer = await teacherWorkbook([EDISON, GABRIELA]);
    const context = setup(buffer);
    const gabriela = await context.repos.get(Usuario)!.save({ email: GABRIELA_EMAIL, rol: UsuarioRol.DOCENTE, ...account });
    await context.repos.get(Docente)!.save({ id: 'doc-gabriela', usuario: gabriela, cedula: null, titulo_academico: null, carrera_id: 'car-1', habilitado_tutoria: true });
    const { id } = await context.service.submit(context.admin, 'docentes.xlsx', buffer, null, 'car-1');
    await context.service.validateFile(id);
    const summary = await context.service.get(id);
    expect(summary.estado).toBe(Estado.INVALIDA);
    expect(summary.errores).toEqual([expect.objectContaining({ fila: 3, columna: 'DOCENTES', mensaje: expect.stringContaining(message) })]);
    await expect(context.service.confirm(id, context.admin, null)).rejects.toBeInstanceOf(ConflictException);
    expect(context.repos.get(Docente)!.rows).toEqual([expect.objectContaining({ id: 'doc-gabriela', habilitado_tutoria: true })]);
    expect(context.auditoria.registrar).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'ACTUALIZAR_DOCENTE_IMPORTACION' }));
  });

  it('rechaza el archivo cuyo hash cambió y responde 404 para preparaciones inexistentes', async () => {
    const buffer = await teacherWorkbook([EDISON]);
    const context = setup(buffer);
    const { id } = await context.service.submit(context.admin, 'docentes.xlsx', buffer, null, 'car-1');
    const record = context.repos.get(PreparacionImportacion)!.rows[0];
    record.sha256 = createHash('sha256').update('otro').digest('hex');
    await context.service.validateFile(id);
    expect(record.estado).toBe(Estado.INVALIDA);
    await expect(context.service.get('no-existe')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('guarda la carrera elegida en la preparación y en los docentes creados', async () => {
    const { service, repos, id } = await prepared([EDISON]);
    expect(repos.get(PreparacionImportacion)!.rows[0]).toMatchObject({ carrera_id: 'car-1' });
    await service.confirm(id, { id: 'admin' } as Usuario, null);
    await service.importConfirmed(id);
    expect(repos.get(Docente)!.rows[0]).toMatchObject({ carrera_id: 'car-1' });
  });

  it('rechaza una carrera inexistente al enviar el archivo', async () => {
    const buffer = await teacherWorkbook([EDISON]);
    const context = setup(buffer);
    await expect(context.service.submit(context.admin, 'docentes.xlsx', buffer, null, 'nope')).rejects.toThrow('No existe la carrera indicada.');
    expect(context.repos.get(PreparacionImportacion)!.rows).toHaveLength(0);
  });

  it('marca como error la fila de un docente que ya pertenece a otra carrera', async () => {
    const buffer = await teacherWorkbook([EDISON]);
    const context = setup(buffer);
    const edison = await context.repos.get(Usuario)!.save({ email: EDISON_EMAIL, nombres: 'Edison Ernesto', apellidos: 'Almeida Zambrano', rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO });
    await context.repos.get(Docente)!.save({ usuario: edison, cedula: null, titulo_academico: null, carrera_id: 'car-2', habilitado_tutoria: true });
    const { id } = await context.service.submit(context.admin, 'docentes.xlsx', buffer, null, 'car-1');
    await context.service.validateFile(id);
    const summary = await context.service.get(id);
    expect(summary.estado).toBe(Estado.INVALIDA);
    expect(summary.errores).toEqual([expect.objectContaining({ columna: 'DOCENTES', mensaje: expect.stringContaining('Ingeniería en Sistemas') })]);
  });
});
