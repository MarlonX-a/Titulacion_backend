// Sondas de ataque contra el nginx del frontend que publica el backend en /api/v1/ (plan de
// seguridad, «Verificación», paso 4). Solo para el entorno local del proyecto. Sin dependencias:
// fetch, node:http(s), node:net y node:child_process.
//
// Uso:
//   node scripts/attack-probes.mjs [baseUrl] [opciones]
//   node scripts/attack-probes.mjs --help
//
//   baseUrl                     por defecto http://127.0.0.1:8080 (el contenedor nginx del frontend)
//   --lan-host <ip>             dirección no loopback de esta máquina: 6379/6381/8025/1025/9000/9001/8333 NO deben responder
//   --heavy                     activa la ráfaga contra limit_req (300 GET)
//   --frontend-dir <ruta>       repositorio del frontend; de nginx/security-headers.conf se leen las cabeceras
//                               esperadas (por defecto ../Titulacion---Frontend; si no existe se usa la copia de abajo)
//
//   Credenciales (sondas autenticadas). Nunca se escriben en el código ni en la salida:
//   --email <correo>            o ATTACK_PROBE_EMAIL
//   --password <clave>          o ATTACK_PROBE_PASSWORD (preferible: la variable no queda en el historial)
//   --extra-emails <a,b,...>    o ATTACK_PROBE_EXTRA_EMAILS: más ESTUDIANTE con la misma clave (inundación multiusuario)
//   Cuentas sembradas por `npm run db:seed-dev-users`: estudiante1.dev@live.uleam.edu.ec (principal) y
//   estudiante2.dev@live.uleam.edu.ec, estudiante3.dev@live.uleam.edu.ec (extra); la clave es la compartida de
//   desarrollo definida en scripts/seed-dev-users.mjs. Para las sondas de archivos el estudiante principal necesita
//   una asignación de tema VIGENTE en un período con plantilla PAT vigente; sin ella esas sondas quedan SKIPPED o
//   se ejecutan en modo «ajeno» (el rechazo lo da la autorización) y la salida lo indica.
//   --periodo <uuid> --asignacion <uuid>   destino de subida explícito (si no, se busca en asignaciones-tema/me)
//
//   Inundación de subidas y memoria:
//   --flood-count <n>           subidas simultáneas (def. 30)
//   --flood-mib <n>             tamaño de cada cuerpo en MiB (def. 9; nginx admite 12m y el backend 10 MiB)
//   --backend-pid <pid>         PID del proceso Node del backend: se muestrea su RSS antes/durante/después
//                               (tasklist en Windows, `ps -o rss=` en el resto). Sin él la memoria no se mide y
//                               la sonda de memoria queda SKIPPED, nunca PASS.
//   --max-rss-delta-mib <n>     umbral del pico de RSS sobre la línea base (def. 64)
//
// Cada sonda imprime PASS, FAIL o SKIPPED con el motivo; el proceso termina con 1 si hay algún FAIL
// y con 2 si el destino no parece el backend de titulación.
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ARCHIVOS_MALICIOSOS, PDF_MIME } from '../test/fixtures/attack/archivos-maliciosos.mjs';

const USAGE = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0];
const args = process.argv.slice(2);
const VALUED = new Set(['--lan-host', '--frontend-dir', '--email', '--password', '--extra-emails', '--periodo', '--asignacion', '--flood-count', '--flood-mib', '--backend-pid', '--max-rss-delta-mib']);
const flag = (name) => args.includes(name);
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const numberOption = (name, fallback) => {
  const value = option(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) { console.error(`${name} debe ser un número positivo.`); process.exit(2); }
  return parsed;
};
if (flag('--help') || flag('-h')) { console.log(USAGE.replace(/^\/\/ ?/gm, '')); process.exit(0); }

const positional = args.filter((arg, index) => !arg.startsWith('--') && !VALUED.has(args[index - 1]));
const base = (positional[0] ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const api = `${base}/api/v1`;
const lanHost = option('--lan-host');
const heavy = flag('--heavy');
const email = option('--email') ?? process.env.ATTACK_PROBE_EMAIL;
const password = option('--password') ?? process.env.ATTACK_PROBE_PASSWORD;
const extraEmails = (option('--extra-emails') ?? process.env.ATTACK_PROBE_EXTRA_EMAILS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
const floodCount = Math.floor(numberOption('--flood-count', 30));
const floodMib = numberOption('--flood-mib', 9);
const backendPid = option('--backend-pid');
const maxRssDeltaMib = numberOption('--max-rss-delta-mib', 64);
if (backendPid !== undefined && !/^\d+$/.test(backendPid)) { console.error('--backend-pid debe ser un número de proceso.'); process.exit(2); }

const results = [];
const record = (name, status, detail) => results.push({ name, status, detail });
const pass = (detail = '') => ({ status: 'PASS', detail });
const fail = (detail) => ({ status: 'FAIL', detail });
const skipped = (detail) => ({ status: 'SKIPPED', detail });

async function probe(name, fn) {
  try {
    const outcome = await fn();
    record(name, outcome?.status ?? 'PASS', outcome?.detail ?? '');
  } catch (error) {
    record(name, 'FAIL', error instanceof Error ? error.message : String(error));
  }
}

const get = (url, init = {}) => fetch(url, { redirect: 'manual', ...init });

/**
 * Solicitud HTTP cruda: no normaliza la ruta (fetch resolvería `..`, `%2e%2e` y `\`). Con `body` y
 * `declaredLength` mayor que el cuerpo, deja el envío incompleto (no se usa por defecto).
 */
function raw(method, path, { headers = {}, body } = {}) {
  const target = new URL(base);
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const started = performance.now();
  return new Promise((resolvePromise, reject) => {
    const req = send({ host: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80), method, path, headers: { ...headers, ...(body ? { 'Content-Length': String(body.length) } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, rawHeaders: res.rawHeaders, text: Buffer.concat(chunks).toString('utf8'), ms: Math.round(performance.now() - started) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const apiPath = (path) => `${new URL(api).pathname}${path}`;

function tcpOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolvePromise) => {
    const socket = connect({ host, port });
    const done = (open) => { socket.destroy(); resolvePromise(open); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function multipart(fields, file) {
  const boundary = `----sonda${randomBytes(8).toString('hex')}`;
  const parts = Object.entries(fields).map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="archivo"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`), file.content, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

// ── Cabeceras de seguridad esperadas: nginx/security-headers.conf del frontend ─────────────────
// Copia de respaldo (frontend en la rama security/hardening) para cuando el repositorio no está al lado.
const CABECERAS_RESPALDO = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};
function cabecerasEsperadas() {
  const repo = resolve(option('--frontend-dir') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'Titulacion---Frontend'));
  const file = join(repo, 'nginx', 'security-headers.conf');
  if (!existsSync(file)) return { origen: `copia embebida (no existe ${file})`, cabeceras: CABECERAS_RESPALDO };
  const cabeceras = {};
  for (const match of readFileSync(file, 'utf8').matchAll(/^\s*add_header\s+([A-Za-z-]+)\s+"([^"]*)"\s+always\s*;/gm)) cabeceras[match[1].toLowerCase()] = match[2];
  if (!Object.keys(cabeceras).length) return { origen: `copia embebida (${file} sin add_header reconocibles)`, cabeceras: CABECERAS_RESPALDO };
  return { origen: file, cabeceras };
}

/** Diferencias de una respuesta frente a las cabeceras esperadas, sin versión en Server y sin duplicados. */
function problemasDeCabeceras(response, esperadas) {
  const problemas = [];
  for (const [name, value] of Object.entries(esperadas)) {
    const actual = response.headers[name];
    if (actual === undefined) problemas.push(`falta ${name}`);
    else if (String(actual) !== value) problemas.push(`${name}="${actual}"`);
    const veces = response.rawHeaders.filter((item, index) => index % 2 === 0 && item.toLowerCase() === name).length;
    if (veces > 1) problemas.push(`${name} duplicada (${veces})`);
  }
  if (!/frame-ancestors\s+'none'/.test(String(response.headers['content-security-policy'] ?? '')) && !response.headers['x-frame-options']) problemas.push('sin frame-ancestors ni X-Frame-Options');
  const server = String(response.headers.server ?? '');
  if (/\d/.test(server)) problemas.push(`Server con versión: ${server}`);
  if (response.headers['x-powered-by']) problemas.push(`X-Powered-By: ${response.headers['x-powered-by']}`);
  return problemas;
}

// ── Memoria del backend ────────────────────────────────────────────────────────────────────────
const execFileAsync = promisify(execFile);
async function rssKiB(pid) {
  if (process.platform === 'win32') {
    // "node.exe","1234","Console","1","123.456 K": el último campo es el conjunto de trabajo en KiB.
    const { stdout } = await execFileAsync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true });
    const fields = stdout.trim().split('\n')[0]?.match(/"([^"]*)"/g)?.map((item) => item.slice(1, -1)) ?? [];
    if (fields[1] !== String(pid)) throw new Error(`no existe el proceso ${pid}`);
    return Number(fields.at(-1).replace(/\D/g, ''));
  }
  const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)]);
  const value = Number(stdout.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error(`no existe el proceso ${pid}`);
  return value;
}
function muestreador(pid) {
  const muestras = [];
  let activo = true;
  const ciclo = (async () => {
    while (activo) {
      muestras.push(await rssKiB(pid));
      await new Promise((r) => setTimeout(r, 200));
    }
  })();
  return { async detener() { activo = false; await ciclo; return muestras; } };
}
const mib = (kib) => (kib / 1024).toFixed(1);

// ── Comprobación previa: el destino debe ser el backend de titulación detrás del proxy ─────────
try {
  const response = await get(`${api}/auth/csrf`);
  const body = await response.json().catch(() => ({}));
  if (typeof body.csrf_token !== 'string') throw new Error(`HTTP ${response.status} sin csrf_token`);
} catch (error) {
  console.error(`El destino ${api} no parece el backend de titulación (${error instanceof Error ? error.message : String(error)}). No se ejecutaron sondas.`);
  process.exit(2);
}

async function login(correo) {
  const response = await get(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: correo, password }) });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 200 || typeof body.access_token !== 'string') throw new Error(`login de ${correo}: HTTP ${response.status}`);
  return body.access_token;
}
const sesiones = [];
let errorSesion = '';
if (email && password) {
  for (const correo of [email, ...extraEmails]) {
    try { sesiones.push({ correo, token: await login(correo) }); } catch (error) { errorSesion += `${error.message}; `; }
  }
}
const principal = sesiones.find((item) => item.correo === email);
const sinCredenciales = !email || !password ? 'faltan --email/--password (o ATTACK_PROBE_EMAIL/ATTACK_PROBE_PASSWORD)' : !principal ? `no se pudo iniciar sesión: ${errorSesion}` : '';
if (sinCredenciales && email && password) record('Inicio de sesión de la cuenta de sondeo', 'FAIL', sinCredenciales);
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

/** Destino de subida: explícito, o la primera asignación VIGENTE del estudiante principal. */
async function destinoSubida() {
  if (!principal) return null;
  const periodo = option('--periodo');
  const asignacion = option('--asignacion');
  let propio = null;
  if (periodo && asignacion) propio = { periodo, asignacion };
  else {
    const periodos = await (await get(`${api}/periodos?limit=100`, { headers: bearer(principal.token) })).json().catch(() => ({}));
    for (const item of periodos.data ?? []) {
      const mias = await (await get(`${api}/periodos/${item.id}/asignaciones-tema/me`, { headers: bearer(principal.token) })).json().catch(() => ({}));
      const vigente = (mias.data ?? []).find((a) => a.estado === 'VIGENTE');
      if (vigente) { propio = { periodo: item.id, asignacion: vigente.id }; break; }
    }
    if (!propio && periodos.data?.[0]) return { periodo: periodos.data[0].id, asignacion: randomUUID(), propio: false, plantilla: randomUUID() };
  }
  if (!propio) return null;
  const plantilla = await (await get(`${api}/periodos/${propio.periodo}/plantillas-pat/vigente`, { headers: bearer(principal.token) })).json().catch(() => ({}));
  return { ...propio, propio: true, plantilla: typeof plantilla.id === 'string' ? plantilla.id : null };
}
const subidaUrl = (destino) => `/periodos/${destino.periodo}/asignaciones-tema/${destino.asignacion}/documentos-pat`;

// ── Sondas ─────────────────────────────────────────────────────────────────────────────────────
await probe('Server no revela versión', async () => {
  const response = await get(`${base}/`);
  const server = response.headers.get('server') ?? '';
  if (/\d/.test(server)) return fail(`Server: ${server}`);
  return pass(server ? `Server: ${server}` : 'sin cabecera Server');
});

for (const path of ['/docs', '/docs/', '/docs-json', '/docs/swagger-ui-init.js']) {
  await probe(`GET /api/v1${path} -> 404`, async () => {
    const response = await get(`${api}${path}`);
    if (response.status !== 404) return fail(`HTTP ${response.status}`);
  });
}

for (const path of ['/auth/csrf', '/usuarios/me', '/periodos']) {
  await probe(`Cache-Control no-store en GET /api/v1${path}`, async () => {
    const response = await get(`${api}${path}`);
    const header = response.headers.get('cache-control') ?? '';
    if (!/no-store/i.test(header)) return fail(`HTTP ${response.status}, Cache-Control: "${header}"`);
    return pass(`HTTP ${response.status}`);
  });
}

{
  const { origen, cabeceras } = cabecerasEsperadas();
  const home = await raw('GET', '/').catch(() => null);
  const asset = home ? /\/assets\/[^"'\s]+\.(?:js|css)/.exec(home.text)?.[0] : undefined;
  const subidaAnonima = multipart({ plantilla_id: randomUUID() }, { name: 'pat.pdf', mime: PDF_MIME, content: Buffer.from('%PDF-1.4\n%%EOF\n') });
  const casos = [
    ['estático GET /', () => Promise.resolve(home), false],
    [`estático GET ${asset ?? '/assets/* (no encontrado en index.html)'}`, () => (asset ? raw('GET', asset) : Promise.reject(new Error('index.html no referencia /assets/*'))), false],
    ['API GET /api/v1/auth/csrf', () => raw('GET', apiPath('/auth/csrf')), true],
    ['API GET /api/v1/usuarios/me (401)', () => raw('GET', apiPath('/usuarios/me')), true],
    ['location de subidas POST /api/v1/periodos/:id/plantillas-pat (401)', () => raw('POST', apiPath(`/periodos/${randomUUID()}/plantillas-pat`), { headers: { 'Content-Type': subidaAnonima.contentType }, body: subidaAnonima.body }), true],
    ['location de subidas POST /api/v1/importaciones/docentes/validar (401)', () => raw('POST', apiPath('/importaciones/docentes/validar'), { headers: { 'Content-Type': subidaAnonima.contentType }, body: subidaAnonima.body }), true],
  ];
  for (const [label, run, esApi] of casos) {
    await probe(`Cabeceras de seguridad: ${label}`, async () => {
      const response = await run();
      if (!response) return fail('sin respuesta');
      const problemas = problemasDeCabeceras(response, cabeceras);
      if (esApi && !/no-store/i.test(String(response.headers['cache-control'] ?? ''))) problemas.push(`Cache-Control="${response.headers['cache-control'] ?? ''}"`);
      if (problemas.length) return fail(`HTTP ${response.status}: ${problemas.join('; ')}`);
      return pass(`HTTP ${response.status}; esperadas desde ${origen}`);
    });
  }
}

{
  // Variantes de recorrido de rutas enviadas crudas. Ninguna debe alcanzar un recurso de ADMIN, la
  // documentación ni archivos del sistema: se acepta 400/401/403/404 o el index.html de la SPA.
  const variantes = [
    '/..%2F..%2F..%2Fetc%2Fpasswd',
    '/temas/..%2Fusuarios',
    '/temas/..%2f..%2fauditoria',
    '/temas/%2e%2e/usuarios',
    '/temas/%2E%2E/%2E%2E/auditoria',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/temas/%252e%252e%252fusuarios',
    '/temas/%252e%252e/usuarios',
    '/temas/..%255cusuarios',
    '/temas/..\\usuarios',
    '/temas/..%5cusuarios',
    '/temas/%5c..%5cusuarios',
    '/temas;/../usuarios',
    '/temas/..;/usuarios',
    '/auth/csrf;/../../usuarios',
    '/docs;x',
    '/./docs',
    '//docs-json',
    '/docs-json/.',
    '/temas/..',
    '/temas/../.',
    '/usuarios/me/..',
    '/auditoria/.',
    '/auth/..',
  ];
  const token = principal?.token;
  for (const variante of variantes) {
    await probe(`Recorrido de ruta GET /api/v1${variante}`, async () => {
      const response = await raw('GET', apiPath(variante), { headers: token ? bearer(token) : {} });
      const tipo = String(response.headers['content-type'] ?? '');
      const spa = response.status === 200 && /text\/html/.test(tipo) && /<div id="root"/.test(response.text);
      if (/root:.*:0:0:/.test(response.text)) return fail('se sirvió /etc/passwd');
      if (/"openapi"\s*:|swagger-ui/i.test(response.text)) return fail(`HTTP ${response.status}: se sirvió la documentación del API`);
      if (spa) return pass('HTTP 200 con el index.html de la SPA (no llegó al API)');
      if (![400, 401, 403, 404].includes(response.status)) return fail(`HTTP ${response.status} ${tipo} ${response.text.slice(0, 120)}`);
      return pass(`HTTP ${response.status}${token ? '' : ' (sin sesión: autenticado no se probó)'}`);
    });
  }
}

await probe('Rotar X-Forwarded-For no evade el límite de login', async () => {
  const statuses = [];
  for (let i = 0; i < 35; i += 1) {
    const response = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${(i % 250) + 1}` },
      body: JSON.stringify({ email: `sonda.${randomBytes(4).toString('hex')}@live.uleam.edu.ec`, password: 'contrasena-incorrecta-123' }),
    });
    statuses.push(response.status);
    if (response.status === 429) break;
  }
  if (!statuses.includes(429)) return fail(`35 fallos con XFF rotado sin 429 (${[...new Set(statuses)].join(',')})`);
  return pass(`429 tras ${statuses.length} intentos`);
});

const destino = sinCredenciales ? null : await destinoSubida().catch((error) => { record('Búsqueda del destino de subida', 'FAIL', error.message); return null; });

// Archivos maliciosos: van antes de la inundación porque el backend admite 10 entregas por hora y usuario.
if (sinCredenciales) {
  record('Archivos maliciosos rechazados', 'SKIPPED', sinCredenciales);
} else if (!destino?.propio) {
  record('Archivos maliciosos rechazados', 'SKIPPED', 'el estudiante no tiene una asignación VIGENTE (o falta --periodo/--asignacion): el rechazo vendría de la autorización, no del contenido');
} else if (!destino.plantilla) {
  record('Archivos maliciosos rechazados', 'SKIPPED', `el período ${destino.periodo} no tiene plantilla PAT vigente`);
} else {
  let turno = 0;
  for (const fixture of ARCHIVOS_MALICIOSOS) {
    await probe(`Archivo malicioso rechazado: ${fixture.nombre}`, async () => {
      const sesion = sesiones[turno++ % sesiones.length];
      const form = multipart({ plantilla_id: destino.plantilla }, { name: fixture.archivo, mime: fixture.mime, content: fixture.contenido() });
      const response = await raw('POST', apiPath(subidaUrl(destino)), { headers: { ...bearer(sesion.token), 'Content-Type': form.contentType }, body: form.body });
      if (response.status === 429) return skipped(`HTTP 429 para ${sesion.correo}: cupo de entregas agotado; repetir con otra cuenta del grupo (--extra-emails) o pasada la hora`);
      if ([401, 403, 404].includes(response.status)) return fail(`HTTP ${response.status} para ${sesion.correo}: el rechazo no vino de la validación del contenido`);
      if (response.status >= 200 && response.status < 300) return fail(`HTTP ${response.status}: el archivo se aceptó como versión PAT`);
      if (response.status >= 500) return fail(`HTTP ${response.status}`);
      return pass(`HTTP ${response.status}`);
    });
  }
}

// Inundación de subidas: cuerpos completos de --flood-mib MiB enviados a la vez. nginx bufferiza el cuerpo antes
// de pasarlo al backend; lo que se comprueba es que el backend rechace (preautorización, 1 subida concurrente y
// 10 por hora por usuario, limit_conn de nginx) sin leer el archivo, y que su RSS no crezca con la inundación.
async function inundar(label, cuentas) {
  if (sinCredenciales) { record(label, 'SKIPPED', sinCredenciales); return; }
  if (!destino) { record(label, 'SKIPPED', 'no se encontró ningún período para dirigir las subidas'); return; }
  const contenido = Buffer.alloc(Math.floor(floodMib * 1024 * 1024), 0x41); // no es PDF: si se admitiera, la validación lo rechaza sin crear versión
  const form = multipart({ plantilla_id: destino.plantilla ?? randomUUID() }, { name: 'pat.pdf', mime: PDF_MIME, content: contenido });
  let muestreo = null;
  let lineaBase = null;
  if (backendPid) {
    lineaBase = Math.min(...(await Promise.all([0, 1, 2].map(async (i) => { await new Promise((r) => setTimeout(r, i * 150)); return rssKiB(backendPid); }))));
    muestreo = muestreador(backendPid);
  }
  const started = performance.now();
  const respuestas = await Promise.all(Array.from({ length: floodCount }, (_, i) => {
    const sesion = cuentas[i % cuentas.length];
    return raw('POST', apiPath(subidaUrl(destino)), { headers: { ...bearer(sesion.token), 'Content-Type': form.contentType }, body: form.body }).catch((error) => ({ status: 0, ms: 0, text: error.message }));
  }));
  const duracion = Math.round(performance.now() - started);
  await new Promise((r) => setTimeout(r, 2000));
  const muestras = muestreo ? await muestreo.detener() : [];
  const despues = backendPid ? await rssKiB(backendPid) : null;
  const tally = respuestas.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  // Admitidas = llegaron al manejador (leyó el archivo): cualquier estado distinto de los rechazos previos al cuerpo.
  const admitidas = respuestas.filter((r) => ![401, 403, 404, 413, 429].includes(r.status)).length;
  const maximo = destino.propio ? Math.min(cuentas.length * 10, floodCount) : 0;
  const detalle = `${floodCount} x ${floodMib} MiB en ${duracion} ms a ${destino.propio ? 'una asignación propia' : 'una asignación ajena (modo ajeno: decide la autorización)'}; estados ${JSON.stringify(tally)}; admitidas ${admitidas} (máximo ${maximo})`;
  const errores = respuestas.filter((r) => r.status === 0 || r.status >= 500);
  if (errores.length) record(label, 'FAIL', `${detalle}; ${errores.length} errores de red o 5xx`);
  else if (admitidas > maximo) record(label, 'FAIL', `${detalle}: el backend leyó más cuerpos de los permitidos`);
  else record(label, 'PASS', detalle);
  const memoria = `${label}: memoria del backend`;
  if (!backendPid) { record(memoria, 'SKIPPED', 'memoria NO medida: falta --backend-pid <pid del proceso Node del backend>'); return; }
  const pico = Math.max(lineaBase, ...muestras);
  const delta = (pico - lineaBase) / 1024;
  const texto = `RSS base ${mib(lineaBase)} MiB, pico ${mib(pico)} MiB (+${delta.toFixed(1)} MiB), después ${mib(despues)} MiB; ${muestras.length} muestras; umbral +${maxRssDeltaMib} MiB`;
  record(memoria, delta > maxRssDeltaMib ? 'FAIL' : 'PASS', texto);
}
await inundar('Inundación de subidas, un usuario', principal ? [principal] : []);
if (sesiones.length > 1) await inundar(`Inundación de subidas, ${sesiones.length} usuarios`, sesiones);
else record('Inundación de subidas, varios usuarios', 'SKIPPED', sinCredenciales || 'pasa --extra-emails (o ATTACK_PROBE_EXTRA_EMAILS) con más cuentas ESTUDIANTE');

if (lanHost) {
  if (/^(127\.|::1$|localhost$)/.test(lanHost)) {
    record('Puertos internos fuera de loopback', 'FAIL', '--lan-host debe ser una dirección no loopback');
  } else {
    for (const port of [6379, 6381, 8025, 1025, 9000, 9001, 8333]) {
      await probe(`TCP ${lanHost}:${port} cerrado`, async () => ((await tcpOpen(lanHost, port)) ? fail('el puerto responde fuera de loopback') : undefined));
    }
  }
} else {
  record('Puertos internos fuera de loopback', 'SKIPPED', 'pasa --lan-host <ip> para comprobar 6379/8025/9000');
}

if (heavy) {
  await probe('[heavy] limit_req de nginx frena una ráfaga de 300 GET', async () => {
    const responses = await Promise.all(Array.from({ length: 300 }, () => get(`${api}/auth/csrf`).then((r) => r.status, () => 0)));
    const limited = responses.filter((status) => status === 429 || status === 503).length;
    if (limited === 0) return fail('ninguna respuesta 429/503');
    return pass(`${limited} respuestas limitadas`);
  });
} else {
  record('Sondas de volumen', 'SKIPPED', 'usa --heavy para ejecutarlas');
}

const width = Math.max(...results.map((row) => row.name.length));
console.log(`Sondas contra ${base}\n`);
for (const row of results) console.log(`${row.status.padEnd(7)}  ${row.name.padEnd(width)}  ${row.detail}`);
const count = (status) => results.filter((row) => row.status === status).length;
console.log(`\nPASS ${count('PASS')}, FAIL ${count('FAIL')}, SKIPPED ${count('SKIPPED')}.`);
process.exitCode = count('FAIL') > 0 ? 1 : 0;
