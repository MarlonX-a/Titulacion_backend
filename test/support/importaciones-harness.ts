import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { AcademicoService } from '../../src/academico/academico.service.js';
import { Usuario } from '../../src/usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../../src/usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../../src/usuarios/enums/usuario-rol.enum.js';

export type Row = Record<string, unknown>;

function matches(record: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = record[key];
    if (value !== null && typeof value === 'object') {
      return actual !== null && typeof actual === 'object' && matches(actual as Row, value as Row);
    }
    return actual === value;
  });
}

/** Repositorio TypeORM mínimo en memoria para las pruebas unitarias de importaciones. */
export function memoryRepository(rows: Row[]) {
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

export type MemoryRepository = ReturnType<typeof memoryRepository>;

/**
 * Dependencias simuladas comunes de los servicios de importación (fuente de datos transaccional,
 * almacenamiento, auditoría, configuración con clave de bandeja de salida y cola).
 * `args` respeta el orden del constructor de ImportacionesService e ImportacionesDocentesService.
 */
export function importacionesHarness(repos: Map<unknown, MemoryRepository>, buffer: Buffer, keyDirPrefix: string) {
  const keyPath = join(mkdtempSync(join(tmpdir(), keyDirPrefix)), 'outbox.key');
  writeFileSync(keyPath, randomBytes(32));
  const admin = { id: 'admin', email: 'admin@uleam.edu.ec', rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO } as Usuario;
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
  const args = [dataSource as never, storage as never, auditoria as never, config as never, queue as never, new AcademicoService()] as const;
  return { admin, auditoria, queue, args };
}
