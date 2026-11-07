import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { AcademicoService } from '../../src/academico/academico.service.js';
import { construirCatalogo } from '../../src/academico/catalogo-academico.js';
import { Docente } from '../../src/docentes/entities/docente.entity.js';
import { LoteImportacion } from '../../src/importaciones/entities/lote-importacion.entity.js';
import { PreparacionImportacion } from '../../src/importaciones/entities/preparacion-importacion.entity.js';
import { ImportacionesTemasService } from '../../src/importaciones/importaciones-temas.service.js';
import { LineaInvestigacion } from '../../src/lineas-investigacion/entities/linea-investigacion.entity.js';
import { TemaHistorial } from '../../src/temas/entities/tema-historial.entity.js';
import { Tema } from '../../src/temas/entities/tema.entity.js';
import { Usuario } from '../../src/usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../../src/usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../../src/usuarios/enums/usuario-rol.enum.js';
import { memoryRepository, type Row } from './importaciones-harness.js';

export const CARRERA_SOFTWARE_ID = '00000000-0000-4000-8000-0000000000c1';
export const LINEA_ID = '00000000-0000-4000-8000-0000000000a1';
export const DOCENTE_ALMEIDA_ID = '00000000-0000-4000-8000-0000000000d1';
export const DOCENTE_PEREZ_LOOR_ID = '00000000-0000-4000-8000-0000000000d2';
export const DOCENTE_PEREZ_VERA_ID = '00000000-0000-4000-8000-0000000000d3';
const DOCENTE_INACTIVO_ID = '00000000-0000-4000-8000-0000000000d4';

function docente(id: string, nombres: string, apellidos: string, estado = UsuarioEstado.ACTIVO): Row {
  return { id, carrera_id: CARRERA_SOFTWARE_ID, usuario: { id: `usuario-${id}`, nombres, apellidos, estado, rol: UsuarioRol.DOCENTE } };
}

/** memoryRepository whose `find` honours `where.carrera_id` (the import queries by career). */
function porCarrera(rows: Row[]) {
  return {
    ...memoryRepository(rows),
    find: async (options?: { where?: { carrera_id?: string } }) => rows.filter((row) => !options?.where?.carrera_id || row.carrera_id === options.where.carrera_id),
  };
}

/** memoryRepository that assigns UUID ids, so the HTTP routes' ParseUUIDPipe accepts them. */
function conUuid(rows: Row[]) {
  const repository = memoryRepository(rows);
  return { ...repository, save: async (value: Row) => repository.save({ ...value, id: value.id ?? randomUUID() }).then((stored) => Object.assign(value, stored)) };
}

export function temasImportHarness(options: { titulosExistentes?: string[] } = {}) {
  const admin = { id: 'admin', email: 'admin@uleam.edu.ec', nombres: 'Admin', apellidos: 'Prueba', rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO } as Usuario;
  const repos = {
    preparaciones: conUuid([]),
    lotes: conUuid([]),
    historial: conUuid([]),
    lineas: memoryRepository([{ id: LINEA_ID, codigo: 'IA', nombre: 'Inteligencia artificial', descripcion: null, activa: true }]),
    docentes: porCarrera([
      docente(DOCENTE_ALMEIDA_ID, 'Edison Ernesto', 'Almeida Zambrano'),
      docente(DOCENTE_PEREZ_LOOR_ID, 'Juan', 'Pérez Loor'),
      docente(DOCENTE_PEREZ_VERA_ID, 'Ana', 'Pérez Vera'),
      docente(DOCENTE_INACTIVO_ID, 'Luis', 'Inactivo Mora', UsuarioEstado.INACTIVO),
    ]),
    temas: porCarrera((options.titulosExistentes ?? []).map((titulo, index) => ({ id: `tema-existente-${index}`, carrera_id: CARRERA_SOFTWARE_ID, titulo }))),
  };
  const porEntidad = new Map<unknown, unknown>([
    [PreparacionImportacion, repos.preparaciones], [LoteImportacion, repos.lotes], [TemaHistorial, repos.historial],
    [LineaInvestigacion, repos.lineas], [Docente, repos.docentes], [Tema, repos.temas],
  ]);
  const manager = { getRepository: (entity: unknown) => porEntidad.get(entity) };
  const dataSource = {
    manager,
    getRepository: manager.getRepository,
    transaction: async (isolation: unknown, callback?: (value: typeof manager) => Promise<unknown>) =>
      (typeof isolation === 'function' ? isolation as (value: typeof manager) => Promise<unknown> : callback!)(manager),
  };
  const storage = { savePrivate: vi.fn().mockResolvedValue('clave-temas'), readPrivate: vi.fn(), removePrivate: vi.fn().mockResolvedValue(undefined) };
  const auditoria = { registrar: vi.fn().mockResolvedValue(undefined) };
  const academico = new AcademicoService();
  vi.spyOn(academico, 'catalogo').mockResolvedValue(construirCatalogo(
    [{ id: 'fac-vida', codigo: 'VIDA', nombre: 'Facultad Ciencias de la Vida y Tecnologías' }],
    [{ id: CARRERA_SOFTWARE_ID, codigo: 'INGENIERIA_EN_SOFTWARE', nombre: 'Ingeniería en Software', facultad_id: 'fac-vida' }],
  ));
  const service = new ImportacionesTemasService(dataSource as never, storage as never, auditoria as never, academico);
  return { service, repos, admin, storage, auditoria };
}
