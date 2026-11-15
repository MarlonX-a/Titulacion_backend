import request from 'supertest';
import { crearCuenta, tokenDe, type Cuenta } from './support/actors.js';
import { crearPeriodo, crearTema, habilitar, sembrarEscenario, type EscenarioBase } from './support/escenario.js';
import { bootAttackApp, uuid, type AttackApp } from './support/harness.js';

describe('Control de acceso y privacidad (ataque)', () => {
  let attack: AttackApp;
  let e: EscenarioBase;
  const get = async (path: string, cuenta: Cuenta) => request(attack.baseUrl).get(path).set('Authorization', `Bearer ${await tokenDe(attack, cuenta)}`);
  const post = async (path: string, cuenta: Cuenta, body: object) => request(attack.baseUrl).post(path).set('Authorization', `Bearer ${await tokenDe(attack, cuenta)}`).send(body);
  /** El cuerpo serializado no contiene la cédula ni la matrícula de otro estudiante. */
  const expectSinIdentificadores = (body: unknown, ...otros: Cuenta[]) => {
    const text = JSON.stringify(body);
    for (const otro of otros) {
      expect(text, 'la respuesta expone la cédula/matrícula de otro estudiante').not.toContain(otro.cedula!);
    }
  };

  beforeAll(async () => {
    attack = await bootAttackApp();
    e = await sembrarEscenario(attack);
  });
  afterAll(async () => { await attack?.close(); });

  it('[M1] estudiante sin perfil no puede leer una postulación grupal ajena', async () => {
    const response = await get(`/periodos/${e.periodoAbierto}/postulaciones/${e.postulacionGrupalAbierta}`, e.sinPerfil);
    expect(response.status).toBe(404);
  });

  it('[M1] control: un integrante activo sí lee su postulación grupal', async () => {
    const response = await get(`/periodos/${e.periodoAbierto}/postulaciones/${e.postulacionGrupalAbierta}`, e.estL);
    expect(response.status).toBe(200);
  });

  it('[M2] ex-integrante no puede leer la asignación de tema del grupo', async () => {
    const response = await get(`/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionGrupal}`, e.exIntegrante);
    expect(response.status).toBe(404);
  });

  it('[M2] ex-integrante no puede listar ni leer los documentos PAT del grupo', async () => {
    const base = `/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionGrupal}/documentos-pat`;
    expect((await get(base, e.exIntegrante)).status).toBe(404);
    expect((await get(`${base}/ultima`, e.exIntegrante)).status).toBe(404);
    expect((await get(`${base}/${e.documentoGrupal}`, e.exIntegrante)).status).toBe(404);
  });

  it('[M2] ex-integrante no puede leer la asignación de tutor del grupo', async () => {
    const byId = await get(`/periodos/${e.periodoCerrado}/asignaciones-tutor/${e.asignacionTutor}`, e.exIntegrante);
    expect(byId.status).toBe(404);
    const mine = await get(`/periodos/${e.periodoCerrado}/asignaciones-tutor/me`, e.exIntegrante);
    expect(JSON.stringify(mine.body)).not.toContain(e.asignacionTutor);
  });

  it('[M2] ex-integrante no ve la asignación del grupo en asignaciones-tema/me', async () => {
    const response = await get(`/periodos/${e.periodoCerrado}/asignaciones-tema/me`, e.exIntegrante);
    expect(JSON.stringify(response.body)).not.toContain(e.asignacionGrupal);
  });

  it('[M2] la asignación del grupo no lista al ex-integrante como participante', async () => {
    const response = await get(`/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionGrupal}`, e.estB);
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(e.exIntegrante.estudianteId!);
  });

  it('[M2] control: el integrante activo sí lee la asignación y el PAT', async () => {
    expect((await get(`/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionGrupal}`, e.estB)).status).toBe(200);
    expect((await get(`/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionGrupal}/documentos-pat`, e.estB)).status).toBe(200);
  });

  it('[M4] una postulación con más de 5 tutores propuestos responde 400', async () => {
    const periodo = await crearPeriodo(attack);
    const estudiante = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
    await habilitar(attack, periodo, estudiante);
    const tema = await crearTema(attack, e.docente, 'INDIVIDUAL');
    const extra = await Promise.all(Array.from({ length: 4 }, () => crearCuenta(attack, { rol: 'DOCENTE' })));
    const tutores = [e.docente, e.docenteAjeno, ...extra].map((docente) => docente.docenteId!);
    const response = await post(`/periodos/${periodo}/postulaciones`, estudiante, { tema_id: tema, modalidad: 'INDIVIDUAL', tutores_propuestos: tutores });
    expect(response.status).toBe(400);
    const rows = await attack.db.query(`SELECT count(*)::int AS total FROM ${attack.s}."postulacion" WHERE "tema_id"=$1`, [tema]) as Array<{ total: number }>;
    expect(rows[0]!.total).toBe(0);
  });

  it('[C1] candidatos-invitacion no expone cédula ni matrícula de compañeros', async () => {
    const periodo = await crearPeriodo(attack);
    const [yo, otro] = await Promise.all([crearCuenta(attack, { rol: 'ESTUDIANTE' }), crearCuenta(attack, { rol: 'ESTUDIANTE' })]);
    await habilitar(attack, periodo, yo!, otro!);
    const response = await get(`/periodos/${periodo}/habilitados/candidatos-invitacion`, yo!);
    expect(response.status).toBe(200);
    expect((response.body as { total: number }).total, 'el compañero debe aparecer como candidato').toBeGreaterThanOrEqual(1);
    expectSinIdentificadores(response.body, otro!);
  });

  it('[C1] candidatos-invitacion no expone condición, requisito ni observación de ingreso de compañeros', async () => {
    const periodo = await crearPeriodo(attack);
    const [yo, otro] = await Promise.all([crearCuenta(attack, { rol: 'ESTUDIANTE' }), crearCuenta(attack, { rol: 'ESTUDIANTE' })]);
    await habilitar(attack, periodo, yo!, otro!);
    const marca = `observacion-privada-${uuid()}`;
    await attack.db.query(`UPDATE ${attack.s}."estudiante_habilitado" SET "observacion_ingreso"=$1 WHERE "periodo_id"=$2 AND "estudiante_id"=$3`, [marca, periodo, otro!.estudianteId]);
    const response = await get(`/periodos/${periodo}/habilitados/candidatos-invitacion`, yo!);
    expect(response.status).toBe(200);
    const data = (response.body as { data: Array<Record<string, unknown>> }).data;
    expect(data.length, 'el compañero debe aparecer como candidato').toBeGreaterThanOrEqual(1);
    for (const fila of data) {
      expect(fila).not.toHaveProperty('condicion_ingreso');
      expect(fila).not.toHaveProperty('requisito_pendiente');
      expect(fila).not.toHaveProperty('observacion_ingreso');
    }
    const texto = JSON.stringify(response.body);
    expect(texto).not.toContain(marca);
    expect(texto).not.toContain('Requisito pendiente');
  });

  it('[C1] control: el propio estudiante sí ve su condición, requisito y observación de ingreso', async () => {
    const periodo = await crearPeriodo(attack);
    const yo = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
    await habilitar(attack, periodo, yo);
    const response = await get(`/periodos/${periodo}/habilitados/me`, yo);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ condicion_ingreso: 'CONDICIONADO', requisito_pendiente: 'Requisito pendiente', observacion_ingreso: null });
  });

  it('[C1] invitaciones no exponen cédula ni matrícula del destinatario ni del emisor', async () => {
    const periodo = await crearPeriodo(attack);
    const [rep, destino] = await Promise.all([crearCuenta(attack, { rol: 'ESTUDIANTE' }), crearCuenta(attack, { rol: 'ESTUDIANTE' })]);
    await habilitar(attack, periodo, rep!, destino!);
    const grupo = await post(`/periodos/${periodo}/grupos`, rep!, { nombre: 'Grupo privacidad' });
    expect(grupo.status).toBe(201);
    const grupoId = (grupo.body as { id: string }).id;
    const invitacion = await post(`/periodos/${periodo}/grupos/${grupoId}/invitaciones`, rep!, { estudiante_destino_id: destino!.estudianteId });
    expect(invitacion.status).toBe(201);
    expectSinIdentificadores(invitacion.body, destino!);
    const recibidas = await get(`/periodos/${periodo}/invitaciones/me`, destino!);
    expectSinIdentificadores(recibidas.body, rep!);
  });

  it('[C1] el detalle del grupo no expone la cédula de los compañeros', async () => {
    const response = await get(`/periodos/${e.periodoAbierto}/grupos/${e.grupoAbierto}`, e.estK);
    expect(response.status).toBe(200);
    expectSinIdentificadores(response.body, e.estL);
  });

  it('[C1] docente y compañero no ven la cédula de los estudiantes en asignaciones y postulaciones', async () => {
    const docente = await get(`/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionGrupal}`, e.docente);
    expect(docente.status).toBe(200);
    expectSinIdentificadores(docente.body, e.estA, e.estB);
    const postulacion = await get(`/periodos/${e.periodoCerrado}/postulaciones/${e.postulacionGrupalCerrada}`, e.docente);
    expectSinIdentificadores(postulacion.body, e.estA, e.estB);
    const companero = await get(`/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionGrupal}`, e.estB);
    expectSinIdentificadores(companero.body, e.estA);
  });

  it('[M6] nombre de grupo con URL responde 400', async () => {
    const periodo = await crearPeriodo(attack);
    const estudiante = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
    await habilitar(attack, periodo, estudiante);
    const response = await post(`/periodos/${periodo}/grupos`, estudiante, { nombre: 'Verifica tu cuenta en https://evil.example/login' });
    expect(response.status).toBe(400);
  });

  it('[M6] nombre de grupo con caracteres bidi responde 400', async () => {
    const periodo = await crearPeriodo(attack);
    const estudiante = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
    await habilitar(attack, periodo, estudiante);
    const response = await post(`/periodos/${periodo}/grupos`, estudiante, { nombre: 'Grupo \u202Efdp.exe' });
    expect(response.status).toBe(400);
  });

  it('[B] invitar ids arbitrarios devuelve un único mensaje genérico de elegibilidad', async () => {
    const periodo = await crearPeriodo(attack);
    const [rep, conGrupo, companero] = await Promise.all([1, 2, 3].map(() => crearCuenta(attack, { rol: 'ESTUDIANTE' })));
    const noHabilitado = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
    await habilitar(attack, periodo, rep!, conGrupo!, companero!);
    const g1 = await post(`/periodos/${periodo}/grupos`, rep!, { nombre: 'Grupo oráculo' });
    expect(g1.status).toBe(201);
    expect((await post(`/periodos/${periodo}/grupos`, conGrupo!, { nombre: 'Otro grupo' })).status).toBe(201);
    const grupo = (g1.body as { id: string }).id;
    const objetivos = [uuid(), noHabilitado.estudianteId!, e.estC.estudianteId!, conGrupo!.estudianteId!];
    const respuestas = [];
    for (const objetivo of objetivos) respuestas.push(await post(`/periodos/${periodo}/grupos/${grupo}/invitaciones`, rep!, { estudiante_destino_id: objetivo }));
    for (const respuesta of respuestas) expect(respuesta.status).toBeGreaterThanOrEqual(400);
    expect(new Set(respuestas.map((r) => r.status)).size, 'el código HTTP distingue la causa').toBe(1);
    expect(new Set(respuestas.map((r) => JSON.stringify((r.body as { message?: unknown }).message))).size, 'el mensaje distingue la causa').toBe(1);
  });

  it('[regresión] los recursos de un período no se leen a través de otro período', async () => {
    expect((await get(`/periodos/${e.periodoAbierto}/asignaciones-tema/${e.asignacionGrupal}`, e.admin)).status).toBe(404);
    expect((await get(`/periodos/${e.periodoAbierto}/postulaciones/${e.postulacionGrupalCerrada}`, e.admin)).status).toBe(404);
    expect((await get(`/periodos/${e.periodoAbierto}/asignaciones-tema/${e.asignacionGrupal}/documentos-pat`, e.admin)).status).toBe(404);
    expect((await get(`/periodos/${e.periodoAbierto}/asignaciones-tutor/${e.asignacionTutor}`, e.admin)).status).toBe(404);
  });

  it('[regresión] un docente no relacionado no lee asignaciones, PAT ni postulaciones ajenas', async () => {
    expect((await get(`/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionGrupal}`, e.docenteAjeno)).status).toBe(404);
    expect((await get(`/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionGrupal}/documentos-pat`, e.docenteAjeno)).status).toBe(404);
    expect((await get(`/periodos/${e.periodoCerrado}/postulaciones/${e.postulacionGrupalCerrada}`, e.docenteAjeno)).status).toBe(404);
  });

  it('[regresión] un estudiante ajeno no lee la asignación ni el PAT de otro trabajo', async () => {
    expect((await get(`/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionIndividual}`, e.estA)).status).toBe(404);
    expect((await get(`/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionGrupal}/documentos-pat`, e.estE)).status).toBe(404);
    expect((await get(`/periodos/${e.periodoAbierto}/postulaciones/${e.postulacionGrupalAbierta}`, e.estE)).status).toBe(404);
  });
});
