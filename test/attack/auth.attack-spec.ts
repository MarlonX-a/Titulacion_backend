import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { SignJWT, importPKCS8 } from 'jose';
import request from 'supertest';
import { AuthRateLimiterService } from '../../src/auth/auth-rate-limiter.service.js';
import type { AppEnvironment } from '../../src/config/environment.js';
import {
  cookieValue, crearCuenta, firmarToken, login, sessionCall, setCookiesOf, sha256, tokenDe, type Cuenta,
} from './support/actors.js';
import { ATTACK_ISSUER, REPO_ROOT, bootAttackApp, type AttackApp } from './support/harness.js';

/** Contraseña nueva que cumple la política S1 (12+ caracteres, sin datos personales). */
const NUEVA_CLAVE = 'Marea-Volcan-Zafiro-41';

describe('Autenticación (ataque)', () => {
  let attack: AttackApp;

  beforeAll(async () => { attack = await bootAttackApp(); });
  afterAll(async () => { await attack?.close(); });
  beforeEach(async () => { await attack.flushLimiter(); });

  const codigoRecuperacion = async (cuenta: Cuenta): Promise<string> => {
    const code = randomBytes(32).toString('base64url');
    await attack.db.query(
      `INSERT INTO ${attack.s}."solicitud_recuperacion" ("usuario_id","codigo_hash","expira_en") VALUES ($1,$2,now() + interval '30 minutes')`,
      [cuenta.usuarioId, sha256(code)],
    );
    return code;
  };
  const reset = (code: string, password = NUEVA_CLAVE) => request(attack.baseUrl).post('/auth/reset-password').send({ code, password });
  const changePassword = (token: string, current: string, password: string) => request(attack.baseUrl).post('/auth/change-password')
    .set('Authorization', `Bearer ${token}`).send({ current_password: current, password });

  describe('[A1] bloqueo de cuentas ajenas', () => {
    it('[A1] la víctima con cookie de dispositivo sigue entrando tras 11 fallos del atacante', async () => {
      const victima = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const primera = await login(attack, victima.email, victima.password);
      expect(primera.status).toBe(200);
      for (let i = 0; i < 11; i += 1) await login(attack, victima.email, `incorrecta-${i}-xxxxxxxx`);
      const despues = await login(attack, victima.email, victima.password, primera.deviceCookie);
      expect(despues.status, 'la víctima quedó bloqueada por los fallos del atacante').toBe(200);
      expect(primera.deviceCookie, 'el login completo debe emitir la cookie titulacion_dispositivo').toBeTruthy();
    });

    it('[A1] un dispositivo nunca usado recibe 429 durante el ataque (riesgo residual aceptado)', async () => {
      const victima = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      for (let i = 0; i < 11; i += 1) await login(attack, victima.email, `incorrecta-${i}-xxxxxxxx`);
      expect((await login(attack, victima.email, victima.password)).status).toBe(429);
    });

    it('[A1] los inicios de sesión correctos no consumen el cupo del correo', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      for (let i = 0; i < 12; i += 1) expect((await login(attack, usuario.email, usuario.password)).status).toBe(200);
    });

    it('[A1] 40 contraseñas erróneas en paralelo contra un correo: como máximo 10 se verifican (401), el resto 429', async () => {
      const victima = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const primera = await login(attack, victima.email, victima.password);
      expect(primera.status).toBe(200);
      const estados = (await Promise.all(Array.from({ length: 40 }, (_, i) => login(attack, victima.email, `incorrecta-${i}-xxxxxxxx`)))).map((r) => r.status);
      const verificados = estados.filter((estado) => estado === 401).length;
      expect(verificados, `respuestas: ${estados.join(',')}`).toBeLessThanOrEqual(10);
      expect(verificados + estados.filter((estado) => estado === 429).length).toBe(40);
      const despues = await login(attack, victima.email, victima.password, primera.deviceCookie);
      expect(despues.status, 'la víctima con dispositivo conocido quedó bloqueada').toBe(200);
    });

    it('[A1] un login correcto entre fallos no consume cupo del correo', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const estados: number[] = [];
      for (let i = 0; i < 5; i += 1) estados.push((await login(attack, usuario.email, `incorrecta-${i}-xxxxxxxx`)).status);
      estados.push((await login(attack, usuario.email, usuario.password)).status);
      for (let i = 5; i < 11; i += 1) estados.push((await login(attack, usuario.email, `incorrecta-${i}-xxxxxxxx`)).status);
      expect(estados).toEqual([401, 401, 401, 401, 401, 200, 401, 401, 401, 401, 401, 429]);
    });

    it('[A1] forgot-password nunca devuelve 429 por correo (descarte silencioso)', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) statuses.push((await request(attack.baseUrl).post('/auth/forgot-password').send({ email: usuario.email })).status);
      expect(statuses).toEqual([202, 202, 202, 202, 202]);
    });
  });

  describe('[A4] NODE_ENV=test en tiempo de ejecución', () => {
    it('[A4] el limitador aplica límites aunque NODE_ENV sea test', async () => {
      const config = new ConfigService<AppEnvironment, true>({ ...attack.env, NODE_ENV: 'test', REDIS_PORT: Number(attack.env.REDIS_PORT) });
      const limiter = new AuthRateLimiterService(config);
      const key = `attack-a4:${randomBytes(6).toString('hex')}`;
      try {
        await limiter.enforce(key, 1, 60);
        await expect(limiter.enforce(key, 1, 60)).rejects.toMatchObject({ status: 429 });
      } finally { await limiter.onModuleDestroy(); }
    });

    it('[A4] dist/main.js se niega a arrancar con NODE_ENV=test', async () => {
      const port = await freePort();
      const cwd = mkdtempSync(join(tmpdir(), 'titulacion-a4-'));
      const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...attack.env, NODE_ENV: 'test', PORT: String(port) };
      delete env.JWT_PRIVATE_KEY_PATH; delete env.JWT_PUBLIC_KEY_PATH;
      const child = spawn(process.execPath, [join(REPO_ROOT, 'dist/main.js')], { cwd, env, stdio: 'ignore' });
      try {
        const outcome = await new Promise<'exited' | 'listening' | 'timeout'>((resolve) => {
          const deadline = Date.now() + 25_000;
          child.once('exit', () => resolve('exited'));
          const poll = () => {
            if (Date.now() > deadline) { resolve('timeout'); return; }
            const socket = connect(port, '127.0.0.1');
            socket.once('connect', () => { socket.destroy(); resolve('listening'); });
            socket.once('error', () => { socket.destroy(); setTimeout(poll, 300); });
          };
          poll();
        });
        expect(outcome, 'el proceso arrancó y escuchó con NODE_ENV=test').toBe('exited');
        expect(child.exitCode).not.toBe(0);
      } finally {
        if (child.exitCode === null) {
          const exited = new Promise((resolve) => child.once('exit', resolve));
          child.kill();
          await exited;
        }
        rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    });
  });

  describe('[M8] recuperación, cierre de sesión y CSRF', () => {
    it('[M8] un restablecimiento exitoso invalida los demás códigos abiertos', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const primero = await codigoRecuperacion(usuario);
      const segundo = await codigoRecuperacion(usuario);
      expect((await reset(primero)).status).toBe(204);
      expect((await reset(segundo, 'Otra-Clave-Larga-Segura-77')).status).toBe(401);
    });

    it('[M8] cambiar la contraseña invalida los códigos de recuperación abiertos', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const code = await codigoRecuperacion(usuario);
      expect((await changePassword(await tokenDe(attack, usuario), usuario.password, NUEVA_CLAVE)).status).toBe(204);
      expect((await reset(code, 'Otra-Clave-Larga-Segura-77')).status).toBe(401);
    });

    it('[M8] solicitar un código nuevo NO invalida el anterior (regresión del diseño S1)', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const anterior = await codigoRecuperacion(usuario);
      expect((await request(attack.baseUrl).post('/auth/forgot-password').send({ email: usuario.email })).status).toBe(202);
      expect((await reset(anterior)).status).toBe(204);
    });

    it('[M8] el restablecimiento se rechaza para una cuenta INACTIVO', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE', estado: 'INACTIVO' });
      const code = await codigoRecuperacion(usuario);
      expect((await reset(code)).status).toBe(401);
    });

    it('[M8] logout con cookie falsificada `sid.basura` no revoca la sesión de la víctima', async () => {
      const victima = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const sesion = await login(attack, victima.email, victima.password);
      expect(sesion.status).toBe(200);
      const sid = sesion.refreshCookie!.split('.', 1)[0]!;
      const csrfAtacante = randomBytes(32).toString('base64url');
      expect((await sessionCall(attack, '/auth/logout', `${sid}.falsificado`, csrfAtacante)).status).toBe(204);
      const revocada = await attack.db.query(`SELECT "revocada_en" FROM ${attack.s}."sesion_usuario" WHERE "id"=$1`, [sid]) as Array<{ revocada_en: Date | null }>;
      expect(revocada[0]!.revocada_en, 'el logout falsificado revocó la sesión').toBeNull();
    });

    it('[M8] GET /auth/csrf no devuelve un valor malformado elegido por el cliente', async () => {
      const response = await request(attack.baseUrl).get('/auth/csrf').set('Cookie', 'titulacion_csrf=valor-del-atacante');
      expect(response.status).toBe(200);
      expect((response.body as { csrf_token: string }).csrf_token).not.toBe('valor-del-atacante');
    });

    it('[M8] GET /auth/csrf conserva un valor bien formado (regresión del diseño S1)', async () => {
      const valid = randomBytes(32).toString('base64url');
      const response = await request(attack.baseUrl).get('/auth/csrf').set('Cookie', `titulacion_csrf=${valid}`);
      expect((response.body as { csrf_token: string }).csrf_token).toBe(valid);
    });
  });

  describe('[M9] refresco concurrente', () => {
    it('[M9] dos refrescos simultáneos: uno 200, otro 409 REFRESH_CONCURRENTE y la sesión sigue viva', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const sesion = await login(attack, usuario.email, usuario.password);
      const [a, b] = await Promise.all([
        sessionCall(attack, '/auth/refresh', sesion.refreshCookie!, sesion.csrfCookie!),
        sessionCall(attack, '/auth/refresh', sesion.refreshCookie!, sesion.csrfCookie!),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
      const conflicto = a.status === 409 ? a : b;
      expect(JSON.stringify(conflicto.body)).toContain('REFRESH_CONCURRENTE');
      const ganador = a.status === 200 ? a : b;
      const cookies = setCookiesOf(ganador);
      const siguiente = await sessionCall(attack, '/auth/refresh', cookieValue(cookies, 'titulacion_refresh')!, cookieValue(cookies, 'titulacion_csrf')!);
      expect(siguiente.status, 'la sesión fue revocada por el refresco concurrente').toBe(200);
    });

    it('[M9] una segunda presentación del refresh anterior revoca la sesión (detección de robo)', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const sesion = await login(attack, usuario.email, usuario.password);
      const rotado = await sessionCall(attack, '/auth/refresh', sesion.refreshCookie!, sesion.csrfCookie!);
      expect(rotado.status).toBe(200);
      const nuevo = setCookiesOf(rotado);
      expect((await sessionCall(attack, '/auth/refresh', sesion.refreshCookie!, sesion.csrfCookie!)).status, 'la primera presentación tardía debe ser 409 sin revocar').toBe(409);
      expect((await sessionCall(attack, '/auth/refresh', sesion.refreshCookie!, sesion.csrfCookie!)).status).toBe(401);
      expect((await sessionCall(attack, '/auth/refresh', cookieValue(nuevo, 'titulacion_refresh')!, cookieValue(nuevo, 'titulacion_csrf')!)).status).toBe(401);
    });
  });

  describe('[M13] política de contraseñas', () => {
    it('[M13] se rechaza una contraseña nueva de 8 caracteres', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      expect((await changePassword(await tokenDe(attack, usuario), usuario.password, 'Ab3$efgh')).status).toBe(400);
    });

    it('[M13] se rechaza una contraseña nueva que contiene la cédula', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      expect([400, 422]).toContain((await changePassword(await tokenDe(attack, usuario), usuario.password, `${usuario.cedula}-Clave!`)).status);
    });

    it('[M13] se rechaza una contraseña nueva que contiene la parte local del correo', async () => {
      const usuario = await crearCuenta(attack, { rol: 'DOCENTE' });
      const local = usuario.email.split('@')[0]!;
      expect([400, 422]).toContain((await changePassword(await tokenDe(attack, usuario), usuario.password, `${local}-Segura-9`)).status);
    });

    it('[M13] el restablecimiento también aplica la política (cédula)', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      expect([400, 422]).toContain((await reset(await codigoRecuperacion(usuario), `${usuario.cedula}-Clave!`)).status);
    });
  });

  describe('[B] oráculos de inicio de sesión', () => {
    it('[B] cuenta inactiva con contraseña correcta responde el mismo 401 genérico', async () => {
      const inactiva = await crearCuenta(attack, { rol: 'ESTUDIANTE', estado: 'INACTIVO' });
      const activa = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const correcta = await login(attack, inactiva.email, inactiva.password);
      const incorrecta = await login(attack, activa.email, 'contraseña-incorrecta-123');
      expect(correcta.status).toBe(401);
      expect(correcta.body.message).toBe(incorrecta.body.message);
    });
  });

  describe('[A3] equipos compartidos y caché', () => {
    it('[A3] las cookies de refresh y CSRF son de sesión (sin Max-Age ni Expires)', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const sesion = await login(attack, usuario.email, usuario.password);
      const lines = sesion.setCookies.filter((line) => /^(__Secure-)?titulacion_(refresh|csrf)=/.test(line));
      expect(lines).toHaveLength(2);
      for (const line of lines) expect(line).not.toMatch(/max-age|expires/i);
    });

    it('[A3] las respuestas de la API llevan Cache-Control: no-store', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const token = await tokenDe(attack, usuario);
      for (const path of ['/usuarios/me', '/auth/me']) {
        const response = await request(attack.baseUrl).get(path).set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(200);
        expect(response.headers['cache-control'] ?? '', path).toContain('no-store');
      }
    });

    it('[A3] una sesión inactiva más de 30 minutos se rechaza', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const sesion = await login(attack, usuario.email, usuario.password);
      const sid = sesion.refreshCookie!.split('.', 1)[0]!;
      const columns = await attack.db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='sesion_usuario' AND column_name='ultima_actividad'`, [attack.schema]) as unknown[];
      expect(columns.length, 'sesion_usuario.ultima_actividad no existe: no hay control de inactividad').toBe(1);
      await attack.db.query(`UPDATE ${attack.s}."sesion_usuario" SET "ultima_actividad"=now() - interval '31 minutes' WHERE "id"=$1`, [sid]);
      expect((await request(attack.baseUrl).get('/auth/me').set('Authorization', `Bearer ${sesion.accessToken}`)).status).toBe(401);
    });
  });

  describe('[regresión] validación JWT', () => {
    it('[regresión] se rechaza un token HS256 firmado con la clave pública', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ADMIN' });
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ typ: 'access', sid: '00000000-0000-4000-8000-000000000000' }).setProtectedHeader({ alg: 'HS256' })
        .setIssuer(ATTACK_ISSUER).setAudience('titulacion-api').setSubject(usuario.usuarioId).setIssuedAt(now).setExpirationTime(now + 600)
        .sign(new TextEncoder().encode(attack.publicKeyPem));
      expect((await request(attack.baseUrl).get('/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    });

    it('[regresión] se rechaza un token alg=none y uno firmado con otra clave RSA', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ADMIN' });
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const none = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ typ: 'access', sub: usuario.usuarioId, iss: ATTACK_ISSUER, aud: 'titulacion-api', exp: now + 600 })}.`;
      expect((await request(attack.baseUrl).get('/auth/me').set('Authorization', `Bearer ${none}`)).status).toBe(401);
      const other = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
      const forged = await new SignJWT({ typ: 'access' }).setProtectedHeader({ alg: 'RS256' }).setIssuer(ATTACK_ISSUER).setAudience('titulacion-api')
        .setSubject(usuario.usuarioId).setExpirationTime(now + 600).sign(await importPKCS8(other.privateKey, 'RS256'));
      expect((await request(attack.baseUrl).get('/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
    });

    it('[regresión] un token first_access no sirve en rutas normales', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE', requiereCambio: true });
      const token = await firmarToken(attack, usuario.usuarioId, { typ: 'first_access' });
      expect((await request(attack.baseUrl).get('/usuarios/me').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    });

    it('[regresión] un token de acceso sin sid se rechaza', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ADMIN' });
      const token = await firmarToken(attack, usuario.usuarioId, { typ: 'access' });
      expect((await request(attack.baseUrl).get('/usuarios/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    });

    it('[regresión] refresh exige un origen permitido', async () => {
      const usuario = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const sesion = await login(attack, usuario.email, usuario.password);
      const response = await request(attack.baseUrl).post('/auth/refresh').set('Origin', 'http://evil.example')
        .set('X-CSRF-Token', sesion.csrfCookie!).set('Cookie', `titulacion_refresh=${encodeURIComponent(sesion.refreshCookie!)}; titulacion_csrf=${sesion.csrfCookie!}`);
      expect(response.status).toBe(401);
    });
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}
