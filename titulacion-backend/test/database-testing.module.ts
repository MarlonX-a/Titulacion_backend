import { randomUUID } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { Usuario } from '../src/usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../src/usuarios/enums/usuario-estado.enum.js';
import { Estudiante } from '../src/estudiantes/entities/estudiante.entity.js';
import { Docente } from '../src/docentes/entities/docente.entity.js';
import { PeriodoTitulacion } from '../src/periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../src/periodos/enums/periodo-estado.enum.js';

type UsuarioRecord = Partial<Usuario> &
  Pick<Usuario, 'id_externo_sso' | 'email' | 'nombres' | 'apellidos' | 'rol'>;

const records: Usuario[] = [];
const estudianteRecords: Estudiante[] = [];
const docenteRecords: Docente[] = [];
const periodoRecords: PeriodoTitulacion[] = [];
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
          record.id_externo_sso === usuario.id_externo_sso,
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
  entityMetadatas: [
    { target: Usuario },
    { target: Estudiante },
    { target: Docente },
    { target: PeriodoTitulacion },
  ],
  getRepository: (entity: unknown) => {
    if (entity === Usuario) return usuarioTestRepository;
    if (entity === Estudiante) return estudianteTestRepository;
    if (entity === Docente) return docenteTestRepository;
    if (entity === PeriodoTitulacion) return periodoTestRepository;
    throw new Error('Entidad no configurada en los repositorios de prueba.');
  },
  transaction: async <T>(callback: (manager: unknown) => Promise<T>) =>
    withTransaction(() =>
      callback({
        query: async () => undefined,
        getRepository: (entity: unknown) => {
          if (entity === Usuario) return usuarioTestRepository;
          if (entity === Estudiante) return estudianteTestRepository;
          if (entity === Docente) return docenteTestRepository;
          if (entity === PeriodoTitulacion) return periodoTestRepository;
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
}

export function addUsuarioTestRecord(value: UsuarioRecord): Usuario {
  const record = createRecord(value);
  records.push(record);
  return record;
}

export function setPeriodoTestEstado(
  id: string,
  estado: PeriodoEstado,
): void {
  const periodo = periodoRecords.find((record) => record.id === id);
  if (periodo) periodo.estado = estado;
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
