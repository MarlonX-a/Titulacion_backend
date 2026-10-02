import { randomUUID } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { Usuario } from '../src/usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../src/usuarios/enums/usuario-estado.enum.js';

type UsuarioRecord = Partial<Usuario> &
  Pick<Usuario, 'id_externo_sso' | 'email' | 'nombres' | 'apellidos' | 'rol'>;

const records: Usuario[] = [];
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
  entityMetadatas: [{ target: Usuario }],
  getRepository: () => usuarioTestRepository,
  transaction: async <T>(callback: (manager: unknown) => Promise<T>) =>
    withTransaction(() =>
      callback({
        query: async () => undefined,
        getRepository: () => usuarioTestRepository,
      }),
    ),
};

export function clearUsuarioTestRecords(): void {
  records.length = 0;
}

export function addUsuarioTestRecord(value: UsuarioRecord): Usuario {
  const record = createRecord(value);
  records.push(record);
  return record;
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
