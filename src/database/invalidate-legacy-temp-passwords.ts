import { DatabaseDataSource } from './database-data-source.js';
import { loadEnvironment } from '../config/load-environment.js';
import { createDatabaseOptions } from './database.options.js';
import { verifyPassword } from '../auth/password-hasher.js';

interface LegacyCredentialRow {
  usuario_id: string;
  password_hash: string;
  cedula: string;
}

function schemaName(): string {
  const value = loadEnvironment().DB_SCHEMA;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('DB_SCHEMA no es válido.');
  return `"${value}"`;
}

/**
 * Invalidación única para despliegues que todavía tengan cédulas como claves temporales.
 * No muestra correos, cédulas, identificadores ni contraseñas; solo el total actualizado.
 */
async function run(): Promise<void> {
  const environment = loadEnvironment();
  if (environment.DB_SCHEMA === 'public' || environment.DB_SCHEMA === 'local_demo') {
    throw new Error('La transición requiere un esquema dedicado distinto de public y local_demo.');
  }
  const options = createDatabaseOptions(environment);
  const source = new DatabaseDataSource(options);
  await source.initialize();
  try {
    const s = schemaName();
    const candidates = await source.query(`
      SELECT c."usuario_id", c."password_hash", e."cedula"
      FROM ${s}."credencial_usuario" c
      JOIN ${s}."estudiante" e ON e."usuario_id" = c."usuario_id"
      WHERE c."requiere_cambio" = true
        AND c."password_hash" IS NOT NULL
        AND c."temporal_expira_en" > CURRENT_TIMESTAMP
      ORDER BY c."usuario_id"
    `) as LegacyCredentialRow[];

    const eligible: LegacyCredentialRow[] = [];
    for (const row of candidates) {
      if (await verifyPassword(row.password_hash, row.cedula)) eligible.push(row);
    }

    const invalidated = await source.transaction('SERIALIZABLE', async (manager) => {
      let total = 0;
      const now = new Date();
      for (const candidate of eligible) {
        const current = await manager.query(`
          SELECT c."password_hash", c."requiere_cambio", c."temporal_expira_en", e."cedula"
          FROM ${s}."credencial_usuario" c
          JOIN ${s}."estudiante" e ON e."usuario_id" = c."usuario_id"
          WHERE c."usuario_id" = $1
          FOR UPDATE OF c, e
        `, [candidate.usuario_id]) as Array<{ password_hash: string | null; requiere_cambio: boolean; temporal_expira_en: Date | null; cedula: string }>;
        const row = current[0];
        if (!row?.requiere_cambio || !row.password_hash || !row.temporal_expira_en || row.temporal_expira_en <= now ||
            row.password_hash !== candidate.password_hash || !await verifyPassword(row.password_hash, row.cedula)) continue;

        await manager.query(`
          UPDATE ${s}."credencial_usuario"
          SET "password_hash" = NULL, "temporal_expira_en" = NULL,
              "version_sesion" = "version_sesion" + 1, "actualizada_en" = $2
          WHERE "usuario_id" = $1
        `, [candidate.usuario_id, now]);
        await manager.query(`DELETE FROM ${s}."clave_temporal_visible" WHERE "usuario_id" = $1`, [candidate.usuario_id]);
        await manager.query(`
          UPDATE ${s}."correo_salida"
          SET "secreto_cifrado" = '', "nonce" = '', "tag" = '', "expira_en" = $2
          WHERE "usuario_id" = $1 AND "tipo" = 'ACCESO' AND "enviado_en" IS NULL
        `, [candidate.usuario_id, now]);
        await manager.query(`UPDATE ${s}."sesion_usuario" SET "revocada_en" = $2 WHERE "usuario_id" = $1 AND "revocada_en" IS NULL`, [candidate.usuario_id, now]);
        await manager.query(`
          INSERT INTO ${s}."auditoria" ("usuario_id", "accion", "entidad_tipo", "entidad_id", "valores_anteriores", "valores_nuevos", "ip_origen", "fecha")
          VALUES (NULL, 'INVALIDAR_CLAVE_TEMPORAL_CEDULA', 'usuario', $1, NULL,
            jsonb_build_object('automatico', true, 'motivo', 'transicion_clave_temporal_aleatoria'), NULL, $2)
        `, [candidate.usuario_id, now]);
        total += 1;
      }
      return total;
    });

    process.stdout.write(`${JSON.stringify({ cuentas_actualizadas: invalidated })}\n`);
  } finally {
    await source.destroy();
  }
}

run().catch(() => {
  process.stderr.write('No se pudieron invalidar las claves temporales heredadas. Verifique DB_SCHEMA, las migraciones y la conexión a PostgreSQL.\n');
  process.exitCode = 1;
});
