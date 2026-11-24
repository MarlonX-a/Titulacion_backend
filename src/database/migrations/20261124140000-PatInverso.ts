import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para el PAT inverso no es válido.');
  return `"${schema}"`;
}

/**
 * El estudiante sigue siendo el dueño de la generación. Un ADMIN activo puede solicitarla
 * en su nombre; cualquier otro solicitante distinto del estudiante se rechaza igual que antes.
 */
function generacionSql(s: string, admin: boolean): string {
  const solicitante = admin
    ? `IF v_rol<>'ESTUDIANTE' OR v_estado_usuario<>'ACTIVO' THEN RAISE EXCEPTION 'la generación pertenece a un estudiante activo' USING ERRCODE='23514'; END IF;
        IF v_cuenta IS DISTINCT FROM NEW."solicitada_por_id" THEN
          SELECT u."rol"::text,u."estado"::text INTO v_rol_actor,v_estado_actor FROM ${s}."usuario" u WHERE u."id"=NEW."solicitada_por_id";
          IF v_rol_actor IS DISTINCT FROM 'ADMIN' OR v_estado_actor IS DISTINCT FROM 'ACTIVO' THEN
            RAISE EXCEPTION 'la generación solo puede solicitarla el estudiante activo propietario o un ADMIN activo' USING ERRCODE='23514';
          END IF;
        END IF;`
    : `IF v_cuenta IS DISTINCT FROM NEW."solicitada_por_id" OR v_rol<>'ESTUDIANTE' OR v_estado_usuario<>'ACTIVO' THEN RAISE EXCEPTION 'la generación solo puede solicitarla el estudiante activo propietario' USING ERRCODE='23514'; END IF;`;
  return `
      CREATE OR REPLACE FUNCTION ${s}."validar_generacion_pat_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo uuid; v_estado_periodo text; v_estado_asignacion text; v_titular uuid; v_grupo uuid;
        v_cuenta uuid; v_rol text; v_estado_usuario text;${admin ? ' v_rol_actor text; v_estado_actor text;' : ''}
      BEGIN
        SELECT "periodo_id" INTO v_periodo FROM ${s}."asignacion_tema" WHERE "id"=NEW."asignacion_tema_id";
        IF v_periodo IS NULL THEN RAISE EXCEPTION 'asignación de tema inexistente' USING ERRCODE='23503'; END IF;
        SELECT "estado"::text INTO v_estado_periodo FROM ${s}."periodo_titulacion" WHERE "id"=v_periodo FOR UPDATE;
        SELECT "estado"::text,"estudiante_id","grupo_id" INTO v_estado_asignacion,v_titular,v_grupo FROM ${s}."asignacion_tema" WHERE "id"=NEW."asignacion_tema_id" FOR UPDATE;
        IF v_estado_periodo NOT IN ('POSTULACION_CERRADA','EN_CURSO') OR v_estado_asignacion<>'VIGENTE' OR (v_titular IS DISTINCT FROM NEW."estudiante_id" AND NOT EXISTS(SELECT 1 FROM ${s}."grupo_integrante" WHERE "grupo_id"=v_grupo AND "estudiante_id"=NEW."estudiante_id" AND "estado"='ACTIVO')) THEN
          RAISE EXCEPTION 'generación PAT requiere participación en asignación vigente' USING ERRCODE='23514';
        END IF;
        SELECT e."usuario_id",u."rol"::text,u."estado"::text INTO v_cuenta,v_rol,v_estado_usuario FROM ${s}."estudiante" e JOIN ${s}."usuario" u ON u."id"=e."usuario_id" WHERE e."id"=NEW."estudiante_id";
        ${solicitante}
        RETURN NEW;
      END $$`;
}

/** Vista previa del Word oficial PAT-04-F-002 y permiso para que ADMIN genere el PAT del estudiante. */
export class PatInverso20261124140000 implements MigrationInterface {
  name = 'PatInverso20261124140000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`
      CREATE TABLE ${s}."preparacion_pat_inverso" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "periodo_id" uuid NOT NULL,
        "asignacion_tema_id" uuid NOT NULL,
        "estudiante_id" uuid NOT NULL,
        "creada_por_id" uuid NOT NULL,
        "estado" varchar(20) NOT NULL,
        "extraido" jsonb NOT NULL,
        "expira_en" timestamptz NOT NULL,
        "creada_en" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_preparacion_pat_inverso" PRIMARY KEY ("id"),
        CONSTRAINT "FK_preparacion_pat_inverso_periodo" FOREIGN KEY ("periodo_id") REFERENCES ${s}."periodo_titulacion"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_preparacion_pat_inverso_asignacion" FOREIGN KEY ("asignacion_tema_id") REFERENCES ${s}."asignacion_tema"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_preparacion_pat_inverso_estudiante" FOREIGN KEY ("estudiante_id") REFERENCES ${s}."estudiante"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_preparacion_pat_inverso_autora" FOREIGN KEY ("creada_por_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_preparacion_pat_inverso_estado" CHECK ("estado" IN ('PENDIENTE','CONFIRMADA')),
        CONSTRAINT "CHK_preparacion_pat_inverso_extraido" CHECK (jsonb_typeof("extraido")='object')
      )
    `);
    await queryRunner.query(generacionSql(s, true));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    const [uso] = await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."preparacion_pat_inverso"`) as Array<{ total: number }>;
    if (Number(uso?.total)) throw new Error('No se puede revertir: hay vistas previas del PAT inverso que conservar.');
    await queryRunner.query(generacionSql(s, false));
    await queryRunner.query(`DROP TABLE ${s}."preparacion_pat_inverso"`);
  }
}
