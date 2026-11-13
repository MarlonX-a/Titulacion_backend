import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { argon2id, hash } from 'argon2';
import { SignJWT, importPKCS8 } from 'jose';
import request from 'supertest';
import { ATTACK_ISSUER, ATTACK_ORIGIN, type AttackApp } from './harness.js';

/** Contraseña desechable común de las cuentas sembradas (cumple la política de 12+ caracteres). */
export const ATTACK_PASSWORD = 'Ataque-Local-2026!zq';
export type Rol = 'ADMIN' | 'DOCENTE' | 'ESTUDIANTE';

export interface Cuenta {
  usuarioId: string;
  email: string;
  rol: Rol;
  password: string;
  estudianteId?: string;
  docenteId?: string;
  cedula?: string;
  matricula?: string;
}

let passwordHash: Promise<string> | undefined;
let sequence = 0;
const runTag = randomBytes(3).toString('hex');

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Cédula ecuatoriana válida (provincia 13) única dentro de la ejecución. */
export function nuevaCedula(): string {
  sequence += 1;
  const prefix = `130${String((Date.now() % 1000) * 1000 + sequence).padStart(6, '0').slice(-6)}`;
  const sum = [...prefix].map(Number).reduce((acc, digit, index) => {
    const product = digit * (index % 2 === 0 ? 2 : 1);
    return acc + (product > 9 ? product - 9 : product);
  }, 0);
  return prefix + ((10 - (sum % 10)) % 10);
}

export async function carreraId(attack: AttackApp, codigo: string): Promise<{ carreraId: string; facultadId: string }> {
  const rows = await attack.db.query(`SELECT "id", "facultad_id" FROM ${attack.s}."carrera" WHERE "codigo"=$1`, [codigo]) as Array<{ id: string; facultad_id: string }>;
  if (!rows[0]) throw new Error(`No existe la carrera ${codigo} en el catálogo sembrado.`);
  return { carreraId: rows[0].id, facultadId: rows[0].facultad_id };
}

interface NuevaCuenta {
  rol: Rol;
  /** Crea perfil de estudiante/docente (por defecto sí). */
  perfil?: boolean;
  carrera?: string;
  estado?: 'ACTIVO' | 'INACTIVO';
  requiereCambio?: boolean;
  habilitadoTutoria?: boolean;
  password?: string;
  emailLocal?: string;
}

/** Inserta una cuenta real (usuario + credencial argon2id + perfil opcional) en el esquema temporal. */
export async function crearCuenta(attack: AttackApp, options: NuevaCuenta): Promise<Cuenta> {
  sequence += 1;
  const cedula = nuevaCedula();
  const local = options.emailLocal ?? (options.rol === 'ESTUDIANTE' ? `e${cedula}` : `atk.${options.rol.toLowerCase()}.${runTag}.${sequence}`);
  const email = `${local}@live.uleam.edu.ec`;
  const password = options.password ?? ATTACK_PASSWORD;
  const digest = options.password ? await hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })
    : await (passwordHash ??= hash(ATTACK_PASSWORD, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }));
  const [{ id }] = await attack.db.query(
    `INSERT INTO ${attack.s}."usuario" ("email","nombres","apellidos","rol","estado") VALUES ($1,$2,$3,$4,$5) RETURNING "id"`,
    [email, `Nombre${sequence}`, `Apellido${sequence}`, options.rol, options.estado ?? 'ACTIVO'],
  ) as Array<{ id: string }>;
  await attack.db.query(
    `INSERT INTO ${attack.s}."credencial_usuario" ("usuario_id","password_hash","requiere_cambio","temporal_expira_en","version_sesion") VALUES ($1,$2,$3,$4,0)`,
    [id, digest, options.requiereCambio ?? false, options.requiereCambio ? new Date(Date.now() + 3_600_000) : null],
  );
  const cuenta: Cuenta = { usuarioId: id, email, rol: options.rol, password };
  if (options.perfil === false) return cuenta;
  const { carreraId: carrera } = await carreraId(attack, options.carrera ?? 'INGENIERIA_EN_SOFTWARE');
  if (options.rol === 'ESTUDIANTE') {
    const [row] = await attack.db.query(
      `INSERT INTO ${attack.s}."estudiante" ("usuario_id","cedula","matricula","carrera_id","nivel") VALUES ($1,$2,$3,$4,9) RETURNING "id"`,
      [id, cedula, cedula, carrera],
    ) as Array<{ id: string }>;
    return { ...cuenta, estudianteId: row!.id, cedula, matricula: cedula };
  }
  if (options.rol === 'DOCENTE') {
    const [row] = await attack.db.query(
      `INSERT INTO ${attack.s}."docente" ("usuario_id","cedula","titulo_academico","carrera_id","habilitado_tutoria") VALUES ($1,$2,'Magíster',$3,$4) RETURNING "id"`,
      [id, cedula, carrera, options.habilitadoTutoria ?? true],
    ) as Array<{ id: string }>;
    return { ...cuenta, docenteId: row!.id, cedula };
  }
  return cuenta;
}

/** Firma un JWT con la clave privada desechable del arranque (mismo emisor/audiencia que el servicio real). */
export async function firmarToken(attack: AttackApp, subject: string, claims: Record<string, unknown>, seconds = 900): Promise<string> {
  const key = await importPKCS8(attack.privateKeyPem, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(ATTACK_ISSUER)
    .setAudience('titulacion-api').setSubject(subject).setIssuedAt(now).setExpirationTime(now + seconds).sign(key);
}

/** Token de acceso normal respaldado por una sesión real en `sesion_usuario` (sin pasar por el limitador de login). */
export async function tokenDe(attack: AttackApp, cuenta: Cuenta): Promise<string> {
  const refresh = sha256(randomUUID());
  const [session] = await attack.db.query(
    `INSERT INTO ${attack.s}."sesion_usuario" ("usuario_id","refresh_hash","expira_en") VALUES ($1,$2,now() + interval '8 hours') RETURNING "id"`,
    [cuenta.usuarioId, refresh],
  ) as Array<{ id: string }>;
  return firmarToken(attack, cuenta.usuarioId, { typ: 'access', sid: session!.id });
}

export interface SesionHttp {
  status: number;
  accessToken?: string;
  refreshCookie?: string;
  csrfCookie?: string;
  deviceCookie?: string;
  setCookies: string[];
  body: Record<string, unknown>;
}

export function cookieValue(setCookies: string[], name: string): string | undefined {
  const line = setCookies.find((item) => item.startsWith(`${name}=`) || item.startsWith(`__Secure-${name}=`));
  if (!line) return undefined;
  const raw = line.slice(line.indexOf('=') + 1).split(';', 1)[0] ?? '';
  return raw.length ? decodeURIComponent(raw) : undefined;
}

export function setCookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
}

/** Inicio de sesión HTTP real; acepta una cookie de dispositivo previa. */
export async function login(attack: AttackApp, email: string, password: string, deviceCookie?: string, headers: Record<string, string> = {}): Promise<SesionHttp> {
  let call = request(attack.baseUrl).post('/auth/login').set(headers);
  if (deviceCookie) call = call.set('Cookie', `titulacion_dispositivo=${encodeURIComponent(deviceCookie)}`);
  const response = await call.send({ email, password });
  const setCookies = setCookiesOf(response);
  const body = (response.body ?? {}) as Record<string, unknown>;
  return {
    status: response.status,
    accessToken: typeof body.access_token === 'string' ? body.access_token : undefined,
    refreshCookie: cookieValue(setCookies, 'titulacion_refresh'),
    csrfCookie: cookieValue(setCookies, 'titulacion_csrf'),
    deviceCookie: cookieValue(setCookies, 'titulacion_dispositivo'),
    setCookies, body,
  };
}

/** Llamada a /auth/refresh o /auth/logout con origen permitido y CSRF de doble envío. */
export function sessionCall(attack: AttackApp, path: '/auth/refresh' | '/auth/logout', refreshCookie: string, csrf: string) {
  return request(attack.baseUrl).post(path)
    .set('Origin', ATTACK_ORIGIN)
    .set('X-CSRF-Token', csrf)
    .set('Cookie', `titulacion_refresh=${encodeURIComponent(refreshCookie)}; titulacion_csrf=${csrf}`);
}

export { ATTACK_ORIGIN };
