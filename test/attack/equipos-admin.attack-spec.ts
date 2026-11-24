import request from 'supertest';
import { crearCuenta, tokenDe, type Cuenta } from './support/actors.js';
import { cerrarPostulacion, crearPeriodo, crearTema, habilitar } from './support/escenario.js';
import { bootAttackApp, type AttackApp } from './support/harness.js';

/**
 * Equipos administrativos (pieza A) contra PostgreSQL real: endpoints ADMIN y disparadores de la
 * migración 20261123120000 (origen ADMIN sin postulación, candidatos, composición cerrada).
 */
describe('Equipos administrativos (ataque)', () => {
  let attack: AttackApp;
  let admin: Cuenta;
  let docentes: Cuenta[];
  let periodo: string;
  const tokens = new Map<string, string>();
  const auth = async (cuenta: Cuenta) => {
    if (!tokens.has(cuenta.usuarioId)) tokens.set(cuenta.usuarioId, await tokenDe(attack, cuenta));
    return `Bearer ${tokens.get(cuenta.usuarioId)!}`;
  };
  const post = async (path: string, cuenta: Cuenta, body: object) => request(attack.baseUrl).post(path).set('Authorization', await auth(cuenta)).send(body);
  const get = async (path: string, cuenta: Cuenta) => request(attack.baseUrl).get(path).set('Authorization', await auth(cuenta));
  const estudiantes = async (n: number) => {
    const cuentas = await Promise.all(Array.from({ length: n }, () => crearCuenta(attack, { rol: 'ESTUDIANTE' })));
    await habilitar(attack, periodo, ...cuentas);
    return cuentas;
  };
  const uno = async <T>(sql: string, params: unknown[] = []) => ((await attack.db.query(sql, params)) as T[])[0]!;
  const codigoPg = async (promesa: Promise<unknown>) => promesa.then(() => 'OK', (error: { driverError?: { code?: string }; code?: string }) => error.driverError?.code ?? error.code ?? 'ERROR');

  beforeAll(async () => {
    attack = await bootAttackApp();
    admin = await crearCuenta(attack, { rol: 'ADMIN' });
    docentes = await Promise.all(Array.from({ length: 3 }, () => crearCuenta(attack, { rol: 'DOCENTE' })));
    periodo = await crearPeriodo(attack);
    await cerrarPostulacion(attack, periodo);
    await attack.db.query(`INSERT INTO ${attack.s}."config_carga_tutorial" ("periodo_id","docente_id","max_trabajos","bloquear_al_superar") VALUES ($1,NULL,5,true)`, [periodo]);
  });
  afterAll(async () => { await attack?.close(); });

  it('conforma un trabajo individual con un candidato: asignación ADMIN sin postulación y tutor vigente', async () => {
    const [estudiante] = await estudiantes(1);
    const tema = await crearTema(attack, docentes[0]!, 'INDIVIDUAL');
    const response = await post(`/periodos/${periodo}/equipos`, admin, { estudiante_ids: [estudiante!.estudianteId], tema_id: tema, docente_ids: [docentes[0]!.docenteId], motivo: 'Acta 1' });
    expect(response.status).toBe(201);
    const id = (response.body as { equipo: { id: string } }).equipo.id;
    expect(response.body).toMatchObject({ equipo: { origen: 'ADMIN', modalidad: 'INDIVIDUAL', candidatos: [{ prioridad: 1 }], tutor_vigente: { tipo: 'CANDIDATO_CONFIRMADO', docente: { id: docentes[0]!.docenteId } } } });
    const fila = await uno<{ origen: string; postulacion_id: string | null; tema_estado: string; tutores: number }>(
      `SELECT a."origen"::text AS origen,a."postulacion_id",t."estado"::text AS tema_estado,(SELECT count(*)::int FROM ${attack.s}."asignacion_tutor" x WHERE x."asignacion_tema_id"=a."id" AND x."estado"='VIGENTE') AS tutores
       FROM ${attack.s}."asignacion_tema" a JOIN ${attack.s}."tema" t ON t."id"=a."tema_id" WHERE a."id"=$1`, [id]);
    expect(fila).toEqual({ origen: 'ADMIN', postulacion_id: null, tema_estado: 'ASIGNADO', tutores: 1 });

    // Las consultas existentes toleran la asignación sin postulación.
    expect((await get(`/periodos/${periodo}/asignaciones-tema/${id}`, admin)).body).toMatchObject({ origen: 'ADMIN', postulacion: null, modalidad: 'INDIVIDUAL' });
    expect((await get(`/periodos/${periodo}/asignaciones-tutor?asignacion_tema_id=${id}`, admin)).body).toMatchObject({ total: 1, data: [{ trabajo: { origen: 'ADMIN', postulacion: null } }] });
    expect((await get(`/periodos/${periodo}/equipos/${id}`, estudiante!)).status).toBe(403);
    expect((await get(`/periodos/${periodo}/equipos`, admin)).body).toMatchObject({ data: expect.arrayContaining([expect.objectContaining({ id, total_candidatos: 1 })]) });

    // El mismo estudiante no recibe otra asignación vigente.
    const tema2 = await crearTema(attack, docentes[0]!, 'INDIVIDUAL');
    const repetido = await post(`/periodos/${periodo}/equipos`, admin, { estudiante_ids: [estudiante!.estudianteId], tema_id: tema2, docente_ids: [docentes[0]!.docenteId], motivo: 'Acta 2' });
    expect(repetido.status).toBe(409);
    // Ni puede entrar a un grupo mientras conserve la asignación individual vigente.
    const [otro] = await estudiantes(1);
    expect(await codigoPg(attack.db.transaction(async (manager) => {
      const [grupo] = await manager.query(`INSERT INTO ${attack.s}."grupo" ("periodo_id","nombre","estado") VALUES ($1,'Grupo manual','ACTIVO') RETURNING "id"`, [periodo]) as Array<{ id: string }>;
      await manager.query(`INSERT INTO ${attack.s}."grupo_integrante" ("grupo_id","periodo_id","estudiante_id","rol_en_grupo") VALUES ($1,$2,$3,'REPRESENTANTE')`, [grupo!.id, periodo, otro!.estudianteId]);
      await manager.query(`INSERT INTO ${attack.s}."grupo_integrante" ("grupo_id","periodo_id","estudiante_id","rol_en_grupo") VALUES ($1,$2,$3,'INTEGRANTE')`, [grupo!.id, periodo, estudiante!.estudianteId]);
    }))).toBe('23505');

    // La anulación existente funciona sin postulación: tema PUBLICADO y tutor ANULADA.
    const anulada = await post(`/periodos/${periodo}/asignaciones-tema/${id}/anular`, admin, { causa: 'OTRA', motivo: 'Equipo reorganizado' });
    expect(anulada.status).toBe(200);
    expect(await uno(`SELECT t."estado"::text AS tema,(SELECT "estado"::text FROM ${attack.s}."asignacion_tutor" WHERE "asignacion_tema_id"=$1) AS tutor FROM ${attack.s}."tema" t WHERE t."id"=$2`, [id, tema])).toEqual({ tema: 'PUBLICADO', tutor: 'ANULADA' });
  });

  it('conforma un grupo con varios candidatos sin tutor y luego confirma y reemplaza desde los candidatos', async () => {
    const [rep, integrante] = await estudiantes(2);
    const tema = await crearTema(attack, docentes[0]!, 'PAREJA');
    const response = await post(`/periodos/${periodo}/equipos`, admin, { estudiante_ids: [rep!.estudianteId, integrante!.estudianteId], tema_id: tema, docente_ids: [docentes[1]!.docenteId, docentes[2]!.docenteId], nombre_grupo: 'Equipo Alfa', motivo: 'Acta 3' });
    expect(response.status).toBe(201);
    const equipo = (response.body as { equipo: { id: string; grupo: { id: string }; candidatos: Array<{ id: string; prioridad: number; docente: { id: string } }>; tutor_vigente: unknown; integrantes: Array<{ rol_en_grupo: string; pat: object }> } }).equipo;
    expect(equipo.tutor_vigente).toBeNull();
    expect(equipo.candidatos.map((c) => [c.prioridad, c.docente.id])).toEqual([[1, docentes[1]!.docenteId], [2, docentes[2]!.docenteId]]);
    expect(equipo.integrantes[0]).toMatchObject({ rol_en_grupo: 'REPRESENTANTE', pat: { datos_personales_registrados: false, ultima_generacion: null } });

    const ruta = `/periodos/${periodo}/equipos/${equipo.id}/tutor`;
    expect((await post(ruta, admin, { candidato_id: equipo.candidatos[1]!.id })).body).toMatchObject({ equipo: { tutor_vigente: { docente: { id: docentes[2]!.docenteId }, candidato_tutor_id: equipo.candidatos[1]!.id } } });
    expect((await post(ruta, admin, { candidato_id: equipo.candidatos[0]!.id })).status).toBe(409);
    expect((await post(ruta, admin, { candidato_id: equipo.candidatos[0]!.id, motivo: 'Elegido en el PAT' })).status).toBe(200);
    const historial = await attack.db.query(`SELECT "estado"::text AS estado,"docente_id" FROM ${attack.s}."asignacion_tutor" WHERE "asignacion_tema_id"=$1 ORDER BY "fecha_asignacion","estado"`, [equipo.id]) as Array<{ estado: string; docente_id: string }>;
    expect(historial.map((h) => h.estado).sort()).toEqual(['REEMPLAZADA', 'VIGENTE']);

    // Composición cerrada por la asignación aunque no haya postulación.
    const [extra] = await estudiantes(1);
    expect(await codigoPg(attack.db.query(`INSERT INTO ${attack.s}."grupo_integrante" ("grupo_id","periodo_id","estudiante_id","rol_en_grupo") VALUES ($1,$2,$3,'INTEGRANTE')`, [equipo.grupo.id, periodo, extra!.estudianteId]))).toBe('23514');
    // Los candidatos son historial.
    expect(await codigoPg(attack.db.query(`UPDATE ${attack.s}."candidato_tutor" SET "prioridad"=9 WHERE "id"=$1`, [equipo.candidatos[0]!.id]))).toBe('23514');
    expect(await codigoPg(attack.db.query(`DELETE FROM ${attack.s}."candidato_tutor" WHERE "id"=$1`, [equipo.candidatos[0]!.id]))).toBe('23514');
  });

  it('PostgreSQL rechaza asignaciones ADMIN inconsistentes y candidatos fuera de un equipo ADMIN', async () => {
    const [estudiante] = await estudiantes(1);
    const tema = await crearTema(attack, docentes[0]!, 'INDIVIDUAL');
    const insertar = (extra: string, valores: unknown[]) => attack.db.transaction((manager) => manager.query(
      `INSERT INTO ${attack.s}."asignacion_tema" ("tema_id","periodo_id","estudiante_id","aprobada_por_id","motivo","origen"${extra}) VALUES ($1,$2,$3,$4,'Directo','ADMIN'${valores.length ? ',$5' : ''})`,
      [tema, periodo, estudiante!.estudianteId, admin.usuarioId, ...valores],
    ));
    // Con postulación declarada no puede ser ADMIN (CHECK); un tema GRUPO no admite un estudiante.
    expect(await codigoPg(insertar(',"postulacion_id"', ['00000000-0000-4000-8000-000000000001']))).toMatch(/23514|23503/);
    const temaGrupo = await crearTema(attack, docentes[0]!, 'GRUPO');
    expect(await codigoPg(attack.db.transaction((manager) => manager.query(
      `INSERT INTO ${attack.s}."asignacion_tema" ("tema_id","periodo_id","estudiante_id","aprobada_por_id","motivo","origen") VALUES ($1,$2,$3,$4,'Directo','ADMIN')`,
      [temaGrupo, periodo, estudiante!.estudianteId, admin.usuarioId],
    )))).toBe('23514');
    // Un estudiante sin habilitación en el período tampoco.
    const ajeno = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
    expect(await codigoPg(attack.db.transaction((manager) => manager.query(
      `INSERT INTO ${attack.s}."asignacion_tema" ("tema_id","periodo_id","estudiante_id","aprobada_por_id","motivo","origen") VALUES ($1,$2,$3,$4,'Directo','ADMIN')`,
      [tema, periodo, ajeno.estudianteId, admin.usuarioId],
    )))).toBe('23514');
    // Un tutor CANDIDATO_CONFIRMADO exige un candidato del mismo trabajo y docente.
    const response = await post(`/periodos/${periodo}/equipos`, admin, { estudiante_ids: [estudiante!.estudianteId], tema_id: tema, docente_ids: [docentes[1]!.docenteId, docentes[2]!.docenteId], motivo: 'Acta 4' });
    expect(response.status).toBe(201);
    const equipo = (response.body as { equipo: { id: string; candidatos: Array<{ id: string }> } }).equipo;
    expect(await codigoPg(attack.db.query(
      `INSERT INTO ${attack.s}."asignacion_tutor" ("asignacion_tema_id","docente_id","tipo","candidato_tutor_id","asignada_por_id") VALUES ($1,$2,'CANDIDATO_CONFIRMADO',$3,$4)`,
      [equipo.id, docentes[0]!.docenteId, equipo.candidatos[0]!.id, admin.usuarioId],
    ))).toBe('23503');
  });

  it('anular un equipo grupal disuelve el grupo y permite volver a conformarlo con los mismos estudiantes', async () => {
    const [representante, integrante] = await estudiantes(2);
    const tema = await crearTema(attack, docentes[0]!, 'PAREJA');
    const creado = await post(`/periodos/${periodo}/equipos`, admin, {
      estudiante_ids: [representante!.estudianteId, integrante!.estudianteId], tema_id: tema, docente_ids: [docentes[0]!.docenteId], nombre_grupo: 'Equipo Beta', motivo: 'Acta 5',
    });
    expect(creado.status).toBe(201);
    const equipo = (creado.body as { equipo: { id: string; grupo: { id: string } } }).equipo;

    const anulada = await post(`/periodos/${periodo}/asignaciones-tema/${equipo.id}/anular`, admin, { causa: 'OTRA', motivo: 'Reorganizar equipo' });
    expect(anulada.status).toBe(200);
    expect(await uno<{ estado: string; activos: number; asignacion: string }>(
      `SELECT g."estado"::text AS estado,(SELECT count(*)::int FROM ${attack.s}."grupo_integrante" m WHERE m."grupo_id"=g."id" AND m."estado"='ACTIVO') AS activos,a."estado"::text AS asignacion
       FROM ${attack.s}."grupo" g JOIN ${attack.s}."asignacion_tema" a ON a."grupo_id"=g."id" WHERE g."id"=$1`,
      [equipo.grupo.id],
    )).toEqual({ estado: 'DISUELTO', activos: 0, asignacion: 'ANULADA' });

    const [ajeno] = await estudiantes(1);
    expect(await codigoPg(attack.db.query(
      `INSERT INTO ${attack.s}."grupo_integrante" ("grupo_id","periodo_id","estudiante_id","rol_en_grupo") VALUES ($1,$2,$3,'INTEGRANTE')`,
      [equipo.grupo.id, periodo, ajeno!.estudianteId],
    ))).toBe('23514');

    const deNuevo = await post(`/periodos/${periodo}/equipos`, admin, {
      estudiante_ids: [representante!.estudianteId, integrante!.estudianteId], tema_id: tema, docente_ids: [docentes[0]!.docenteId], nombre_grupo: 'Equipo Beta 2', motivo: 'Acta 6',
    });
    expect(deNuevo.status).toBe(201);
    const rearmado = (deNuevo.body as { equipo: { id: string; grupo: { id: string }; estado: string } }).equipo;
    expect(rearmado.grupo.id).not.toBe(equipo.grupo.id);
    expect(rearmado.estado).toBe('VIGENTE');
  });
});
