import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import request from 'supertest';
import { vi } from 'vitest';
import { crearCuenta, login, tokenDe, type Cuenta } from './support/actors.js';
import { REPO_ROOT, bootAttackApp, uuid, type AttackApp } from './support/harness.js';

/** Contraseña definitiva que cumple la política S1 (12+ caracteres, sin datos personales). */
const NUEVA_CLAVE = 'Marea-Volcan-Zafiro-41';
const TEMPORAL = 'Temporal-Inicial-2026-qz';
const IMPORT_TTL_HORAS = 6;
const UUID_INVALIDO = 'esto-no-es-un-uuid';

async function importDist<T>(relativePath: string): Promise<T> {
  return await import(pathToFileURL(join(REPO_ROOT, 'dist', relativePath)).href) as T;
}

describe('Primer acceso con cédula: mitigaciones (ataque)', () => {
  let attack: AttackApp;

  beforeAll(async () => { attack = await bootAttackApp({ IMPORT_TEMP_TTL_HOURS: String(IMPORT_TTL_HORAS) }); });
  afterAll(async () => { await attack?.close(); });
  beforeEach(async () => { await attack.flushLimiter(); });

  /** Estudiante con clave temporal vigente (como el que deja la importación). */
  const estudianteNuevo = () => crearCuenta(attack, { rol: 'ESTUDIANTE', requiereCambio: true, password: TEMPORAL });
  const primerAcceso = async (cuenta: Cuenta, ip: string) => {
    const sesion = await login(attack, cuenta.email, TEMPORAL, undefined, { 'X-Forwarded-For': ip });
    expect(sesion.status, 'el login con la clave temporal debe abrir el primer acceso').toBe(200);
    return request(attack.baseUrl).post('/auth/change-initial-password').set('X-Forwarded-For', ip)
      .set('Authorization', `Bearer ${sesion.accessToken!}`).send({ password: NUEVA_CLAVE });
  };
  const notificaciones = (usuarioId: string) => attack.db.query(
    `SELECT n."tipo", n."titulo", n."mensaje", n."canal", n."entidad_tipo", e."estado" AS entrega
       FROM ${attack.s}."notificacion" n LEFT JOIN ${attack.s}."entrega_correo_notificacion" e ON e."notificacion_id"=n."id"
      WHERE n."usuario_id"=$1 ORDER BY n."canal"`, [usuarioId]) as Promise<Array<{ tipo: string; titulo: string; mensaje: string; canal: string; entidad_tipo: string; entrega: string | null }>>;

  describe('[C1] vigencia de la clave temporal', () => {
    it('[C1] una clave temporal vencida se rechaza con el 401 genérico', async () => {
      const estudiante = await estudianteNuevo();
      expect((await login(attack, estudiante.email, TEMPORAL)).status).toBe(200);
      await attack.db.query(`UPDATE ${attack.s}."credencial_usuario" SET "temporal_expira_en"=now() - interval '1 minute' WHERE "usuario_id"=$1`, [estudiante.usuarioId]);
      const vencida = await login(attack, estudiante.email, TEMPORAL);
      expect(vencida.status).toBe(401);
      expect(vencida.body.message).toBe('Correo o contraseña incorrectos.');
    });

    it(`[C1] una importación nueva fija la vigencia en IMPORT_TEMP_TTL_HOURS (${IMPORT_TTL_HORAS} h) y vencida solo entra reenviar-acceso`, async () => {
      const cedula = '1316661675';
      const email = `e${cedula}@live.uleam.edu.ec`;
      const admin = await crearCuenta(attack, { rol: 'ADMIN' });
      const facultad = await attack.db.query(`SELECT c."id" AS carrera_id, c."facultad_id" FROM ${attack.s}."carrera" c WHERE c."codigo"='INGENIERIA_EN_SOFTWARE'`) as Array<{ carrera_id: string; facultad_id: string }>;
      const now = Date.now();
      const [periodo] = await attack.db.query(
        `INSERT INTO ${attack.s}."periodo_titulacion" ("codigo","nombre","fecha_inicio_postulacion","fecha_fin_postulacion","fecha_inicio_titulacion","estado","max_integrantes_default","facultad_id")
         VALUES ('ATK-IMP','Período de importación',$1,$2,$3,'BORRADOR',3,$4) RETURNING "id"`,
        [new Date(now + 86_400_000), new Date(now + 7 * 86_400_000), new Date(now + 30 * 86_400_000), facultad[0]!.facultad_id],
      ) as Array<{ id: string }>;
      const buffer = Buffer.from('libro-de-prueba');
      const sha = createHash('sha256').update(buffer).digest('hex');
      const filas = [{ fila: 7, email, nombres: 'ORLEY ANTONIO', apellidos: 'ZAMBRANO VERA', cedula, matricula: cedula, nivel: 7, habilitado: true }];

      const { AlmacenamientoService } = await importDist<{ AlmacenamientoService: new (...args: never[]) => { readPrivate(key: string): Promise<Buffer> } }>('almacenamiento/almacenamiento.service.js');
      const { ImportacionesService } = await importDist<{ ImportacionesService: new (...args: never[]) => { importConfirmed(id: string): Promise<void> } }>('importaciones/importaciones.service.js');
      const lectura = vi.spyOn(attack.app.get(AlmacenamientoService), 'readPrivate').mockResolvedValue(buffer);
      try {
        const [preparacion] = await attack.db.query(
          `INSERT INTO ${attack.s}."preparacion_importacion" ("periodo_id","tipo","carrera_id","solicitada_por_id","nombre_archivo","ruta_almacenamiento","sha256","estado","total_filas","filas","errores","expira_en")
           VALUES ($1,'ESTUDIANTES',$2,$3,'estudiantes.xlsx','clave-inexistente',$4,'EN_COLA',1,$5::jsonb,'[]'::jsonb,now() + interval '1 hour') RETURNING "id"`,
          [periodo!.id, facultad[0]!.carrera_id, admin.usuarioId, sha, JSON.stringify(filas)],
        ) as Array<{ id: string }>;
        const antes = Date.now();
        await attack.app.get(ImportacionesService).importConfirmed(preparacion!.id);
        const despues = Date.now();

        const [credencial] = await attack.db.query(
          `SELECT c."requiere_cambio", c."temporal_expira_en", o."expira_en" AS correo_expira_en
             FROM ${attack.s}."credencial_usuario" c JOIN ${attack.s}."usuario" u ON u."id"=c."usuario_id"
             LEFT JOIN ${attack.s}."correo_salida" o ON o."usuario_id"=u."id" AND o."tipo"='ACCESO' WHERE u."email"=$1`, [email]) as Array<{ requiere_cambio: boolean; temporal_expira_en: Date; correo_expira_en: Date }>;
        expect(credencial!.requiere_cambio).toBe(true);
        const ttl = IMPORT_TTL_HORAS * 3_600_000;
        for (const expira of [credencial!.temporal_expira_en, credencial!.correo_expira_en]) {
          expect(expira.getTime()).toBeGreaterThanOrEqual(antes + ttl - 5_000);
          expect(expira.getTime()).toBeLessThanOrEqual(despues + ttl + 5_000);
        }
        // La cédula sigue siendo la clave inicial por decisión del propietario...
        expect((await login(attack, email, cedula)).status).toBe(200);
        // ...pero deja de servir cuando vence.
        await attack.db.query(`UPDATE ${attack.s}."credencial_usuario" SET "temporal_expira_en"=now() - interval '1 minute' WHERE "usuario_id"=(SELECT "id" FROM ${attack.s}."usuario" WHERE "email"=$1)`, [email]);
        expect((await login(attack, email, cedula)).status).toBe(401);
      } finally { lectura.mockRestore(); }
    });
  });

  describe('[C1] aviso al titular al completar el primer acceso', () => {
    it('[C1] crea un aviso en app y un correo pendiente con texto neutro, sin IP, clave ni token', async () => {
      const estudiante = await estudianteNuevo();
      const ip = '203.0.113.21';
      expect((await primerAcceso(estudiante, ip)).status).toBe(204);
      const avisos = await notificaciones(estudiante.usuarioId);
      expect(avisos.map((aviso) => aviso.canal)).toEqual(['EN_APP', 'EMAIL']);
      expect(avisos.every((aviso) => aviso.tipo === 'CUENTA_ACTIVADA' && aviso.entidad_tipo === 'usuario')).toBe(true);
      expect(avisos.find((aviso) => aviso.canal === 'EMAIL')!.entrega).toBe('PENDIENTE');
      const texto = avisos.map((aviso) => `${aviso.titulo} ${aviso.mensaje}`).join(' ');
      expect(texto).toMatch(/activada/i);
      expect(texto).toMatch(/administraci/i);
      for (const secreto of [ip, NUEVA_CLAVE, TEMPORAL, 'token', 'código']) expect(texto.toLowerCase()).not.toContain(secreto.toLowerCase());
    });

    it('[C1] el aviso solo lo ve su titular por la API de notificaciones', async () => {
      const estudiante = await estudianteNuevo();
      const otro = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      expect((await primerAcceso(estudiante, '203.0.113.22')).status).toBe(204);
      const propias = await request(attack.baseUrl).get('/notificaciones').set('Authorization', `Bearer ${await tokenDe(attack, estudiante)}`);
      expect(propias.status).toBe(200);
      expect((propias.body as { data: Array<{ tipo: string }> }).data.map((aviso) => aviso.tipo)).toContain('CUENTA_ACTIVADA');
      expect((await notificaciones(otro.usuarioId))).toHaveLength(0);
    });
  });

  describe('[C1] alerta a ADMIN por activaciones masivas desde una dirección', () => {
    it('[C1] a la tercera activación desde la misma IP avisa una sola vez a cada ADMIN activo', async () => {
      const ip = '203.0.113.50';
      const adminActivo = await crearCuenta(attack, { rol: 'ADMIN' });
      const adminInactivo = await crearCuenta(attack, { rol: 'ADMIN', estado: 'INACTIVO' });
      const docente = await crearCuenta(attack, { rol: 'DOCENTE' });
      const eventos = () => attack.db.query(
        `SELECT "valores_nuevos", "ip_origen" FROM ${attack.s}."auditoria" WHERE "accion"='PRIMER_ACCESO_MASIVO'`) as Promise<Array<{ valores_nuevos: Record<string, unknown>; ip_origen: string | null }>>;
      const alertas = (usuarioId: string) => attack.db.query(
        `SELECT "tipo", "titulo", "mensaje", "canal", "entidad_tipo" FROM ${attack.s}."notificacion" WHERE "usuario_id"=$1 AND "tipo"='ACTIVACIONES_MASIVAS'`, [usuarioId]) as Promise<Array<{ tipo: string; titulo: string; mensaje: string; canal: string; entidad_tipo: string }>>;

      for (let i = 0; i < 2; i += 1) expect((await primerAcceso(await estudianteNuevo(), ip)).status).toBe(204);
      expect(await eventos(), 'no debe alertar antes de la tercera activación').toHaveLength(0);
      expect(await alertas(adminActivo.usuarioId)).toHaveLength(0);

      expect((await primerAcceso(await estudianteNuevo(), ip)).status).toBe(204);
      const registrados = await eventos();
      expect(registrados).toHaveLength(1);
      expect(registrados[0]!.ip_origen).toBe(ip);
      expect(registrados[0]!.valores_nuevos).toMatchObject({ ip, activaciones: 3, automatico: true });
      expect(JSON.stringify(registrados[0]!.valores_nuevos)).not.toMatch(/password|clave|token/i);
      const aviso = await alertas(adminActivo.usuarioId);
      expect(aviso).toEqual([expect.objectContaining({ canal: 'EN_APP', entidad_tipo: 'seguridad' })]);
      expect(`${aviso[0]!.titulo} ${aviso[0]!.mensaje}`).toContain(ip);
      expect(await alertas(adminInactivo.usuarioId)).toHaveLength(0);
      expect(await alertas(docente.usuarioId)).toHaveLength(0);

      for (let i = 0; i < 2; i += 1) expect((await primerAcceso(await estudianteNuevo(), ip)).status).toBe(204);
      expect(await eventos(), 'solo una alerta por IP y hora').toHaveLength(1);
      expect(await alertas(adminActivo.usuarioId)).toHaveLength(1);
    });

    it('[C1] activaciones desde direcciones distintas no disparan la alerta', async () => {
      const eventos = await attack.db.query(`SELECT count(*)::int AS total FROM ${attack.s}."auditoria" WHERE "accion"='PRIMER_ACCESO_MASIVO'`) as Array<{ total: number }>;
      const previos = eventos[0]!.total;
      for (const ip of ['203.0.113.61', '203.0.113.62', '203.0.113.63']) expect((await primerAcceso(await estudianteNuevo(), ip)).status).toBe(204);
      const despues = await attack.db.query(`SELECT count(*)::int AS total FROM ${attack.s}."auditoria" WHERE "accion"='PRIMER_ACCESO_MASIVO'`) as Array<{ total: number }>;
      expect(despues[0]!.total).toBe(previos);
    });
  });

  describe('[B] identificadores de importación de estudiantes', () => {
    it.each([
      ['GET', `/periodos/${UUID_INVALIDO}/importaciones/estudiantes/${uuid()}`],
      ['GET', `/periodos/${uuid()}/importaciones/estudiantes/${UUID_INVALIDO}`],
      ['POST', `/periodos/${UUID_INVALIDO}/importaciones/estudiantes/${uuid()}/confirmar`],
      ['POST', `/periodos/${uuid()}/importaciones/estudiantes/${UUID_INVALIDO}/confirmar`],
    ] as const)('[B] %s %s con un id que no es UUID responde 400, no 500', async (metodo, ruta) => {
      const admin = await crearCuenta(attack, { rol: 'ADMIN' });
      const token = await tokenDe(attack, admin);
      const llamada = metodo === 'GET' ? request(attack.baseUrl).get(ruta) : request(attack.baseUrl).post(ruta).send({});
      expect((await llamada.set('Authorization', `Bearer ${token}`)).status).toBe(400);
    });

    it('[B] subir un Excel a un período que no es UUID responde 400 antes de leer el archivo', async () => {
      const admin = await crearCuenta(attack, { rol: 'ADMIN' });
      const response = await request(attack.baseUrl).post(`/periodos/${UUID_INVALIDO}/importaciones/estudiantes/validar`)
        .set('Authorization', `Bearer ${await tokenDe(attack, admin)}`)
        .field('carrera_id', uuid()).attach('archivo', Buffer.from('x'), { filename: 'estudiantes.xlsx', contentType: 'application/octet-stream' });
      expect(response.status).toBe(400);
    });
  });
});
