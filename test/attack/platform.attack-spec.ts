import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { validateEnvironment, type AppEnvironment } from '../../src/config/environment.js';
import { CorreoWorker } from '../../src/correo/correo.worker.js';
import type { SmtpTransportService } from '../../src/correo/smtp-transport.service.js';
import { cookieValue, crearCuenta, login, sessionCall, setCookiesOf, sha256, tokenDe, type Cuenta } from './support/actors.js';
import { REPO_ROOT, bootAttackApp, type AttackApp } from './support/harness.js';

/** Entorno de producción completo y válido; cada prueba altera una sola variable. */
const PRODUCCION: Record<string, string> = {
  NODE_ENV: 'production', PORT: '3000', DB_HOST: 'db.interna', DB_USERNAME: 'app', DB_PASSWORD: 'secreto-de-prueba', DB_NAME: 'titulacion',
  JWT_PRIVATE_KEY_PATH: '/run/secrets/jwt-private.pem', JWT_PUBLIC_KEY_PATH: '/run/secrets/jwt-public.pem',
  OUTBOX_ENCRYPTION_KEY_PATH: '/run/secrets/outbox.key', AUTH_ISSUER: 'https://titulacion.example.edu',
  AUTH_ORIGINS: 'https://titulacion.example.edu', TRUST_PROXY: '1',
  REDIS_HOST: 'redis.interna', REDIS_PASSWORD: 'secreto-de-prueba', REDIS_TLS: 'true', DB_SSL: 'true',
  SMTP_HOST: 'smtp.example.edu', SMTP_FROM: 'Titulación <no-reply@example.edu>', SMTP_REQUIRE_TLS: 'true', S3_BUCKET: 'titulacion',
};

/** Servicios de docker-compose.yml con sus puertos publicados y su comando (parser mínimo sin dependencias). */
function composeServices(): Map<string, { ports: string[]; command: string }> {
  const services = new Map<string, { ports: string[]; command: string }>();
  let inServices = false;
  let current: string | undefined;
  let inPorts = false;
  for (const raw of readFileSync(join(REPO_ROOT, 'docker-compose.yml'), 'utf8').split(/\r?\n/)) {
    if (/^\S/.test(raw)) { inServices = raw.startsWith('services:'); current = undefined; continue; }
    if (!inServices) continue;
    const service = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(raw);
    if (service) { current = service[1]; services.set(current!, { ports: [], command: '' }); inPorts = false; continue; }
    if (!current) continue;
    const key = /^ {4}([A-Za-z_]+):\s*(.*)$/.exec(raw);
    if (key) {
      inPorts = key[1] === 'ports';
      if (key[1] === 'command') services.get(current)!.command = key[2] ?? '';
      continue;
    }
    const item = /^ {6}-\s*(.+)$/.exec(raw);
    if (item && inPorts) services.get(current)!.ports.push(item[1]!.trim().replace(/^['"]|['"]$/g, ''));
  }
  return services;
}

describe('Plataforma, límites y auditoría (ataque)', () => {
  let attack: AttackApp;

  beforeAll(async () => { attack = await bootAttackApp(); });
  afterAll(async () => { await attack?.close(); });
  beforeEach(async () => { await attack.flushLimiter(); });

  describe('[A2] proxy de confianza', () => {
    it('[A2] control: el entorno de producción de referencia es válido', () => {
      expect(() => validateEnvironment({ ...PRODUCCION })).not.toThrow();
    });

    it('[A2] producción rechaza TRUST_PROXY=true', () => {
      expect(() => validateEnvironment({ ...PRODUCCION, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    });

    it('[A2] producción exige TRUST_PROXY cuando hay AUTH_ORIGINS', () => {
      const sinProxy = { ...PRODUCCION };
      delete sinProxy.TRUST_PROXY;
      expect(() => validateEnvironment(sinProxy)).toThrow(/TRUST_PROXY/);
    });

    it('[regresión] con TRUST_PROXY=1 un X-Forwarded-For falsificado no cambia la clave del limitador', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 32; i += 1) {
        const response = await request(attack.baseUrl).post('/auth/login')
          .set('X-Forwarded-For', `203.0.113.${i + 1}, 198.51.100.7`)
          .send({ email: `nadie${i}.${randomBytes(3).toString('hex')}@live.uleam.edu.ec`, password: 'contraseña-incorrecta-123' });
        statuses.push(response.status);
      }
      expect(statuses, 'la rotación del primer salto de X-Forwarded-For evadió el límite por IP').toContain(429);
    });
  });

  describe('[A6] límites fuera del inicio de sesión', () => {
    it('[A6] /auth/refresh está limitado por sesión', async () => {
      const sid = randomUUID();
      const csrf = randomBytes(32).toString('base64url');
      const statuses: number[] = [];
      for (let i = 0; i < 40; i += 1) statuses.push((await sessionCall(attack, '/auth/refresh', `${sid}.intento${i}`, csrf)).status);
      expect(statuses).toContain(429);
    });

    it('[A6] /auth/reset-password está limitado por IP', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 35; i += 1) {
        statuses.push((await request(attack.baseUrl).post('/auth/reset-password').send({ code: randomBytes(32).toString('base64url'), password: 'Marea-Volcan-Zafiro-41' })).status);
      }
      expect(statuses).toContain(429);
    });

    it('[A6] /auth/change-password está limitado por usuario', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const token = await tokenDe(attack, usuario);
      const statuses: number[] = [];
      for (let i = 0; i < 7; i += 1) {
        statuses.push((await request(attack.baseUrl).post('/auth/change-password').set('Authorization', `Bearer ${token}`)
          .send({ current_password: `incorrecta-${i}-xxxxxxx`, password: 'Marea-Volcan-Zafiro-41' })).status);
      }
      expect(statuses).toContain(429);
    });
  });

  describe('[M7] auditoría inmutable y eventos de autenticación', () => {
    const insertarAuditoria = async (actor: Cuenta) => {
      const [row] = await attack.db.query(
        `INSERT INTO ${attack.s}."auditoria" ("usuario_id","accion","entidad_tipo","entidad_id","valores_anteriores","valores_nuevos","ip_origen") VALUES ($1,'PRUEBA_ATAQUE','prueba',$2,NULL,'{}'::jsonb,NULL) RETURNING "id"`,
        [actor.usuarioId, randomUUID()],
      ) as Array<{ id: string }>;
      return row!.id;
    };
    const rechaza = (db: DataSource, sql: string, params: unknown[]) => db.query(sql, params).then(() => false, () => true);

    it('[M7] UPDATE sobre auditoria se rechaza en PostgreSQL', async () => {
      const id = await insertarAuditoria(await crearCuenta(attack, { rol: 'ADMIN' }));
      expect(await rechaza(attack.db, `UPDATE ${attack.s}."auditoria" SET "accion"='MANIPULADA' WHERE "id"=$1`, [id])).toBe(true);
    });

    it('[M7] DELETE sobre auditoria se rechaza en PostgreSQL', async () => {
      const id = await insertarAuditoria(await crearCuenta(attack, { rol: 'ADMIN' }));
      expect(await rechaza(attack.db, `DELETE FROM ${attack.s}."auditoria" WHERE "id"=$1`, [id])).toBe(true);
    });

    const eventos = async (cuenta: Cuenta, accion: string) => (await attack.db.query(
      `SELECT count(*)::int AS total FROM ${attack.s}."auditoria" WHERE "accion"=$2 AND ("entidad_id"=$1 OR "usuario_id"=$1)`, [cuenta.usuarioId, accion],
    ) as Array<{ total: number }>)[0]!.total;

    it('[M7] un login exitoso queda auditado (LOGIN_EXITOSO)', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      expect((await login(attack, usuario.email, usuario.password)).status).toBe(200);
      expect(await eventos(usuario, 'LOGIN_EXITOSO')).toBeGreaterThanOrEqual(1);
    });

    it('[M7] un login fallido de una cuenta existente queda auditado (LOGIN_FALLIDO)', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      expect((await login(attack, usuario.email, 'contraseña-incorrecta-123')).status).toBe(401);
      expect(await eventos(usuario, 'LOGIN_FALLIDO')).toBeGreaterThanOrEqual(1);
    });

    it('[M7] el cambio de contraseña queda auditado (CAMBIO_CLAVE)', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const response = await request(attack.baseUrl).post('/auth/change-password').set('Authorization', `Bearer ${await tokenDe(attack, usuario)}`)
        .send({ current_password: usuario.password, password: 'Marea-Volcan-Zafiro-41' });
      expect(response.status).toBe(204);
      expect(await eventos(usuario, 'CAMBIO_CLAVE')).toBeGreaterThanOrEqual(1);
    });

    it('[M7] el restablecimiento queda auditado (RECUPERACION_COMPLETADA)', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const code = randomBytes(32).toString('base64url');
      await attack.db.query(`INSERT INTO ${attack.s}."solicitud_recuperacion" ("usuario_id","codigo_hash","expira_en") VALUES ($1,$2,now() + interval '30 minutes')`, [usuario.usuarioId, sha256(code)]);
      expect((await request(attack.baseUrl).post('/auth/reset-password').send({ code, password: 'Marea-Volcan-Zafiro-41' })).status).toBe(204);
      expect(await eventos(usuario, 'RECUPERACION_COMPLETADA')).toBeGreaterThanOrEqual(1);
    });

    it('[M7] la reutilización de un refresh queda auditada (SESION_REUSO_DETECTADO)', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const sesion = await login(attack, usuario.email, usuario.password);
      const rotado = await sessionCall(attack, '/auth/refresh', sesion.refreshCookie!, sesion.csrfCookie!);
      expect(rotado.status).toBe(200);
      const csrf = cookieValue(setCookiesOf(rotado), 'titulacion_csrf') ?? sesion.csrfCookie!;
      await sessionCall(attack, '/auth/refresh', sesion.refreshCookie!, csrf);
      await sessionCall(attack, '/auth/refresh', sesion.refreshCookie!, csrf);
      expect(await eventos(usuario, 'SESION_REUSO_DETECTADO')).toBeGreaterThanOrEqual(1);
    });
  });

  describe('[S7] GET /healthz', () => {
    it('es público, devuelve un cuerpo constante mínimo y no expone dependencias', async () => {
      const response = await request(attack.baseUrl).get('/healthz');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });

    it('está sujeto al límite global por IP (deja contador en Redis)', async () => {
      await request(attack.baseUrl).get('/healthz').expect(200);
      expect(await attack.redis.get('titulacion:auth-rate:rl:global:127.0.0.1')).not.toBeNull();
    });
  });

  describe('[RES] Redis inalcanzable', () => {
    let sinRedis: AttackApp;

    beforeAll(async () => {
      // Puerto local cerrado: se abre un servidor, se toma su puerto y se cierra antes de arrancar.
      const servidor = createServer();
      await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
      const puerto = (servidor.address() as AddressInfo).port;
      await new Promise<void>((resolve) => servidor.close(() => resolve()));
      sinRedis = await bootAttackApp({ REDIS_HOST: '127.0.0.1', REDIS_PORT: String(puerto) }, { sinRedis: true });
    }, 60_000);
    afterAll(async () => { await sinRedis?.close(); });

    it('[RES] GET /healthz responde 200 (refleja el proceso, no Redis)', async () => {
      const response = await request(sinRedis.baseUrl).get('/healthz');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });

    it('[RES] una consulta autenticada sin @RateLimit sigue respondiendo', async () => {
      const usuario = await crearCuenta(sinRedis, { rol: 'ESTUDIANTE' });
      const response = await request(sinRedis.baseUrl).get('/notificaciones').set('Authorization', `Bearer ${await tokenDe(sinRedis, usuario)}`);
      expect(response.status).toBe(200);
    });

    it('[RES] el inicio de sesión falla cerrado con 503', async () => {
      const usuario = await crearCuenta(sinRedis, { rol: 'ESTUDIANTE' });
      expect((await login(sinRedis, usuario.email, usuario.password)).status).toBe(503);
    });
  });

  describe('[M10/A5] transporte e infraestructura', () => {
    it('[A5] docker-compose publica redis, mailpit y minio solo en 127.0.0.1', () => {
      const services = composeServices();
      const expuestos: string[] = [];
      for (const name of ['redis', 'mailpit', 'minio']) {
        const service = services.get(name);
        expect(service, `falta el servicio ${name} en docker-compose.yml`).toBeDefined();
        for (const port of service!.ports) if (!port.startsWith('127.0.0.1:')) expuestos.push(`${name}: ${port}`);
      }
      expect(expuestos).toEqual([]);
    });

    it('[A5] Redis de docker-compose exige contraseña (--requirepass)', () => {
      expect(composeServices().get('redis')?.command ?? '').toContain('--requirepass');
    });

    it('[M10] el worker de correo no arranca sin llave de cifrado (sin respaldo en ceros)', () => {
      // ConfigService cae a process.env; la aplicación de la suite lo tiene definido, así que se retira mientras dura la prueba.
      const previous = process.env.OUTBOX_ENCRYPTION_KEY_PATH;
      delete process.env.OUTBOX_ENCRYPTION_KEY_PATH;
      try {
        const config = new ConfigService<AppEnvironment, true>({ NODE_ENV: 'production' });
        expect(() => new CorreoWorker({} as DataSource, config, {} as SmtpTransportService)).toThrow(/OUTBOX_ENCRYPTION_KEY_PATH/);
      } finally {
        if (previous !== undefined) process.env.OUTBOX_ENCRYPTION_KEY_PATH = previous;
      }
    });

    it('[B] .gitignore excluye *.pem y *.key', () => {
      const lines = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((line) => line.trim());
      expect(lines).toContain('*.pem');
      expect(lines).toContain('*.key');
    });

    it('[B] .gitignore excluye .env y cualquier .env.* salvo .env.example (semántica real de git)', () => {
      // `--no-index` evalúa solo las reglas, aunque la ruta no exista o ya esté versionada.
      const ignored = (path: string) => spawnSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: REPO_ROOT }).status;
      for (const path of ['.env', '.env.local', '.env.production', '.env.staging', '.env.production.local', 'config/.env.dev']) {
        expect(ignored(path), `${path} debe estar ignorado`).toBe(0);
      }
      expect(ignored('.env.example'), '.env.example debe poder versionarse').toBe(1);
    });
  });
});
