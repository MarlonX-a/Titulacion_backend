import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AlmacenamientoService } from './almacenamiento.service.js';

interface CleanupData { key: string }

@Injectable()
@Processor('limpieza-archivos')
export class ArchivoLimpiezaWorker extends WorkerHost {
  constructor(private readonly dataSource: DataSource, private readonly storage: AlmacenamientoService) { super(); }

  async process(job: Job<CleanupData>): Promise<void> {
    if (job.name !== 'limpiar-archivo-no-referenciado') return;
    const schema = (this.dataSource.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Esquema de limpieza inválido.');
    await this.dataSource.transaction(async (manager) => {
      const intentions = await manager.query(
        `SELECT "periodo_id" FROM "${schema}"."archivo_limpieza_pendiente" WHERE "ruta_almacenamiento"=$1`,
        [job.data.key],
      ) as Array<{ periodo_id: string | null }>;
      const periodId = intentions[0]?.periodo_id;
      if (!intentions.length) return;
      if (periodId) {
        await manager.query(`SELECT "id" FROM "${schema}"."periodo_titulacion" WHERE "id"=$1 FOR UPDATE`, [periodId]);
      }
      const rows = await manager.query(
        `SELECT "id", "estado", "creado_en" FROM "${schema}"."archivo_limpieza_pendiente" WHERE "ruta_almacenamiento"=$1 FOR UPDATE SKIP LOCKED`,
        [job.data.key],
      ) as Array<{ id: string; estado: string; creado_en: Date }>;
      const pending = rows[0];
      if (!pending) return;
      if (pending.estado !== 'LIMPIEZA' && new Date(pending.creado_en).getTime() > Date.now() - 60 * 60_000) return;
      const refs = await manager.query(
        `SELECT EXISTS (SELECT 1 FROM "${schema}"."plantilla_pat" WHERE "ruta_almacenamiento"=$1) OR EXISTS (SELECT 1 FROM "${schema}"."documento_pat" WHERE "ruta_almacenamiento"=$1) AS referenced`,
        [job.data.key],
      ) as Array<{ referenced: boolean }>;
      if (refs[0]?.referenced) {
        await manager.query(`DELETE FROM "${schema}"."archivo_limpieza_pendiente" WHERE "id"=$1`, [pending.id]);
        return;
      }
      await this.storage.removePrivate(job.data.key);
      await manager.query(`DELETE FROM "${schema}"."archivo_limpieza_pendiente" WHERE "id"=$1`, [pending.id]);
    });
  }
}
