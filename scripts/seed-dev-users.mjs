// Seeds development test users (ADMIN, DOCENTE, ESTUDIANTE). Idempotent: existing emails are skipped.
// Only runs against a local database and the titulacion_dev schema.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { argon2id, hash } from 'argon2';

// Shared development password for every seeded account (min. 15 characters).
const DEV_PASSWORD = 'Titulacion-Dev-2026!';

const USERS = [
  { email: 'admin.dev@uleam.edu.ec', nombres: 'Admin', apellidos: 'Desarrollo', rol: 'ADMIN' },
  { email: 'docente1.dev@uleam.edu.ec', nombres: 'Carla', apellidos: 'Mendoza Vera', rol: 'DOCENTE', perfil: { cedula: cedula('130000001'), titulo_academico: 'Magíster en Ingeniería de Software', departamento: 'Facultad de Ciencias de la Vida y Tecnologías', habilitado_tutoria: true } },
  { email: 'docente2.dev@uleam.edu.ec', nombres: 'Jorge', apellidos: 'Zambrano Pico', rol: 'DOCENTE', perfil: { cedula: cedula('130000002'), titulo_academico: 'Doctor en Ciencias de la Computación', departamento: 'Facultad de Ciencias de la Vida y Tecnologías', habilitado_tutoria: false } },
  { email: 'estudiante1.dev@live.uleam.edu.ec', nombres: 'Ana', apellidos: 'López Cedeño', rol: 'ESTUDIANTE', perfil: { cedula: cedula('130000003'), matricula: 'DEV-0001', carrera: 'Ingeniería en Software', nivel: 9 } },
  { email: 'estudiante2.dev@live.uleam.edu.ec', nombres: 'Luis', apellidos: 'Alcívar Moreira', rol: 'ESTUDIANTE', perfil: { cedula: cedula('130000004'), matricula: 'DEV-0002', carrera: 'Ingeniería en Software', nivel: 9 } },
  { email: 'estudiante3.dev@live.uleam.edu.ec', nombres: 'María', apellidos: 'Ponce Loor', rol: 'ESTUDIANTE', perfil: { cedula: cedula('130000005'), matricula: 'DEV-0003', carrera: 'Ingeniería en Sistemas', nivel: 10 } },
];

// Appends the Ecuadorian check digit to a 9-digit prefix.
function cedula(prefix) {
  const sum = [...prefix].map(Number).reduce((acc, digit, index) => {
    const product = digit * (index % 2 === 0 ? 2 : 1);
    return acc + (product > 9 ? product - 9 : product);
  }, 0);
  return prefix + ((10 - (sum % 10)) % 10);
}

function readEnv() {
  const file = new URL('../.env', import.meta.url);
  const entries = readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]);
  return { ...Object.fromEntries(entries), ...process.env };
}

const env = readEnv();
if (env.DB_SCHEMA !== 'titulacion_dev') throw new Error('The seed only runs against the titulacion_dev schema.');
if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST)) throw new Error('The seed only runs against a local database.');

const client = new pg.Client({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_NAME });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(`SET LOCAL search_path TO ${env.DB_SCHEMA}`);
  const passwordHash = await hash(DEV_PASSWORD, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  for (const user of USERS) {
    const existing = await client.query('SELECT id FROM usuario WHERE email = $1', [user.email]);
    if (existing.rowCount) { console.log(`skip    ${user.rol.padEnd(10)} ${user.email}`); continue; }
    const { rows: [{ id }] } = await client.query(
      `INSERT INTO usuario (email, nombres, apellidos, rol, estado) VALUES ($1, $2, $3, $4, 'ACTIVO') RETURNING id`,
      [user.email, user.nombres, user.apellidos, user.rol],
    );
    await client.query(
      `INSERT INTO credencial_usuario (usuario_id, password_hash, requiere_cambio, temporal_expira_en, version_sesion) VALUES ($1, $2, false, NULL, 0)`,
      [id, passwordHash],
    );
    if (user.rol === 'DOCENTE') {
      const p = user.perfil;
      await client.query(
        'INSERT INTO docente (usuario_id, cedula, titulo_academico, departamento, habilitado_tutoria) VALUES ($1, $2, $3, $4, $5)',
        [id, p.cedula, p.titulo_academico, p.departamento, p.habilitado_tutoria],
      );
    }
    if (user.rol === 'ESTUDIANTE') {
      const p = user.perfil;
      await client.query(
        'INSERT INTO estudiante (usuario_id, cedula, matricula, carrera, nivel) VALUES ($1, $2, $3, $4, $5)',
        [id, p.cedula, p.matricula, p.carrera, p.nivel],
      );
    }
    console.log(`created ${user.rol.padEnd(10)} ${user.email}`);
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
