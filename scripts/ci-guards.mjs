#!/usr/bin/env node
// Guardas de regresión de seguridad para CI (ejecutable también en local: node scripts/ci-guards.mjs).
// 1) src/ no puede volver a declarar ni usar el decorador de identidad no registrada.
// 2) Ningún archivo de src/ (salvo pruebas *.spec.ts) ramifica por NODE_ENV === 'test'. La única
//    excepción es la línea del rechazo de arranque en src/config/environment.ts
//    (assertRuntimeEnvironment), que debe existir exactamente una vez.
// Uso: node scripts/ci-guards.mjs [raíz del repositorio]; sin argumento, la raíz de este script.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? join(import.meta.dirname, '..'));
const failures = [];

function* tsFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* tsFiles(path);
    else if (entry.name.endsWith('.ts')) yield path;
  }
}

const rel = (file) => relative(root, file).split(sep).join('/');
const isSpec = (file) => file.endsWith('.spec.ts');

for (const file of tsFiles(join(root, 'src'))) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/allow[-_]?unregistered[-_]?identity/i.test(line)) {
      failures.push(`${rel(file)}:${index + 1}: reaparece allowUnregisteredIdentity (cualquier grafía)`);
    }
  });
}

const testBranch = /(NODE_ENV|nodeEnv)\b[^\n]*(===?|!==?)\s*['"]test['"]|['"]test['"]\s*(===?|!==?)[^\n]*(NODE_ENV|nodeEnv)\b/;
/** Única ramificación admitida: el rechazo de arranque con NODE_ENV=test. */
const BOOT_REFUSAL = { file: 'src/config/environment.ts', line: "if (nodeEnv === 'test') {" };
let bootRefusals = 0;
for (const file of tsFiles(join(root, 'src'))) {
  if (isSpec(file)) continue;
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
    if (!testBranch.test(line)) return;
    if (rel(file) === BOOT_REFUSAL.file && line.trim() === BOOT_REFUSAL.line) {
      bootRefusals += 1;
      return;
    }
    failures.push(`${rel(file)}:${index + 1}: ramifica por NODE_ENV === 'test'`);
  });
}
if (bootRefusals !== 1) {
  failures.push(`${BOOT_REFUSAL.file}: se esperaba exactamente un rechazo de arranque con NODE_ENV=test y hay ${bootRefusals}`);
}

if (failures.length > 0) {
  console.error('Guardas de seguridad incumplidas:\n' + failures.map((f) => ` - ${f}`).join('\n'));
  process.exit(1);
}
console.log('Guardas de seguridad: sin hallazgos.');
