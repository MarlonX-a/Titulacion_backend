import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { docxRelacionExterna, pdfBenigno, pdfJavaScript, pdfOpenAction, DOCX_MIME, PDF_MIME } from '../fixtures/attack/archivos-maliciosos.mjs';
import { cookieValue, crearCuenta, tokenDe, type Cuenta } from './support/actors.js';
import { sembrarEscenario, sembrarTrabajosIndividuales, type EscenarioBase, type TrabajoIndividual } from './support/escenario.js';
import { baseEnvironment, bootAttackApp, type AttackApp } from './support/harness.js';

/**
 * Campaña viva cliente -> nginx real (imagen del frontend) -> backend real.
 * Solo se ejecuta con ATTACK_NGINX_IMAGE=<imagen construida del frontend>. Opcional: ATTACK_NGINX_PORT (18080).
 * El backend escucha en 0.0.0.0 solo mientras dura la prueba para que el contenedor lo alcance por host.docker.internal.
 */
const IMAGE = process.env.ATTACK_NGINX_IMAGE;
const PORT = Number(process.env.ATTACK_NGINX_PORT ?? '18080');
const PORT_LOW = PORT + 1;
const PORT_FAKE = PORT + 2;
/** Valor por defecto de LIMIT_CONN_UPLOAD_PER_IP en el Dockerfile del frontend. */
const UPLOAD_CONN_DEFAULT = 10;
/** Las cinco rutas multipart del location de subidas de nginx.conf (sin el prefijo /api/v1). */
const UPLOAD_ROUTES = (periodo: string, asignacion: string) => [
  `/periodos/${periodo}/asignaciones-tema/${asignacion}/documentos-pat`,
  `/periodos/${periodo}/plantillas-pat`,
  `/periodos/${periodo}/importaciones/estudiantes/validar`,
  '/importaciones/docentes/validar',
  '/importaciones/temas/validar',
];

interface FakeUpstream {
  port: number;
  /** Método y URL (ruta + query) tal como llegan al upstream. */
  received: Array<{ method: string; url: string }>;
  /** Solicitudes retenidas en este momento (las que llevan `retener=1` en la query). */
  holding(): number;
  release(): void;
  close(): Promise<void>;
}

/**
 * Upstream falso en 0.0.0.0 (el contenedor lo alcanza por host.docker.internal): registra cada
 * solicitud y responde 200 JSON; con `retener=1` en la query no responde hasta `release()`, para
 * mantener abiertas conexiones de subida.
 */
function startFakeUpstream(): Promise<FakeUpstream> {
  const received: FakeUpstream['received'] = [];
  const held: Array<() => void> = [];
  const server = createServer((req, res) => {
    received.push({ method: req.method ?? '', url: req.url ?? '' });
    req.resume();
    const reply = () => { if (!res.writableEnded) res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"upstream":"falso"}'); };
    if (/[?&]retener=1(?:&|$)/.test(req.url ?? '')) held.push(reply); else req.on('end', reply);
  });
  return new Promise((resolve) => {
    server.listen(0, '0.0.0.0', () => resolve({
      port: (server.address() as { port: number }).port,
      received,
      holding: () => held.length,
      release: () => { for (const reply of held.splice(0)) reply(); },
      close: () => new Promise<void>((done) => { for (const reply of held.splice(0)) reply(); server.closeAllConnections(); server.close(() => done()); }),
    }));
  });
}
const ORIGIN = `http://127.0.0.1:${PORT}`;
const API = '/api/v1';
const EVIDENCE = (probe: string, data: unknown) => {
  const line = `[EVIDENCIA ${probe}] ${typeof data === 'string' ? data : JSON.stringify(data)}`;
  console.info(line);
  if (process.env.ATTACK_EVIDENCE_FILE) appendFileSync(process.env.ATTACK_EVIDENCE_FILE, `${line}
`);
};

interface Raw {
  status: number;
  headers: Record<string, string>;
  rawNames: string[];
  setCookies: string[];
  text: string;
  json: Record<string, any>;
  ms: number;
}

/** Cliente HTTP crudo: no normaliza la ruta (fetch/undici resolvería `%2e%2e`). */
function call(port: number, method: string, path: string, options: { headers?: Record<string, string>; body?: Buffer | string; json?: unknown } = {}): Promise<Raw> {
  const body = options.json !== undefined ? Buffer.from(JSON.stringify(options.json)) : typeof options.body === 'string' ? Buffer.from(options.body) : options.body;
  const headers: Record<string, string> = { ...(options.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  if (body) headers['Content-Length'] = String(body.length);
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: Record<string, any> = {};
        try { json = text ? JSON.parse(text) as Record<string, any> : {}; } catch { /* no JSON */ }
        const flat: Record<string, string> = {};
        for (const [name, value] of Object.entries(res.headers)) if (name !== 'set-cookie') flat[name] = Array.isArray(value) ? value.join(', ') : String(value);
        resolve({ status: res.statusCode ?? 0, headers: flat, rawNames: res.rawHeaders.filter((_, i) => i % 2 === 0).map((n) => n.toLowerCase()), setCookies: res.headers['set-cookie'] ?? [], text, json, ms: Math.round(performance.now() - started) });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const nginx = (method: string, path: string, options: Parameters<typeof call>[3] = {}) => call(PORT, method, path, options);
const bearer = async (attack: AttackApp, cuenta: Cuenta) => ({ Authorization: `Bearer ${await tokenDe(attack, cuenta)}` });

function multipart(fields: Record<string, string>, file: { name: string; mime: string; content: Buffer }): { body: Buffer; contentType: string } {
  const boundary = `----ataque${randomBytes(6).toString('hex')}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="archivo"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`), file.content, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

const docker = (...args: string[]): string => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const dockerLogs = (name: string): string => execFileSync('docker', ['logs', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

async function waitHealthy(port: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await call(port, 'GET', '/healthz')).status === 200) return; } catch { /* aún arrancando */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`nginx no respondió /healthz en el puerto ${port}`);
}

function tcpState(host: string, port: number, timeoutMs = 2000): Promise<'ABIERTO' | 'rechazado' | 'timeout'> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (state: 'ABIERTO' | 'rechazado' | 'timeout') => { socket.destroy(); resolve(state); };
    socket.setTimeout(timeoutMs, () => done('timeout'));
    socket.once('connect', () => done('ABIERTO'));
    socket.once('error', () => done('rechazado'));
  });
}

const SECURITY_HEADERS = ['content-security-policy', 'strict-transport-security', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy'] as const;
function missingSecurityHeaders(r: Raw): string[] {
  const missing: string[] = SECURITY_HEADERS.filter((name) => !r.headers[name]);
  if (r.headers['content-security-policy'] && !/frame-ancestors/.test(r.headers['content-security-policy'])) missing.push('csp:frame-ancestors');
  if (r.headers['x-content-type-options'] && !/nosniff/i.test(r.headers['x-content-type-options'])) missing.push('nosniff-valor');
  return missing;
}
const duplicated = (r: Raw): string[] => SECURITY_HEADERS.filter((name) => r.rawNames.filter((n) => n === name).length > 1);

describe.skipIf(!IMAGE)('Campaña viva cliente -> nginx -> backend (ataque)', () => {
  let attack: AttackApp;
  let e: EscenarioBase;
  let periodo: string;
  let trabajos: TrabajoIndividual[];
  let nginxName = '';
  let lowName = '';
  const containers: string[] = [];

  let fake: FakeUpstream;
  const run = (name: string, publish: number, env: Record<string, string>, backendPort = attack.port) => {
    const args = ['run', '-d', '--name', name, '-p', `127.0.0.1:${publish}:8080`, '--add-host', 'host.docker.internal:host-gateway',
      '-e', `BACKEND_URL=http://host.docker.internal:${backendPort}`, ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), IMAGE!];
    docker(...args);
    containers.push(name);
  };

  beforeAll(async () => {
    attack = await bootAttackApp({ AUTH_ORIGINS: ORIGIN, TRUST_PROXY: '1' }, { host: '0.0.0.0' });
    e = await sembrarEscenario(attack);
    ({ periodoId: periodo, trabajos } = await sembrarTrabajosIndividuales(attack, e.admin, e.docente, 5));
    fake = await startFakeUpstream();
    const suffix = randomBytes(3).toString('hex');
    nginxName = `titulacion-attack-nginx-${suffix}`;
    lowName = `titulacion-attack-nginx-low-${suffix}`;
    run(nginxName, PORT, {});
    run(lowName, PORT_LOW, { RATE_LIMIT_AUTH: '2r/s', RATE_LIMIT_AUTH_BURST: '2' });
    // Mismo nginx con los valores por defecto de la imagen, pero delante de un upstream falso que registra lo que recibe.
    run(`titulacion-attack-nginx-fake-${suffix}`, PORT_FAKE, {}, fake.port);
    await waitHealthy(PORT);
    await waitHealthy(PORT_LOW);
    await waitHealthy(PORT_FAKE);
  });
  afterAll(async () => {
    for (const name of containers) { try { docker('rm', '-f', name); } catch { /* ya eliminado */ } }
    await fake?.close();
    await attack?.close();
  });
  beforeEach(async () => { await attack.flushLimiter(); });

  it('[P1] Server sin versión y sin X-Powered-By', async () => {
    const responses = [await nginx('GET', '/'), await nginx('GET', `${API}/auth/csrf`), await nginx('GET', `${API}/docs`), await nginx('GET', `${API}/nope`)];
    EVIDENCIA('P1', responses.map((r) => ({ status: r.status, server: r.headers.server ?? null, xPoweredBy: r.headers['x-powered-by'] ?? null })));
    for (const r of responses) {
      expect(r.headers.server, 'Server expone versión').toMatch(/^nginx$/i);
      expect(r.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('[P2] /api/v1/docs y /docs-json responden 404 desde nginx', async () => {
    const paths = [`${API}/docs`, `${API}/docs-json`, `${API}/docs/`, `${API}/docs/swagger-ui-init.js`];
    const out = [];
    for (const path of paths) {
      const r = await nginx('GET', path);
      out.push({ path, status: r.status, server: r.headers.server, bodyIsNginx404: /<center>nginx<\/center>/i.test(r.text) });
      expect(r.status).toBe(404);
      expect(/<center>nginx<\/center>/i.test(r.text), 'el 404 no viene de nginx').toBe(true);
    }
    EVIDENCIA('P2', out);
  });

  it('[P3] cabeceras de seguridad en /, /assets/*, API 200, 401 y 404; no-store en la API', async () => {
    const home = await nginx('GET', '/');
    const asset = /\/assets\/[^"'\s]+\.(?:js|css)/.exec(home.text)?.[0];
    expect(asset, 'index.html no referencia /assets/*').toBeTruthy();
    const token = await bearer(attack, e.estE);
    const cases: Array<[string, Raw]> = [
      ['/', home], [asset!, await nginx('GET', asset!)],
      ['API 200 /usuarios/me', await nginx('GET', `${API}/usuarios/me`, { headers: token })],
      ['API 200 /auth/csrf', await nginx('GET', `${API}/auth/csrf`)],
      ['API 401 /usuarios/me', await nginx('GET', `${API}/usuarios/me`)],
      ['API 404 /ruta-inexistente', await nginx('GET', `${API}/ruta-inexistente`, { headers: token })],
      ['API 404 (auth) /auth/nope', await nginx('GET', `${API}/auth/nope`)],
    ];
    const summary = cases.map(([label, r]) => ({ label, status: r.status, missing: missingSecurityHeaders(r), duplicados: duplicated(r), cache: r.headers['cache-control'] }));
    EVIDENCIA('P3', summary);
    expect(cases[2]![1].status).toBe(200);
    expect(cases[4]![1].status).toBe(401);
    expect(cases[5]![1].status).toBe(404);
    for (const [label, r] of cases) {
      expect(missingSecurityHeaders(r), `faltan cabeceras en ${label}`).toEqual([]);
      if (label.startsWith('API')) expect(r.headers['cache-control'], `cache-control en ${label}`).toMatch(/no-store/);
    }
  });

  it('[P4] login extremo a extremo, cookies reescritas, refresh con Origin correcto/ajeno y logout', async () => {
    const cuenta = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
    const login = await nginx('POST', `${API}/auth/login`, { json: { email: cuenta.email, password: cuenta.password } });
    expect(login.status).toBe(200);
    expect(typeof login.json.access_token).toBe('string');
    const byName = (name: string) => login.setCookies.find((c) => c.startsWith(`${name}=`));
    const refresh = byName('titulacion_refresh');
    const csrfLogin = byName('titulacion_csrf');
    const device = byName('titulacion_dispositivo');
    const attrs = (c: string | undefined) => (c ?? '').split(';').slice(1).map((a) => a.trim());
    EVIDENCIA('P4', { status: login.status, refresh: attrs(refresh), csrf: attrs(csrfLogin), device: attrs(device) });
    for (const [label, cookie] of [['refresh', refresh], ['csrf', csrfLogin], ['dispositivo', device]] as const) {
      expect(cookie, `falta cookie ${label}`).toBeTruthy();
      expect(attrs(cookie), `Path de ${label}`).toContain('Path=/api/v1/auth');
      expect(attrs(cookie), `SameSite de ${label}`).toContain('SameSite=Strict');
    }
    expect(attrs(refresh)).toContain('HttpOnly');
    expect(attrs(device)).toContain('HttpOnly');
    expect(attrs(refresh).some((a) => /^max-age=/i.test(a)), 'la cookie de refresh tiene Max-Age').toBe(false);
    const refreshValue = cookieValue(login.setCookies, 'titulacion_refresh')!;

    const csrf = await nginx('GET', `${API}/auth/csrf`, { headers: { Cookie: `titulacion_csrf=${cookieValue(login.setCookies, 'titulacion_csrf')}` } });
    expect(csrf.status).toBe(200);
    const csrfToken = csrf.json.csrf_token as string;
    expect(typeof csrfToken).toBe('string');
    const cookieHeader = (refreshCookie: string) => `titulacion_refresh=${encodeURIComponent(refreshCookie)}; titulacion_csrf=${csrfToken}`;
    const foreign = await nginx('POST', `${API}/auth/refresh`, { headers: { Origin: 'http://evil.example', 'X-CSRF-Token': csrfToken, Cookie: cookieHeader(refreshValue) } });
    const good = await nginx('POST', `${API}/auth/refresh`, { headers: { Origin: ORIGIN, 'X-CSRF-Token': csrfToken, Cookie: cookieHeader(refreshValue) } });
    EVIDENCIA('P4', { csrfStatus: csrf.status, refreshOrigenAjeno: foreign.status, refreshOrigenCorrecto: good.status, nuevoToken: typeof good.json.access_token });
    expect(foreign.status).toBeGreaterThanOrEqual(400);
    expect(good.status).toBe(200);
    expect(typeof good.json.access_token).toBe('string');
    const rotated = cookieValue(good.setCookies, 'titulacion_refresh')!;
    expect(rotated).toBeTruthy();
    const logout = await nginx('POST', `${API}/auth/logout`, { headers: { Origin: ORIGIN, 'X-CSRF-Token': csrfToken, Cookie: cookieHeader(rotated) } });
    const reuse = await nginx('POST', `${API}/auth/refresh`, { headers: { Origin: ORIGIN, 'X-CSRF-Token': csrfToken, Cookie: cookieHeader(rotated) } });
    EVIDENCIA('P4', { logout: logout.status, refreshTrasLogout: reuse.status });
    expect(logout.status).toBe(204);
    expect(reuse.status).toBe(401);
  });

  it('[P5] X-Forwarded-For no se puede falsificar: el límite por IP se activa y la auditoría registra la IP real', async () => {
    const t0 = new Date(Date.now() - 1000);
    const reales = await Promise.all([1, 2, 3, 4, 5].map(() => crearCuenta(attack, { rol: 'ESTUDIANTE' })));
    const emails = [
      ...reales.slice(0, 3).map((c) => c.email),
      ...Array.from({ length: 30 }, (_, i) => `inexistente${i}.${randomBytes(3).toString('hex')}@live.uleam.edu.ec`),
      ...reales.slice(3).map((c) => c.email),
    ];
    expect(new Set(emails).size).toBe(35);
    const spoofed: string[] = [];
    const statuses: number[] = [];
    for (const [i, email] of emails.entries()) {
      const fake = `198.51.${100 + (i % 100)}.${i + 1}`;
      spoofed.push(fake);
      const r = await nginx('POST', `${API}/auth/login`, { headers: { 'X-Forwarded-For': fake }, json: { email, password: 'Incorrecta-Para-Ataque-1!' } });
      statuses.push(r.status);
    }
    const count = (code: number) => statuses.filter((s) => s === code).length;
    const first429 = statuses.indexOf(429);
    const peers = new Set(dockerLogs(nginxName).split('\n').filter((line) => line.includes('POST /api/v1/auth/login')).map((line) => line.split(' ')[0]!));
    const rows = await attack.db.query(`SELECT "accion", "ip_origen"::text AS ip, count(*)::int AS total FROM ${attack.s}."auditoria" WHERE "fecha_hora" >= $1 AND "ip_origen" IS NOT NULL GROUP BY 1,2 ORDER BY 1,2`, [t0]) as Array<{ accion: string; ip: string; total: number }>;
    const auditIps = new Set(rows.map((r) => r.ip.replace(/\/\d+$/, '')));
    EVIDENCIA('P5', { statuses401: count(401), statuses429: count(429), primer429EnIndice: first429, otros: statuses.filter((s) => s !== 401 && s !== 429), peerVistoPorNginx: [...peers], auditoria: rows });
    expect(count(429), 'el límite por IP no se activó (¿XFF falsificable?)').toBeGreaterThan(0);
    expect(first429).toBeGreaterThanOrEqual(30);
    expect(rows.length, 'no hay filas de auditoría con IP para el intento').toBeGreaterThan(0);
    for (const fake of spoofed) expect(auditIps.has(fake), `auditoría con IP falsificada ${fake}`).toBe(false);
    expect([...auditIps].every((ip) => peers.has(ip)), 'la IP auditada no coincide con el peer real visto por nginx').toBe(true);
  });

  it('[P6] la víctima con cookie de dispositivo no queda bloqueada por el atacante', async () => {
    const victima = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
    const first = await nginx('POST', `${API}/auth/login`, { json: { email: victima.email, password: victima.password } });
    expect(first.status).toBe(200);
    const device = cookieValue(first.setCookies, 'titulacion_dispositivo');
    expect(device, 'no se emitió cookie de dispositivo').toBeTruthy();
    const attackerStatuses: number[] = [];
    for (let i = 0; i < 11; i += 1) attackerStatuses.push((await nginx('POST', `${API}/auth/login`, { json: { email: victima.email, password: `Incorrecta-${i}-Ataque!` } })).status);
    const again = await nginx('POST', `${API}/auth/login`, { headers: { Cookie: `titulacion_dispositivo=${encodeURIComponent(device!)}` }, json: { email: victima.email, password: victima.password } });
    const sinCookie = await nginx('POST', `${API}/auth/login`, { json: { email: victima.email, password: victima.password } });
    EVIDENCIA('P6', { atacante: attackerStatuses, victimaConDispositivo: again.status, victimaSinCookie: sinCookie.status });
    expect(again.status).toBe(200);
    expect(sinCookie.status).toBe(429);
  });

  it('[P7] nginx aplica limit_req cuando los límites son bajos y no con los de por defecto', async () => {
    // Deja drenar el cubo de limit_req (20r/s, ráfaga 40) tras los inicios de sesión rápidos de las sondas anteriores.
    const drain = () => new Promise((resolve) => setTimeout(resolve, 5_000));
    await drain();
    const burst = (port: number) => Promise.all(Array.from({ length: 25 }, () => call(port, 'GET', `${API}/auth/csrf`)));
    const low = await burst(PORT_LOW);
    await drain();
    const normal = await burst(PORT);
    const tally = (rs: Raw[]) => rs.reduce<Record<number, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
    const lowRejected = low.filter((r) => r.status === 429);
    const normalRejected = normal.filter((r) => r.status === 429);
    EVIDENCIA('P7', { limitesBajos_2rs_burst2: tally(low), limitesPorDefecto: tally(normal), origen429Bajos: lowRejected[0] ? { server: lowRejected[0].headers.server, esPaginaNginx: /<center>nginx<\/center>/i.test(lowRejected[0].text) } : null, origen429PorDefecto: normalRejected.map((r) => ({ esPaginaNginx: /<center>nginx<\/center>/i.test(r.text), cuerpo: r.text.slice(0, 120), retryAfter: r.headers['retry-after'] })) });
    expect(lowRejected.length).toBeGreaterThan(0);
    expect(lowRejected.every((r) => /<center>nginx<\/center>/i.test(r.text)), 'el 429 no proviene de nginx').toBe(true);
    expect(normal.filter((r) => r.status === 429)).toHaveLength(0);
  });

  it('[P8] formas de path traversal enviadas crudas a nginx no devuelven datos de otro recurso', async () => {
    const headers = await bearer(attack, e.estE);
    const probes = [`${API}/temas/..%2Fusuarios`, `${API}/temas/%2e%2e/usuarios`, `${API}//usuarios`, `${API}/temas/..%2f..%2fauditoria`, `${API}/auth/%2e%2e/usuarios`];
    const out = [];
    for (const path of probes) {
      const r = await nginx('GET', path, { headers });
      const spaShell = r.status === 200 && /text\/html/.test(r.headers['content-type'] ?? '') && /<div id="root"/.test(r.text);
      out.push({ path, status: r.status, contentType: r.headers['content-type'], spaShell, cuerpo: r.text.slice(0, 80) });
    }
    EVIDENCIA('P8', out);
    for (const o of out) if (!o.spaShell) expect([400, 403, 404], `${o.path} devolvió ${o.status}`).toContain(o.status);
  });

  it('[P9] límites de cuerpo: 200 kB JSON -> 413, 13 MiB multipart -> 413 en nginx, subida ajena -> 403 rápido', async () => {
    const huge = await nginx('POST', `${API}/auth/login`, { json: { email: 'a@live.uleam.edu.ec', password: 'x'.repeat(200_000) } });
    const hugeApi = await nginx('POST', `${API}/periodos/${e.periodoAbierto}/grupos`, { headers: await bearer(attack, e.estK), json: { nombre: 'x'.repeat(200_000) } });
    const url = `${API}/periodos/${periodo}/asignaciones-tema/${trabajos[0]!.asignacionId}/documentos-pat`;
    const ajeno = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
    const ajenoHeaders = await bearer(attack, ajeno);
    const plantilla = (await attack.db.query(`SELECT "id" FROM ${attack.s}."plantilla_pat" WHERE "periodo_id"=$1`, [periodo]) as Array<{ id: string }>)[0]!.id;
    const pdfWith = (mib: number) => Buffer.concat([pdfBenigno(), Buffer.alloc(Math.floor(mib * 1024 * 1024), 0x41)]);
    const big = multipart({ plantilla_id: plantilla }, { name: 'pat.pdf', mime: PDF_MIME, content: pdfWith(13) });
    const tooBig = await nginx('POST', url, { headers: { ...ajenoHeaders, 'Content-Type': big.contentType }, body: big.body });
    const nine = multipart({ plantilla_id: plantilla }, { name: 'pat.pdf', mime: PDF_MIME, content: pdfWith(9) });
    const viaNginx = await nginx('POST', url, { headers: { ...ajenoHeaders, 'Content-Type': nine.contentType }, body: nine.body });
    const direct = await call(attack.port, 'POST', url.replace(API, ''), { headers: { ...ajenoHeaders, 'Content-Type': nine.contentType }, body: nine.body });
    // Variante "cuerpo detenido": 9 MiB declarados y solo 64 KiB enviados (como A6 directo). Informativa.
    const stalled = await new Promise<{ status: number | 'sin respuesta'; ms: number }>((resolve) => {
      const started = performance.now();
      const boundary = '----ataque-preautorizacion';
      const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="plantilla_id"\r\n\r\n${plantilla}\r\n--${boundary}\r\nContent-Disposition: form-data; name="archivo"; filename="pat.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n`);
      const req = httpRequest({ host: '127.0.0.1', port: PORT, method: 'POST', path: url, headers: { ...ajenoHeaders, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(9 * 1024 * 1024) } });
      const timer = setTimeout(() => { req.destroy(); resolve({ status: 'sin respuesta', ms: Math.round(performance.now() - started) }); }, 5_000);
      req.on('response', (response) => { clearTimeout(timer); response.resume(); req.destroy(); resolve({ status: response.statusCode ?? 0, ms: Math.round(performance.now() - started) }); });
      req.on('error', () => undefined);
      req.write(head);
      req.write(Buffer.alloc(64 * 1024, 0x41));
    });
    EVIDENCIA('P9', {
      json200kB_login: { status: huge.status }, json200kB_api: { status: hugeApi.status },
      multipart13MiB: { status: tooBig.status, esPaginaNginx: /<center>nginx<\/center>/i.test(tooBig.text) },
      subidaAjena9MiB_porNginx: { status: viaNginx.status, ms: viaNginx.ms }, subidaAjena9MiB_directoAlBackend: { status: direct.status, ms: direct.ms },
      cuerpoDetenido_informativo: stalled,
    });
    expect(huge.status).toBe(413);
    expect(hugeApi.status).toBe(413);
    expect(tooBig.status).toBe(413);
    expect(/<center>nginx<\/center>/i.test(tooBig.text), '13 MiB no fue rechazado por nginx').toBe(true);
    expect([403, 404]).toContain(viaNginx.status);
    expect(viaNginx.ms, 'la subida ajena tardó demasiado').toBeLessThan(5_000);
  });

  it('[P10] controles de rol y propiedad a través de nginx', async () => {
    const A = (path: string, cuenta: Cuenta) => bearer(attack, cuenta).then((headers) => nginx('GET', `${API}${path}`, { headers }));
    const base = `/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionGrupal}/documentos-pat`;
    const r = {
      controlPostulacionPropia: (await A(`/periodos/${e.periodoAbierto}/postulaciones/${e.postulacionGrupalAbierta}`, e.estL)).status,
      postulacionAjena: (await A(`/periodos/${e.periodoAbierto}/postulaciones/${e.postulacionGrupalAbierta}`, e.estE)).status,
      controlAsignacionPropia: (await A(`/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionIndividual}`, e.estE)).status,
      asignacionAjena: (await A(`/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionIndividual}`, e.estA)).status,
      controlPatPropio: (await A(`${base}/${e.documentoGrupal}`, e.estB)).status,
      patAjeno: (await A(`${base}/${e.documentoGrupal}`, e.estE)).status,
      exMiembroLista: (await A(base, e.exIntegrante)).status,
      exMiembroUltima: (await A(`${base}/ultima`, e.exIntegrante)).status,
      exMiembroDocumento: (await A(`${base}/${e.documentoGrupal}`, e.exIntegrante)).status,
      adminUsuarios: (await A('/usuarios', e.estA)).status,
      adminAuditoria: (await A('/auditoria', e.estA)).status,
      adminImportaciones: (await A('/importaciones/docentes', e.estA)).status,
      anonimoUsuarios: (await nginx('GET', `${API}/usuarios`)).status,
      anonimoPat: (await nginx('GET', `${API}${base}/${e.documentoGrupal}`)).status,
    };
    EVIDENCIA('P10', r);
    expect([r.controlPostulacionPropia, r.controlAsignacionPropia, r.controlPatPropio]).toEqual([200, 200, 200]);
    expect([r.postulacionAjena, r.asignacionAjena, r.patAjeno, r.exMiembroLista, r.exMiembroUltima, r.exMiembroDocumento]).toEqual([404, 404, 404, 404, 404, 404]);
    expect([r.adminUsuarios, r.adminAuditoria, r.adminImportaciones]).toEqual([403, 403, 403]);
    expect([r.anonimoUsuarios, r.anonimoPat]).toEqual([401, 401]);
  });

  it('[P11] archivos maliciosos rechazados con 400 a través de nginx y PDF benigno aceptado', async () => {
    const plantilla = (await attack.db.query(`SELECT "id" FROM ${attack.s}."plantilla_pat" WHERE "periodo_id"=$1`, [periodo]) as Array<{ id: string }>)[0]!.id;
    const subir = async (trabajo: TrabajoIndividual, name: string, mime: string, content: Buffer) => {
      const m = multipart({ plantilla_id: plantilla }, { name, mime, content });
      return nginx('POST', `${API}/periodos/${periodo}/asignaciones-tema/${trabajo.asignacionId}/documentos-pat`, { headers: { ...(await bearer(attack, trabajo.titular)), 'Content-Type': m.contentType }, body: m.body });
    };
    const docx = await subir(trabajos[1]!, 'externo.docx', DOCX_MIME, docxRelacionExterna());
    const openAction = await subir(trabajos[2]!, 'open.pdf', PDF_MIME, pdfOpenAction());
    const js = await subir(trabajos[3]!, 'js.pdf', PDF_MIME, pdfJavaScript());
    const benigno = await subir(trabajos[4]!, 'pat.pdf', PDF_MIME, pdfBenigno());
    const versiones = (await attack.db.query(`SELECT count(*)::int AS total FROM ${attack.s}."documento_pat" WHERE "asignacion_tema_id" = ANY($1)`, [[trabajos[1]!, trabajos[2]!, trabajos[3]!].map((t) => t.asignacionId)]) as Array<{ total: number }>)[0]!.total;
    EVIDENCIA('P11', { docxAttachedTemplateExterno: docx.status, pdfOpenAction: openAction.status, pdfJavaScript: js.status, pdfBenigno: benigno.status, mensajeBenigno: benigno.status >= 400 ? benigno.text.slice(0, 160) : undefined, versionesMaliciosasPersistidas: versiones });
    expect([docx.status, openAction.status, js.status]).toEqual([400, 400, 400]);
    expect(versiones).toBe(0);
    expect([200, 201]).toContain(benigno.status);
  });

  const smallUpload = () => multipart({ plantilla_id: '00000000-0000-4000-8000-000000000000' }, { name: 'pat.pdf', mime: PDF_MIME, content: pdfBenigno() });

  it('[P13] el location de subidas devuelve las mismas cabeceras de seguridad y Cache-Control: no-store que el resto del API', async () => {
    const upload = smallUpload();
    const out: Array<{ path: string; status: number; missing: string[]; duplicados: string[]; cache?: string; server?: string }> = [];
    for (const route of UPLOAD_ROUTES(periodo, trabajos[0]!.asignacionId)) {
      for (const path of [`${API}${route}`, `${API}${route}/`]) {
        const r = await nginx('POST', path, { headers: { 'Content-Type': upload.contentType }, body: upload.body });
        out.push({ path, status: r.status, missing: missingSecurityHeaders(r), duplicados: duplicated(r), cache: r.headers['cache-control'], server: r.headers.server });
      }
    }
    const general = await nginx('GET', `${API}/usuarios/me`);
    EVIDENCIA('P13', { subidas: out, generalNoAutenticado: { status: general.status, cache: general.headers['cache-control'] } });
    for (const o of out) {
      // Sin token el backend responde 401 antes de leer el archivo: la respuesta atraviesa el location de subidas.
      expect([401, 404], `${o.path} devolvió ${o.status}`).toContain(o.status);
      expect(o.missing, `faltan cabeceras en ${o.path}`).toEqual([]);
      expect(o.duplicados, `cabeceras duplicadas en ${o.path}`).toEqual([]);
      expect(o.cache, `cache-control en ${o.path}`).toMatch(/no-store/);
      expect(o.server).toMatch(/^nginx$/i);
    }
    expect(general.headers['cache-control']).toMatch(/no-store/);
  });

  it('[P14] el upstream recibe las rutas sin /api/v1, sin doble prefijo y con la query intacta (subidas, API general y auth)', async () => {
    const before = fake.received.length;
    const query = '?pagina=2&filtro=a%20b&lista=x,y';
    const upload = smallUpload();
    const expected: Array<{ sent: string; upstream: string; status?: number }> = [];
    for (const route of UPLOAD_ROUTES(periodo, trabajos[0]!.asignacionId)) {
      for (const suffix of ['', '/']) {
        const sent = `${API}${route}${suffix}${query}`;
        const r = await call(PORT_FAKE, 'POST', sent, { headers: { 'Content-Type': upload.contentType }, body: upload.body });
        expected.push({ sent, upstream: `${route}${suffix}${query}`, status: r.status });
      }
    }
    for (const [sent, upstream] of [[`${API}/temas${query}`, `/temas${query}`], [`${API}/periodos/${periodo}/grupos${query}`, `/periodos/${periodo}/grupos${query}`], [`${API}/auth/csrf${query}`, `/auth/csrf${query}`]] as const) {
      const r = await call(PORT_FAKE, 'GET', sent);
      expected.push({ sent, upstream, status: r.status });
    }
    const received = fake.received.slice(before).map((item) => item.url);
    EVIDENCIA('P14', { enviados: expected, recibidosPorUpstream: received });
    for (const item of expected) {
      expect(item.status, `${item.sent} no llegó al upstream falso`).toBe(200);
      expect(received, `${item.sent} no llegó como ${item.upstream}`).toContain(item.upstream);
    }
    expect(received.filter((url) => url.startsWith('/api/v1') || url.includes('/api/v1/')), 'el upstream recibió un prefijo /api/v1').toEqual([]);
    expect(received).toHaveLength(expected.length);
  });

  it('[P15] /api/v1/docs sigue respondiendo 404 en nginx y nunca llega al upstream', async () => {
    const before = fake.received.length;
    const out = [];
    for (const path of [`${API}/docs`, `${API}/docs-json`, `${API}/docs/`, `${API}/docs/swagger-ui-init.js`, `${API}/docs?x=1`]) {
      const r = await call(PORT_FAKE, 'GET', path);
      out.push({ path, status: r.status, esPaginaNginx: /<center>nginx<\/center>/i.test(r.text) });
    }
    const leaked = fake.received.slice(before);
    EVIDENCIA('P15', { respuestas: out, recibidosPorUpstream: leaked });
    for (const o of out) {
      expect(o.status, o.path).toBe(404);
      expect(o.esPaginaNginx, `${o.path}: el 404 no viene de nginx`).toBe(true);
    }
    expect(leaked).toEqual([]);
  });

  it('[P16] más de LIMIT_CONN_UPLOAD_PER_IP subidas simultáneas desde una IP se rechazan con 429 y el API normal sigue respondiendo', async () => {
    const total = UPLOAD_CONN_DEFAULT + 4;
    const route = `${API}${UPLOAD_ROUTES(periodo, trabajos[0]!.asignacionId)[1]!}?retener=1`;
    const upload = smallUpload();
    const pending = Array.from({ length: total }, () => call(PORT_FAKE, 'POST', route, { headers: { 'Content-Type': upload.contentType }, body: upload.body }));
    const rejected: Raw[] = [];
    for (const promise of pending) void promise.then((r) => { if (r.status === 429) rejected.push(r); }, () => undefined);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && (fake.holding() < UPLOAD_CONN_DEFAULT || rejected.length < total - UPLOAD_CONN_DEFAULT)) await new Promise((r) => setTimeout(r, 100));
    const heldPeak = fake.holding();
    // Con las subidas saturadas: el API general y auth (zona `perip`, no `perip_upload`) siguen pasando; otra subida no.
    const general = await call(PORT_FAKE, 'GET', `${API}/temas`);
    const auth = await call(PORT_FAKE, 'GET', `${API}/auth/csrf`);
    const extraUpload = await call(PORT_FAKE, 'POST', `${API}${UPLOAD_ROUTES(periodo, trabajos[0]!.asignacionId)[3]!}`, { headers: { 'Content-Type': upload.contentType }, body: upload.body });
    fake.release();
    const results = await Promise.all(pending);
    const tally = results.reduce<Record<number, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
    EVIDENCIA('P16', { enviadas: total, retenidasEnUpstream: heldPeak, resultados: tally, apiGeneral: general.status, auth: auth.status, subidaExtra: extraUpload.status, origen429: rejected[0] ? /<center>nginx<\/center>/i.test(rejected[0].text) : null });
    expect(heldPeak).toBe(UPLOAD_CONN_DEFAULT);
    expect(tally[200]).toBe(UPLOAD_CONN_DEFAULT);
    expect(tally[429]).toBe(total - UPLOAD_CONN_DEFAULT);
    expect(rejected.every((r) => /<center>nginx<\/center>/i.test(r.text)), 'el 429 no proviene de nginx').toBe(true);
    expect(general.status).toBe(200);
    expect(auth.status).toBe(200);
    expect(extraUpload.status).toBe(429);
  });

  it('[P12] exposición en el host: puertos en 127.0.0.1, LAN sin acceso, Redis exige autenticación', async () => {
    const lines = docker('ps', '--format', '{{.Names}}|{{.Ports}}').split('\n').filter((l) => l.startsWith('titulacion_backend') || l.startsWith('titulacion-attack-nginx'));
    const mappings: Array<{ container: string; bind: string; hostPort: number }> = [];
    for (const line of lines) {
      const [container, ports] = line.split('|') as [string, string];
      for (const m of ports.matchAll(/(\[[^\]]+\]|[\d.]+):(\d+)->\d+\/tcp/g)) mappings.push({ container, bind: m[1]!, hostPort: Number(m[2]) });
    }
    const nonLoopback = mappings.filter((m) => m.bind !== '127.0.0.1' && m.bind !== '[::1]');
    const base = baseEnvironment();
    const s3Port = base.S3_ENDPOINT ? Number(new URL(base.S3_ENDPOINT).port || 80) : 8333;
    const ports = [...new Set([...mappings.map((m) => m.hostPort), base.REDIS_PORT, base.SMTP_PORT, 8025, s3Port])].sort((a, b) => a - b);
    const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')).map((i) => i!.address);
    const lanResults: Array<{ host: string; port: number; estado: string }> = [];
    for (const host of lan) for (const port of ports) lanResults.push({ host, port, estado: await tcpState(host, port) });
    // Control positivo: el backend de la prueba escucha en 0.0.0.0, así que el método de sondeo debe verlo abierto en la LAN.
    const control = lan[0] ? await tcpState(lan[0], attack.port) : 'sin LAN';
    const noauth = await new Promise<string>((resolve) => {
      const socket = connect({ host: '127.0.0.1', port: base.REDIS_PORT });
      socket.setTimeout(3000, () => { socket.destroy(); resolve('timeout'); });
      socket.once('connect', () => socket.write('PING\r\n'));
      socket.once('data', (data) => { socket.destroy(); resolve(data.toString().trim()); });
      socket.once('error', (error) => resolve(`error ${error.message}`));
    });
    EVIDENCIA('P12', { publicados: mappings, noLoopback: nonLoopback, lan, abiertosEnLan: lanResults.filter((r) => r.estado === 'ABIERTO'), resumenLan: lanResults.reduce<Record<string, number>>((a, r) => ({ ...a, [r.estado]: (a[r.estado] ?? 0) + 1 }), {}), controlPositivoBackend0000: control, redisSinAuthRechazado: noauth.startsWith('-NOAUTH') });
    expect(mappings.length).toBeGreaterThan(0);
    expect(nonLoopback, 'puertos publicados fuera de 127.0.0.1').toEqual([]);
    expect(lan.length, 'no se halló una IPv4 de LAN').toBeGreaterThan(0);
    expect(lanResults.filter((r) => r.estado === 'ABIERTO')).toEqual([]);
    expect(control, 'el sondeo LAN no detecta ni un puerto abierto conocido').toBe('ABIERTO');
    expect(noauth.startsWith('-NOAUTH')).toBe(true);
  });
});

function EVIDENCIA(probe: string, data: unknown): void { EVIDENCE(probe, data); }
