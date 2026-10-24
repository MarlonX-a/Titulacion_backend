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
      const exportTable = await manager.query('SELECT to_regclass($1) IS NOT NULL AS available', [`${schema}.solicitud_exportacion`]) as Array<{ available: boolean }>;
      const refs = exportTable[0]?.available
        ? await manager.query(
            `SELECT EXISTS (SELECT 1 FROM "${schema}"."plantilla_pat" WHERE "ruta_almacenamiento"=$1) OR EXISTS (SELECT 1 FROM "${schema}"."documento_pat" WHERE "ruta_almacenamiento"=$1) OR EXISTS (SELECT 1 FROM "${schema}"."solicitud_exportacion" WHERE "ruta_almacenamiento"=$1 AND ("expira_en" IS NULL OR "expira_en">CURRENT_TIMESTAMP)) AS referenced, EXISTS (SELECT 1 FROM "${schema}"."solicitud_exportacion" WHERE "ruta_almacenamiento"=$1 AND "expira_en"<=CURRENT_TIMESTAMP AND "archivo_limpiado"=false) AS expired_export`,
            [job.data.key],
          ) as Array<{ referenced: boolean; expired_export: boolean }>
        : await manager.query(
            `SELECT EXISTS (SELECT 1 FROM "${schema}"."plantilla_pat" WHERE "ruta_almacenamiento"=$1) OR EXISTS (SELECT 1 FROM "${schema}"."documento_pat" WHERE "ruta_almacenamiento"=$1) AS referenced, false AS expired_export`,
            [job.data.key],
          ) as Array<{ referenced: boolean; expired_export: boolean }>;
      if (refs[0]?.referenced) {
        await manager.query(`DELETE FROM "${schema}"."archivo_limpieza_pendiente" WHERE "id"=$1`, [pending.id]);
        return;
      }
      await this.storage.removePrivate(job.data.key);
      if (refs[0]?.expired_export) {
        await manager.query(`UPDATE "${schema}"."solicitud_exportacion" SET "archivo_limpiado"=true WHERE "ruta_almacenamiento"=$1 AND "expira_en"<=CURRENT_TIMESTAMP`, [job.data.key]);
      }
      await manager.query(`DELETE FROM "${schema}"."archivo_limpieza_pendiente" WHERE "id"=$1`, [pending.id]);
    });
  }
}
