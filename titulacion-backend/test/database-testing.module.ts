import { randomUUID } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { FindOperator, QueryFailedError } from 'typeorm';
import { Usuario } from '../src/usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../src/usuarios/enums/usuario-estado.enum.js';
import { Estudiante } from '../src/estudiantes/entities/estudiante.entity.js';
import { Docente } from '../src/docentes/entities/docente.entity.js';
import { PeriodoTitulacion } from '../src/periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../src/periodos/enums/periodo-estado.enum.js';
import { EstudianteHabilitado } from '../src/habilitados/entities/estudiante-habilitado.entity.js';
import { HabilitadoEstado } from '../src/habilitados/enums/habilitado-estado.enum.js';
import { Auditoria } from '../src/auditoria/entities/auditoria.entity.js';
import { HabilitadoOrigen } from '../src/habilitados/enums/habilitado-origen.enum.js';
import { LineaInvestigacion } from '../src/lineas-investigacion/entities/linea-investigacion.entity.js';
import { Tema } from '../src/temas/entities/tema.entity.js';
import { TemaHistorial } from '../src/temas/entities/tema-historial.entity.js';
import { EstadoTema } from '../src/temas/enums/estado-tema.enum.js';
import { Grupo } from '../src/grupos/entities/grupo.entity.js';
import { GrupoIntegrante } from '../src/grupos/entities/grupo-integrante.entity.js';
import { Invitacion } from '../src/invitaciones/entities/invitacion.entity.js';
import { Postulacion } from '../src/postulaciones/entities/postulacion.entity.js';
import { TutorPropuesto } from '../src/postulaciones/entities/tutor-propuesto.entity.js';
import { ResolucionConflicto } from '../src/conflictos/entities/resolucion-conflicto.entity.js';
import { ConflictoParticipante } from '../src/conflictos/entities/conflicto-participante.entity.js';
import { AsignacionTema } from '../src/asignaciones-tema/entities/asignacion-tema.entity.js';
import { CredencialUsuario } from '../src/auth/entities/credencial-usuario.entity.js';
import { CorreoSalida } from '../src/auth/entities/correo-salida.entity.js';

type UsuarioRecord = Partial<Usuario> &
  Pick<Usuario, 'id_externo_sso' | 'email' | 'nombres' | 'apellidos' | 'rol'>;

const records: Usuario[] = [];
const estudianteRecords: Estudiante[] = [];
const docenteRecords: Docente[] = [];
const periodoRecords: PeriodoTitulacion[] = [];
const habilitadoRecords: EstudianteHabilitado[] = [];
const auditoriaRecords: Auditoria[] = [];
const lineaRecords: LineaInvestigacion[] = [];
const temaRecords: Tema[] = [];
const temaHistorialRecords: TemaHistorial[] = [];
const grupoRecords: Grupo[] = [];
const grupoIntegranteRecords: GrupoIntegrante[] = [];
const invitacionRecords: Invitacion[] = [];
const tutorPropuestoRecords: TutorPropuesto[] = [];
const credencialRecords: CredencialUsuario[] = [];
const correoRecords: CorreoSalida[] = [];
const assignmentTemaTestRepository = { create: (value: unknown) => value, save: async (value: unknown) => value, insert: async () => ({ identifiers: [] }), findOneBy: async () => null, findOneByOrFail: async () => { throw new Error('No existe una asignación en el repositorio de prueba.'); }, findOne: async () => null, find: async () => [], findAndCount: async () => [[], 0] as const, exist: async () => false, update: async () => ({ affected: 0 }), createQueryBuilder: () => ({ leftJoinAndSelect() { return this; }, where() { return this; }, andWhere() { return this; }, orderBy() { return this; }, addOrderBy() { return this; }, skip() { return this; }, take() { return this; }, getManyAndCount: async () => [[], 0] as const }) };
let transactionQueue: Promise<void> = Promise.resolve();

function createRecord(value: UsuarioRecord): Usuario {
  return {
    id: randomUUID(),
    estado: UsuarioEstado.ACTIVO,
    ultimo_acceso: null,
    creado_en: new Date(),
    ...value,
  } as Usuario;
}

export const usuarioTestRepository = {
  create: (value: UsuarioRecord) => ({ ...value }) as Usuario,
  save: async (usuario: Usuario) => {
    const email = usuario.email.toLowerCase();
    if (
      records.some(
        (record) =>
          record.email === email ||
          (usuario.id_externo_sso !== null && record.id_externo_sso === usuario.id_externo_sso),
      )
    ) {
      const driverError = Object.assign(new Error('duplicate'), {
        code: '23505',
      });
      throw new QueryFailedError('INSERT INTO usuario', [], driverError);
    }
    const stored = createRecord({ ...usuario, email });
    records.push(stored);
    return stored;
  },
  findOneBy: async (criteria: Partial<Usuario>) =>
    records.find((record) =>
      Object.entries(criteria).every(
        ([key, value]) => record[key as keyof Usuario] === value,
      ),
    ) ?? null,
  findOne: async (options: { where: Partial<Usuario> }) =>
    records.find((record) =>
      Object.entries(options.where).every(
        ([key, value]) => record[key as keyof Usuario] === value,
      ),
    ) ?? null,
  findAndCount: async (options: { skip: number; take: number }) => {
    const ordered = [...records].sort(
      (left, right) =>
        left.creado_en.getTime() - right.creado_en.getTime() ||
        left.id.localeCompare(right.id),
    );
    return [
      ordered.slice(options.skip, options.skip + options.take),
      records.length,
    ] as const;
  },
  update: async (criteria: Partial<Usuario>, values: Partial<Usuario>) => {
    const found = records.find((record) =>
      Object.entries(criteria).every(
        ([key, value]) => record[key as keyof Usuario] === value,
      ),
    );
    if (found) Object.assign(found, values);
    return { affected: found ? 1 : 0 };
  },
  countBy: async (criteria: Partial<Usuario>) =>
    records.filter((record) =>
      Object.entries(criteria).every(
        ([key, value]) => record[key as keyof Usuario] === value,
      ),
    ).length,
};

function duplicateError(query: string): QueryFailedError {
  const driverError = Object.assign(new Error('duplicate'), { code: '23505' });
  return new QueryFailedError(query, [], driverError);
}

export const estudianteTestRepository = {
  create: (value: Partial<Estudiante>) => ({ ...value }) as Estudiante,
  save: async (estudiante: Estudiante) => {
    if (
      estudianteRecords.some(
        (record) =>
          record.usuario.id === estudiante.usuario.id ||
          record.cedula === estudiante.cedula ||
          record.matricula === estudiante.matricula,
      )
    ) {
      throw duplicateError('INSERT INTO estudiante');
    }
    const stored = {
      ...estudiante,
      id: estudiante.id ?? randomUUID(),
    };
    estudianteRecords.push(stored);
    return stored;
  },
  findAndCount: async (options: { skip: number; take: number }) => {
    const ordered = [...estudianteRecords].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    return [
      ordered.slice(options.skip, options.skip + options.take),
      estudianteRecords.length,
    ] as const;
  },
  findOne: async (options: {
    where: { id?: string; usuario?: { id: string } };
  }) =>
    estudianteRecords.find(
      (record) =>
        (options.where.id !== undefined && record.id === options.where.id) ||
        (options.where.usuario !== undefined &&
          record.usuario.id === options.where.usuario.id),
    ) ?? null,
};

export const docenteTestRepository = {
  create: (value: Partial<Docente>) => ({ ...value }) as Docente,
  save: async (docente: Docente) => {
    if (
      docenteRecords.some(
        (record) =>
          record.usuario.id === docente.usuario.id ||
          record.cedula === docente.cedula,
      )
    ) {
      throw duplicateError('INSERT INTO docente');
    }
    const stored = { ...docente, id: docente.id ?? randomUUID() };
    docenteRecords.push(stored);
    return stored;
  },
  findAndCount: async (options: { skip: number; take: number }) => {
    const ordered = [...docenteRecords].sort((a, b) => a.id.localeCompare(b.id));
    return [
      ordered.slice(options.skip, options.skip + options.take),
      docenteRecords.length,
    ] as const;
  },
  findOne: async (options: {
    where: { id?: string; usuario?: { id: string } };
  }) =>
    docenteRecords.find(
      (record) =>
        (options.where.id !== undefined && record.id === options.where.id) ||
        (options.where.usuario !== undefined &&
          record.usuario.id === options.where.usuario.id),
    ) ?? null,
};

export const periodoTestRepository = {
  create: (value: Partial<PeriodoTitulacion>) =>
    ({ ...value }) as PeriodoTitulacion,
  save: async (periodo: PeriodoTitulacion) => {
    if (
      periodoRecords.some(
        (record) =>
          record.codigo === periodo.codigo && record.id !== periodo.id,
      )
    ) {
      throw duplicateError('INSERT INTO periodo_titulacion');
    }
    const existingIndex = periodoRecords.findIndex(
      (record) => record.id === periodo.id,
    );
    const stored = {
      ...periodo,
      id: periodo.id ?? randomUUID(),
      estado: periodo.estado ?? PeriodoEstado.BORRADOR,
    };
    if (existingIndex >= 0) periodoRecords[existingIndex] = stored;
    else periodoRecords.push(stored);
    return stored;
  },
  findAndCount: async (options: { skip: number; take: number }) => {
    const ordered = [...periodoRecords].sort(
      (left, right) =>
        right.fecha_inicio_postulacion.getTime() -
          left.fecha_inicio_postulacion.getTime() ||
        left.id.localeCompare(right.id),
    );
    return [
      ordered.slice(options.skip, options.skip + options.take),
      periodoRecords.length,
    ] as const;
  },
  findOneBy: async (criteria: Partial<PeriodoTitulacion>) =>
    periodoRecords.find((record) =>
      Object.entries(criteria).every(
        ([key, value]) => record[key as keyof PeriodoTitulacion] === value,
      ),
    ) ?? null,
  findOne: async (options: { where: Partial<PeriodoTitulacion> }) =>
    periodoRecords.find((record) =>
      Object.entries(options.where).every(
        ([key, value]) => record[key as keyof PeriodoTitulacion] === value,
      ),
    ) ?? null,
};

function matchesRecord(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = record[key];
    if (value instanceof FindOperator) {
      const expected = value.value;
      if (typeof actual !== 'number' || typeof expected !== 'number') return false;
      if (value.type === 'lessThanOrEqual') return actual <= expected;
      if (value.type === 'moreThanOrEqual') return actual >= expected;
      return actual === expected;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return actual !== null && typeof actual === 'object' &&
        matchesRecord(actual as Record<string, unknown>, value as Record<string, unknown>);
    }
    return actual === value;
  });
}

export const habilitadoTestRepository = {
  create: (value: Partial<EstudianteHabilitado>) => ({ ...value }) as EstudianteHabilitado,
  save: async (record: EstudianteHabilitado) => {
    if (habilitadoRecords.some((existing) =>
      existing.periodo.id === record.periodo.id &&
      existing.estudiante.id === record.estudiante.id && existing.id !== record.id)) {
      throw duplicateError('INSERT INTO estudiante_habilitado');
    }
    const existingIndex = habilitadoRecords.findIndex((existing) => existing.id === record.id);
    const stored = {
      ...record,
      id: record.id ?? randomUUID(),
      estado: record.estado ?? HabilitadoEstado.HABILITADO,
      origen: record.origen ?? HabilitadoOrigen.MANUAL,
      fecha_habilitacion: record.fecha_habilitacion ?? new Date(),
    };
    if (existingIndex < 0) habilitadoRecords.push(stored);
    else habilitadoRecords[existingIndex] = stored;
    return stored;
  },
  findAndCount: async (options: { where: Record<string, unknown>; skip: number; take: number }) => {
    const filtered = habilitadoRecords.filter((record) => matchesRecord(record as unknown as Record<string, unknown>, options.where));
    const ordered = filtered.sort((left, right) =>
      right.fecha_habilitacion.getTime() - left.fecha_habilitacion.getTime() || left.id.localeCompare(right.id));
    return [ordered.slice(options.skip, options.skip + options.take), filtered.length] as const;
  },
  findOne: async (options: { where: Record<string, unknown> }) =>
    habilitadoRecords.find((record) => matchesRecord(record as unknown as Record<string, unknown>, options.where)) ?? null,
};

export const auditoriaTestRepository = {
  create: (value: Partial<Auditoria>) => ({ ...value }) as Auditoria,
  save: async (record: Auditoria) => {
    const stored = { ...record, id: String(auditoriaRecords.length + 1) };
    auditoriaRecords.push(stored);
    return stored;
  },
};

export const lineaTestRepository = {
  create: (value: Partial<LineaInvestigacion>) => ({ ...value }) as LineaInvestigacion,
  save: async (linea: LineaInvestigacion) => {
    if (lineaRecords.some((record) => record.codigo === linea.codigo && record.id !== linea.id)) throw duplicateError('INSERT INTO linea_investigacion');
    const index = lineaRecords.findIndex((record) => record.id === linea.id);
    const stored = { ...linea, id: linea.id ?? randomUUID(), activa: linea.activa ?? true, descripcion: linea.descripcion ?? null };
    if (index >= 0) lineaRecords[index] = stored;
    else lineaRecords.push(stored);
    return stored;
  },
  findAndCount: async (options: { where?: Partial<LineaInvestigacion>; skip: number; take: number }) => {
    const filtered = lineaRecords.filter((record) => !options.where || matchesRecord(record as unknown as Record<string, unknown>, options.where as Record<string, unknown>));
    const ordered = filtered.sort((a, b) => a.codigo.localeCompare(b.codigo) || a.id.localeCompare(b.id));
    return [ordered.slice(options.skip, options.skip + options.take), filtered.length] as const;
  },
  findOne: async (options: { where: Partial<LineaInvestigacion> }) => lineaRecords.find((record) => matchesRecord(record as unknown as Record<string, unknown>, options.where as Record<string, unknown>)) ?? null,
  findOneBy: async (where: Partial<LineaInvestigacion>) => lineaRecords.find((record) => matchesRecord(record as unknown as Record<string, unknown>, where as Record<string, unknown>)) ?? null,
};

export const temaTestRepository = {
  create: (value: Partial<Tema>) => ({ ...value }) as Tema,
  save: async (tema: Tema) => {
    const index = temaRecords.findIndex((record) => record.id === tema.id);
    const stored = { ...tema, id: tema.id ?? randomUUID(), estado: tema.estado ?? EstadoTema.BORRADOR, creado_en: tema.creado_en ?? new Date() };
    if (index >= 0) temaRecords[index] = stored;
    else temaRecords.push(stored);
    return stored;
  },
  findAndCount: async (options: { where?: Record<string, unknown>; skip: number; take: number }) => {
    const filtered = temaRecords.filter((record) => !options.where || matchesRecord(record as unknown as Record<string, unknown>, options.where));
    const ordered = filtered.sort((a, b) => b.creado_en.getTime() - a.creado_en.getTime() || a.id.localeCompare(b.id));
    return [ordered.slice(options.skip, options.skip + options.take), filtered.length] as const;
  },
  findOne: async (options: { where: Record<string, unknown> }) => temaRecords.find((record) => matchesRecord(record as unknown as Record<string, unknown>, options.where)) ?? null,
  findOneBy: async (where: Record<string, unknown>) => temaRecords.find((record) => matchesRecord(record as unknown as Record<string, unknown>, where)) ?? null,
};

export const temaHistorialTestRepository = {
  create: (value: Partial<TemaHistorial>) => ({ ...value }) as TemaHistorial,
  save: async (item: TemaHistorial) => {
    const stored = { ...item, id: item.id ?? randomUUID(), fecha: item.fecha ?? new Date() };
    temaHistorialRecords.push(stored);
    return stored;
  },
  findAndCount: async (options: { where: Record<string, unknown>; skip: number; take: number }) => {
    const filtered = temaHistorialRecords.filter((record) => matchesRecord(record as unknown as Record<string, unknown>, options.where));
    const ordered = filtered.sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.id.localeCompare(b.id));
    return [ordered.slice(options.skip, options.skip + options.take), filtered.length] as const;
  },
};

function emptyRepository<T>() {
  return {
    create: (value: Partial<T>) => ({ ...value }) as T,
    save: async (value: T) => value,
    findOne: async () => null,
    find: async () => [],
    findAndCount: async () => [[], 0] as const,
    count: async () => 0,
    createQueryBuilder: () => ({
      select() { return this; }, where() { return this; }, andWhere() { return this; },
      setLock() { return this; }, orderBy() { return this; }, addOrderBy() { return this; },
      skip() { return this; }, take() { return this; }, leftJoinAndSelect() { return this; }, innerJoinAndSelect() { return this; },
      setParameter() { return this; }, getOne: async () => null, getMany: async () => [], getManyAndCount: async () => [[], 0] as const,
    }),
  };
}

const grupoTestRepository = emptyRepository<Grupo>();
const grupoIntegranteTestRepository = emptyRepository<GrupoIntegrante>();
const invitacionTestRepository = emptyRepository<Invitacion>();
const postulacionTestRepository = emptyRepository<Postulacion>();
const tutorPropuestoTestRepository = emptyRepository<TutorPropuesto>();
const credencialTestRepository = {
  create: (value: Partial<CredencialUsuario>) => ({ ...value }) as CredencialUsuario,
  save: async (value: CredencialUsuario) => {
    const index = credencialRecords.findIndex((item) => item.usuario_id === value.usuario_id);
    if (index >= 0) credencialRecords[index] = value; else credencialRecords.push(value);
    return value;
  },
  findOneBy: async (criteria: Partial<CredencialUsuario>) => credencialRecords.find((item) => Object.entries(criteria).every(([key, value]) => item[key as keyof CredencialUsuario] === value)) ?? null,
  update: async () => ({ affected: 1 }),
};
const correoTestRepository = {
  create: (value: Partial<CorreoSalida>) => ({ ...value }) as CorreoSalida,
  save: async (value: CorreoSalida) => { const stored = { ...value, id: value.id ?? randomUUID(), creada_en: value.creada_en ?? new Date() }; correoRecords.push(stored); return stored; },
};

async function withTransaction<T>(callback: () => Promise<T>): Promise<T> {
  const previous = transactionQueue;
  let release: () => void = () => undefined;
  transactionQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await callback();
  } finally {
    release();
  }
}

export const usuarioTestDataSource = {
  options: { type: 'postgres' },
  connection: { options: { schema: 'public' } },
  query: async (sql: string, parameters?: unknown[]) => {
    if (sql.includes('FROM tema t') && sql.includes('postulaciones_abiertas')) {
      const ids = parameters?.[1] as string[] | undefined;
      return temaRecords.filter((tema) => ids?.includes(tema.id)).map((tema) => ({ id: tema.id, disponible: tema.estado === EstadoTema.PUBLICADO, postulaciones_abiertas: 0 }));
    }
    if (sql.includes('asignacion_tema')) return [];
    return [];
  },
  entityMetadatas: [
    { target: Usuario },
    { target: Estudiante },
    { target: Docente },
    { target: PeriodoTitulacion },
    { target: EstudianteHabilitado },
    { target: Auditoria },
    { target: LineaInvestigacion },
    { target: Tema },
    { target: TemaHistorial },
    { target: Grupo },
    { target: GrupoIntegrante },
    { target: Invitacion },
    { target: Postulacion },
    { target: TutorPropuesto },
    { target: ResolucionConflicto },
    { target: ConflictoParticipante },
    { target: AsignacionTema },
    { target: CredencialUsuario },
    { target: CorreoSalida },
  ],
  getRepository: (entity: unknown) => {
    if (entity === Usuario) return usuarioTestRepository;
    if (entity === Estudiante) return estudianteTestRepository;
    if (entity === Docente) return docenteTestRepository;
    if (entity === PeriodoTitulacion) return periodoTestRepository;
    if (entity === EstudianteHabilitado) return habilitadoTestRepository;
    if (entity === Auditoria) return auditoriaTestRepository;
    if (entity === LineaInvestigacion) return lineaTestRepository;
    if (entity === Tema) return temaTestRepository;
    if (entity === TemaHistorial) return temaHistorialTestRepository;
    if (entity === Grupo) return grupoTestRepository;
    if (entity === GrupoIntegrante) return grupoIntegranteTestRepository;
    if (entity === Invitacion) return invitacionTestRepository;
    if (entity === Postulacion) return postulacionTestRepository;
    if (entity === TutorPropuesto) return tutorPropuestoTestRepository;
    if (entity === ResolucionConflicto || entity === ConflictoParticipante) return { create: (value: unknown) => value, save: async (value: unknown) => value, insert: async () => ({ identifiers: [] }), findOneBy: async () => null, find: async () => [] };
    if (entity === AsignacionTema) return assignmentTemaTestRepository;
    if (entity === CredencialUsuario) return credencialTestRepository;
    if (entity === CorreoSalida) return correoTestRepository;
    throw new Error('Entidad no configurada en los repositorios de prueba.');
  },
  transaction: async <T>(callback: (manager: unknown) => Promise<T>) =>
    withTransaction(() =>
      callback({
        connection: usuarioTestDataSource,
        query: async (sql: string, parameters?: unknown[]) => {
          if (sql.includes('SELECT "usuario_id" FROM "public"."estudiante"')) {
            const profile = estudianteRecords.find((record) => record.id === parameters?.[0]);
            return profile ? [{ usuario_id: profile.usuario.id }] : [];
          }
          if (sql.includes('asignacion_tema')) return [];
          if (sql.includes('pg_advisory_xact_lock')) return [];
          return [];
        },
        getRepository: (entity: unknown) => {
          if (entity === Usuario) return usuarioTestRepository;
          if (entity === Estudiante) return estudianteTestRepository;
          if (entity === Docente) return docenteTestRepository;
          if (entity === PeriodoTitulacion) return periodoTestRepository;
          if (entity === EstudianteHabilitado) return habilitadoTestRepository;
          if (entity === Auditoria) return auditoriaTestRepository;
          if (entity === LineaInvestigacion) return lineaTestRepository;
          if (entity === Tema) return temaTestRepository;
          if (entity === TemaHistorial) return temaHistorialTestRepository;
          if (entity === Grupo) return grupoTestRepository;
          if (entity === GrupoIntegrante) return grupoIntegranteTestRepository;
          if (entity === Invitacion) return invitacionTestRepository;
          if (entity === Postulacion) return postulacionTestRepository;
          if (entity === TutorPropuesto) return tutorPropuestoTestRepository;
          if (entity === ResolucionConflicto || entity === ConflictoParticipante) return { create: (value: unknown) => value, save: async (value: unknown) => value, insert: async () => ({ identifiers: [] }), findOneBy: async () => null, find: async () => [] };
          if (entity === AsignacionTema) return assignmentTemaTestRepository;
          if (entity === CredencialUsuario) return credencialTestRepository;
          if (entity === CorreoSalida) return correoTestRepository;
          throw new Error('Entidad no configurada en la transacción de prueba.');
        },
      }),
    ),
};

export function clearUsuarioTestRecords(): void {
  records.length = 0;
  estudianteRecords.length = 0;
  docenteRecords.length = 0;
  periodoRecords.length = 0;
  habilitadoRecords.length = 0;
  auditoriaRecords.length = 0;
  lineaRecords.length = 0;
  temaRecords.length = 0;
  temaHistorialRecords.length = 0;
  grupoRecords.length = 0;
  grupoIntegranteRecords.length = 0;
  invitacionRecords.length = 0;
  tutorPropuestoRecords.length = 0;
  credencialRecords.length = 0;
  correoRecords.length = 0;
}

export function habilitadosTestRecords(): readonly EstudianteHabilitado[] {
  return habilitadoRecords;
}

export function auditoriaTestRecords(): readonly Auditoria[] {
  return auditoriaRecords;
}

export function addUsuarioTestRecord(value: UsuarioRecord): Usuario {
  const record = createRecord(value);
  records.push(record);
  return record;
}

export function findUsuarioTestIdByExternalId(subject: string): string | undefined {
  return records.find((record) => record.id_externo_sso === subject)?.id;
}

export function setPeriodoTestEstado(
  id: string,
  estado: PeriodoEstado,
): void {
  const periodo = periodoRecords.find((record) => record.id === id);
  if (periodo) periodo.estado = estado;
}

export function setPeriodoTestFechas(
  id: string,
  inicio: Date,
  fin: Date,
): void {
  const periodo = periodoRecords.find((record) => record.id === id);
  if (periodo) {
    periodo.fecha_inicio_postulacion = inicio;
    periodo.fecha_fin_postulacion = fin;
  }
}

// Simula también el bloqueo del primer ADMIN y los repositorios para pruebas HTTP.
@Global()
@Module({
  providers: [
    { provide: getDataSourceToken(), useValue: usuarioTestDataSource },
  ],
  exports: [getDataSourceToken()],
})
export class DatabaseTestingModule {}
