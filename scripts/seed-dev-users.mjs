// Seeds development test users (ADMIN, DOCENTE, ESTUDIANTE) with carreras from the seeded catalog (by codigo). Idempotent: existing emails are skipped.
// Only runs against a local database and the titulacion_dev schema.
import { argon2id, hash } from 'argon2';
import { connectDevDatabase, DEV_SCHEMA } from './dev-database.mjs';

// Argon2id parameters. Source of truth: ARGON2_PARAMETROS in src/auth/password-hasher.ts. This script
// runs with plain node (no build), so it cannot import it; test/seed-dev-users.spec.ts fails on drift.
const ARGON2_PARAMETROS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

// Shared development password for every seeded account (min. 15 characters).
const DEV_PASSWORD = 'Titulacion-Dev-2026!';

const USERS = [
  { email: 'admin.dev@uleam.edu.ec', nombres: 'Admin', apellidos: 'Desarrollo', rol: 'ADMIN' },
  { email: 'docente1.dev@uleam.edu.ec', nombres: 'Carla', apellidos: 'Mendoza Vera', rol: 'DOCENTE', perfil: { cedula: cedula('130000001'), titulo_academico: 'Magíster en Ingeniería de Software', carrera: 'INGENIERIA_EN_SOFTWARE', habilitado_tutoria: true } },
  { email: 'docente2.dev@uleam.edu.ec', nombres: 'Jorge', apellidos: 'Zambrano Pico', rol: 'DOCENTE', perfil: { cedula: cedula('130000002'), titulo_academico: 'Doctor en Ciencias de la Computación', carrera: 'INGENIERIA_EN_SOFTWARE', habilitado_tutoria: false } },
  { email: 'estudiante1.dev@live.uleam.edu.ec', nombres: 'Ana', apellidos: 'López Cedeño', rol: 'ESTUDIANTE', perfil: { cedula: cedula('130000003'), matricula: 'DEV-0001', carrera: 'INGENIERIA_EN_SOFTWARE', nivel: 9 } },
  { email: 'estudiante2.dev@live.uleam.edu.ec', nombres: 'Luis', apellidos: 'Alcívar Moreira', rol: 'ESTUDIANTE', perfil: { cedula: cedula('130000004'), matricula: 'DEV-0002', carrera: 'INGENIERIA_EN_SOFTWARE', nivel: 9 } },
  { email: 'estudiante3.dev@live.uleam.edu.ec', nombres: 'María', apellidos: 'Ponce Loor', rol: 'ESTUDIANTE', perfil: { cedula: cedula('130000005'), matricula: 'DEV-0003', carrera: 'INGENIERIA_EN_SISTEMAS', nivel: 10 } },
];

// Appends the Ecuadorian check digit to a 9-digit prefix.
function cedula(prefix) {
  const sum = [...prefix].map(Number).reduce((acc, digit, index) => {
    const product = digit * (index % 2 === 0 ? 2 : 1);
    return acc + (product > 9 ? product - 9 : product);
  }, 0);
  return prefix + ((10 - (sum % 10)) % 10);
}

const client = await connectDevDatabase('seed');
try {
  await client.query('BEGIN');
  await client.query(`SET LOCAL search_path TO ${DEV_SCHEMA}`);
  const passwordHash = await hash(DEV_PASSWORD, { type: argon2id, ...ARGON2_PARAMETROS });
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
        'INSERT INTO docente (usuario_id, cedula, titulo_academico, carrera_id, habilitado_tutoria) VALUES ($1, $2, $3, (SELECT id FROM carrera WHERE codigo = $4), $5)',
        [id, p.cedula, p.titulo_academico, p.carrera, p.habilitado_tutoria],
      );
    }
    if (user.rol === 'ESTUDIANTE') {
      const p = user.perfil;
      await client.query(
        'INSERT INTO estudiante (usuario_id, cedula, matricula, carrera_id, nivel) VALUES ($1, $2, $3, (SELECT id FROM carrera WHERE codigo = $4), $5)',
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
