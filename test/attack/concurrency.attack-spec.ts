import request from 'supertest';
import { crearCuenta, tokenDe, type Cuenta } from './support/actors.js';
import { crearPeriodo, crearTema, habilitar } from './support/escenario.js';
import { bootAttackApp, type AttackApp } from './support/harness.js';

/** Regresiones de concurrencia (se esperan en verde): locks, índices únicos y disparadores. */
describe('Concurrencia (ataque)', () => {
  let attack: AttackApp;
  let docente: Cuenta;
  const tokens = new Map<string, string>();
  const auth = async (cuenta: Cuenta) => {
    if (!tokens.has(cuenta.usuarioId)) tokens.set(cuenta.usuarioId, await tokenDe(attack, cuenta));
    return `Bearer ${tokens.get(cuenta.usuarioId)!}`;
  };
  const post = async (path: string, cuenta: Cuenta, body: object = {}) => request(attack.baseUrl).post(path).set('Authorization', await auth(cuenta)).send(body);
  const estudiantes = (n: number) => Promise.all(Array.from({ length: n }, () => crearCuenta(attack, { rol: 'ESTUDIANTE' })));
  const crearGrupo = async (periodo: string, rep: Cuenta) => {
    const response = await post(`/periodos/${periodo}/grupos`, rep, { nombre: 'Grupo concurrente' });
    expect(response.status).toBe(201);
    return (response.body as { id: string }).id;
  };
  const invitar = async (periodo: string, grupo: string, rep: Cuenta, destino: Cuenta) => {
    const response = await post(`/periodos/${periodo}/grupos/${grupo}/invitaciones`, rep, { estudiante_destino_id: destino.estudianteId });
    expect(response.status).toBe(201);
    return (response.body as { id: string }).id;
  };
  const membresiasActivas = async (periodo: string, cuenta: Cuenta) => (await attack.db.query(
    `SELECT count(*)::int AS total FROM ${attack.s}."grupo_integrante" WHERE "periodo_id"=$1 AND "estudiante_id"=$2 AND "estado"='ACTIVO'`, [periodo, cuenta.estudianteId],
  ) as Array<{ total: number }>)[0]!.total;
  const exitos = (responses: request.Response[]) => responses.filter((response) => response.status >= 200 && response.status < 300).length;

  beforeAll(async () => {
    attack = await bootAttackApp();
    docente = await crearCuenta(attack, { rol: 'DOCENTE' });
  });
  afterAll(async () => { await attack?.close(); });

  it('[concurrencia] 20 aceptaciones simultáneas de la misma invitación producen una sola membresía', async () => {
    const periodo = await crearPeriodo(attack);
    const [rep, destino] = await estudiantes(2);
    await habilitar(attack, periodo, rep!, destino!);
    const invitacion = await invitar(periodo, await crearGrupo(periodo, rep!), rep!, destino!);
    await auth(destino!);
    const responses = await Promise.all(Array.from({ length: 20 }, () => post(`/periodos/${periodo}/invitaciones/${invitacion}/aceptar`, destino!)));
    expect(exitos(responses)).toBe(1);
    expect(responses.every((response) => response.status < 500)).toBe(true);
    expect(await membresiasActivas(periodo, destino!)).toBe(1);
  });

  it('[concurrencia] 20 postulaciones simultáneas del mismo estudiante dejan una sola activa', async () => {
    const periodo = await crearPeriodo(attack);
    const [estudiante] = await estudiantes(1);
    await habilitar(attack, periodo, estudiante!);
    const tema = await crearTema(attack, docente, 'INDIVIDUAL');
    await auth(estudiante!);
    const responses = await Promise.all(Array.from({ length: 20 }, () => post(`/periodos/${periodo}/postulaciones`, estudiante!, { tema_id: tema, modalidad: 'INDIVIDUAL', tutores_propuestos: [docente.docenteId] })));
    expect(exitos(responses)).toBe(1);
    expect(responses.every((response) => response.status < 500)).toBe(true);
    const rows = await attack.db.query(`SELECT count(*)::int AS total FROM ${attack.s}."postulacion" WHERE "periodo_id"=$1 AND "estudiante_id"=$2 AND "estado" IN ('PENDIENTE','EN_CONFLICTO','ACEPTADA')`, [periodo, estudiante!.estudianteId]) as Array<{ total: number }>;
    expect(rows[0]!.total).toBe(1);
  });

  it('[concurrencia] aceptar 20 invitaciones de grupos distintos a la vez deja al estudiante en un solo grupo', async () => {
    const periodo = await crearPeriodo(attack);
    const [destino, ...reps] = await estudiantes(21);
    await habilitar(attack, periodo, destino!, ...reps);
    const invitaciones: string[] = [];
    for (const rep of reps) invitaciones.push(await invitar(periodo, await crearGrupo(periodo, rep), rep, destino!));
    await auth(destino!);
    const responses = await Promise.all(invitaciones.map((id) => post(`/periodos/${periodo}/invitaciones/${id}/aceptar`, destino!)));
    expect(exitos(responses)).toBe(1);
    expect(responses.every((response) => response.status < 500)).toBe(true);
    expect(await membresiasActivas(periodo, destino!)).toBe(1);
  });

  it('[concurrencia] aceptaciones simultáneas no superan el máximo de integrantes del período', async () => {
    const periodo = await crearPeriodo(attack, { max: 3 });
    const [rep, ...invitados] = await estudiantes(5);
    await habilitar(attack, periodo, rep!, ...invitados);
    const grupo = await crearGrupo(periodo, rep!);
    const invitaciones: Array<[string, Cuenta]> = [];
    for (const invitado of invitados) {
      const response = await post(`/periodos/${periodo}/grupos/${grupo}/invitaciones`, rep!, { estudiante_destino_id: invitado.estudianteId });
      if (response.status === 201) invitaciones.push([(response.body as { id: string }).id, invitado]);
    }
    expect(invitaciones.length).toBeGreaterThanOrEqual(3);
    for (const [, invitado] of invitaciones) await auth(invitado);
    const responses = await Promise.all(invitaciones.map(([id, invitado]) => post(`/periodos/${periodo}/invitaciones/${id}/aceptar`, invitado)));
    expect(responses.every((response) => response.status < 500)).toBe(true);
    const rows = await attack.db.query(`SELECT count(*)::int AS total FROM ${attack.s}."grupo_integrante" WHERE "grupo_id"=$1 AND "estado"='ACTIVO'`, [grupo]) as Array<{ total: number }>;
    expect(rows[0]!.total).toBeLessThanOrEqual(3);
  });

  describe('bloqueos de tutores propuestos (S3 / M4)', () => {
    /** Estudiante con su propio período y tema: solo comparte con los demás el docente propuesto. */
    const proponente = async () => {
      const periodo = await crearPeriodo(attack);
      const [estudiante] = await estudiantes(1);
      await habilitar(attack, periodo, estudiante!);
      const tema = await crearTema(attack, docente, 'INDIVIDUAL');
      await auth(estudiante!);
      return { periodo, estudiante: estudiante!, tema };
    };
    const proponer = async (p: Awaited<ReturnType<typeof proponente>>, tutor: Cuenta) =>
      post(`/periodos/${p.periodo}/postulaciones`, p.estudiante, { tema_id: p.tema, modalidad: 'INDIVIDUAL', tutores_propuestos: [tutor.docenteId] });
    /** Resuelve con `pendiente` si la promesa no terminó en `ms`; no la cancela. */
    const sigueEsperando = async (promesa: Promise<unknown>, ms: number) => {
      let temporizador: NodeJS.Timeout | undefined;
      const resultado = await Promise.race([promesa.then(() => 'terminada', () => 'terminada'), new Promise<string>((resolve) => { temporizador = setTimeout(() => resolve('pendiente'), ms); })]);
      clearTimeout(temporizador);
      return resultado === 'pendiente';
    };
    /** Transacción abierta que registra una postulación con `tutor` por SQL directo (dispara `validar_tutor_propuesto`). */
    const propuestaRetenida = async (tutor: Cuenta) => {
      const p = await proponente();
      const runner = attack.db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      const [row] = await runner.query(
        `INSERT INTO ${attack.s}."postulacion" ("tema_id","periodo_id","estudiante_id","num_integrantes","registrada_por_id","estado") VALUES ($1,$2,$3,1,$4,'PENDIENTE') RETURNING "id"`,
        [p.tema, p.periodo, p.estudiante.estudianteId, p.estudiante.usuarioId],
      ) as Array<{ id: string }>;
      await runner.query(`INSERT INTO ${attack.s}."tutor_propuesto" ("postulacion_id","docente_id","orden_prioridad") VALUES ($1,$2,1)`, [row!.id, tutor.docenteId]);
      return {
        async commit() { try { await runner.commitTransaction(); } finally { await runner.release(); } },
        async rollback() { try { if (runner.isTransactionActive) await runner.rollbackTransaction(); } finally { await runner.release(); } },
      };
    };
    const conNowait = async (sql: string, params: unknown[]) => {
      const runner = attack.db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try { await runner.query(sql, params); return 'ok'; }
      catch (error: unknown) { return (error as { driverError?: { code?: string } }).driverError?.code ?? 'error'; }
      finally { await runner.rollbackTransaction().catch(() => undefined); await runner.release(); }
    };

    it('[concurrencia] una propuesta en curso solo retiene bloqueos compartidos sobre docente y usuario', async () => {
      const tutor = await crearCuenta(attack, { rol: 'DOCENTE' });
      const retenida = await propuestaRetenida(tutor);
      try {
        // 55P03 = lock_not_available. Con FOR UPDATE en el disparador, incluso FOR SHARE falla.
        expect(await conNowait(`SELECT 1 FROM ${attack.s}."docente" d JOIN ${attack.s}."usuario" u ON u."id"=d."usuario_id" WHERE d."id"=$1 FOR SHARE OF d,u NOWAIT`, [tutor.docenteId])).toBe('ok');
        expect(await conNowait(`SELECT 1 FROM ${attack.s}."usuario" WHERE "id"=$1 FOR UPDATE NOWAIT`, [tutor.usuarioId])).toBe('55P03');
        expect(await conNowait(`SELECT 1 FROM ${attack.s}."docente" WHERE "id"=$1 FOR UPDATE NOWAIT`, [tutor.docenteId])).toBe('55P03');
      } finally { await retenida.rollback(); }
    });

    it('[concurrencia] 20 estudiantes proponen a la vez al mismo tutor sin bloquearse ni interbloquearse, aun con otra propuesta abierta', async () => {
      const tutor = await crearCuenta(attack, { rol: 'DOCENTE' });
      const proponentes: Array<Awaited<ReturnType<typeof proponente>>> = [];
      for (let index = 0; index < 20; index++) proponentes.push(await proponente());
      const retenida = await propuestaRetenida(tutor);
      let responses: request.Response[];
      try {
        const envio = Promise.all(proponentes.map((p) => proponer(p, tutor)));
        // Con bloqueos de escritura en el servicio o en el disparador, todas esperarían a la propuesta retenida.
        expect(await sigueEsperando(envio, 15_000)).toBe(false);
        responses = await envio;
      } finally { await retenida.rollback(); }
      const estados = responses.map((response) => response.status);
      expect(estados.filter((status) => status !== 201), JSON.stringify(responses.filter((response) => response.status !== 201).map((response) => response.body))).toEqual([]);
      const rows = await attack.db.query(`SELECT count(*)::int AS total FROM ${attack.s}."tutor_propuesto" WHERE "docente_id"=$1`, [tutor.docenteId]) as Array<{ total: number }>;
      expect(rows[0]!.total).toBe(20);
    });

    it('[concurrencia] desactivar al tutor espera a la propuesta en curso, y una propuesta posterior a la desactivación se rechaza', async () => {
      const admin = await crearCuenta(attack, { rol: 'ADMIN' });
      const tutor = await crearCuenta(attack, { rol: 'DOCENTE' });
      await auth(admin);
      // 1) La propuesta llega primero: la desactivación espera a que confirme.
      const retenida = await propuestaRetenida(tutor);
      let desactivar: Promise<request.Response>;
      try {
        desactivar = request(attack.baseUrl).patch(`/docentes/${tutor.docenteId}`).set('Authorization', await auth(admin)).send({ estado: 'INACTIVO' }).then((response) => response);
        expect(await sigueEsperando(desactivar, 2_000)).toBe(true);
        await retenida.commit();
      } catch (error: unknown) { await retenida.rollback(); throw error; }
      expect((await desactivar).status).toBe(200);
      // 2) Cuenta ya inactiva: una propuesta nueva se rechaza.
      const tarde = await proponente();
      expect((await proponer(tarde, tutor)).status).toBe(409);
    });

    it('[concurrencia] una propuesta que espera a una desactivación aún no confirmada falla al confirmarse esta (ninguna propuesta apunta a un tutor ya inactivo)', async () => {
      const tutor = await crearCuenta(attack, { rol: 'DOCENTE' });
      const p = await proponente();
      const runner = attack.db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      let envio: Promise<request.Response>;
      try {
        // Mismo orden que DocentesService.update: usuario y luego docente FOR UPDATE, y el cambio de estado.
        await runner.query(`SELECT 1 FROM ${attack.s}."usuario" WHERE "id"=$1 FOR UPDATE`, [tutor.usuarioId]);
        await runner.query(`SELECT 1 FROM ${attack.s}."docente" WHERE "id"=$1 FOR UPDATE`, [tutor.docenteId]);
        await runner.query(`UPDATE ${attack.s}."usuario" SET "estado"='INACTIVO' WHERE "id"=$1`, [tutor.usuarioId]);
        envio = proponer(p, tutor);
        expect(await sigueEsperando(envio, 2_000)).toBe(true);
        await runner.commitTransaction();
      } catch (error: unknown) {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        throw error;
      } finally { await runner.release(); }
      expect((await envio).status).toBe(409);
      const rows = await attack.db.query(
        `SELECT count(*)::int AS total FROM ${attack.s}."tutor_propuesto" tp JOIN ${attack.s}."docente" d ON d."id"=tp."docente_id" JOIN ${attack.s}."usuario" u ON u."id"=d."usuario_id" WHERE tp."docente_id"=$1 AND u."estado"<>'ACTIVO'`,
        [tutor.docenteId],
      ) as Array<{ total: number }>;
      expect(rows[0]!.total).toBe(0);
    });
  });
});
