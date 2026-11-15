import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/ci-guards.mjs');
const ARRANQUE = "export function assertRuntimeEnvironment(nodeEnv: unknown): void {\n  if (nodeEnv === 'test') {\n    throw new Error('NODE_ENV=test');\n  }\n}\n";

/** Ejecuta las guardas sobre un árbol `src/` temporal con los archivos indicados. */
function guardas(archivos: Record<string, string>) {
  const raiz = mkdtempSync(join(tmpdir(), 'titulacion-ci-guards-'));
  try {
    for (const [ruta, contenido] of Object.entries({ 'src/config/environment.ts': ARRANQUE, ...archivos })) {
      mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
      writeFileSync(join(raiz, ruta), contenido);
    }
    const resultado = spawnSync(process.execPath, [SCRIPT, raiz], { encoding: 'utf8' });
    return { status: resultado.status, salida: `${resultado.stdout}${resultado.stderr}` };
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}

describe('scripts/ci-guards.mjs', () => {
  it('acepta un src/ cuya única referencia a NODE_ENV=test es el rechazo de arranque', () => {
    expect(guardas({ 'src/app.module.ts': "export const ignorar = process.env.IGNORE_ENV_FILE === 'true';\n" }).status).toBe(0);
  });

  it.each([
    ['un módulo cualquiera', 'src/periodos/periodos.module.ts', "const testMode = process.env.NODE_ENV === 'test';\n"],
    ['un servicio vía ConfigService', 'src/exportaciones/exportaciones.service.ts', "this.testMode = config.get('NODE_ENV', { infer: true }) === 'test';\n"],
    ['la comparación invertida', 'src/database/pending-migrations.ts', "if ('test' !== nodeEnv) return;\n"],
    ['una ruta anidada', 'src/almacenamiento/sub/archivo.ts', "const x = process.env['NODE_ENV'] == 'test';\n"],
  ])('falla si %s ramifica por NODE_ENV === test', (_caso, ruta, contenido) => {
    const { status, salida } = guardas({ [ruta]: contenido });
    expect(status).toBe(1);
    expect(salida).toContain(`${ruta}:1`);
  });

  it('la excepción cubre solo la línea del rechazo de arranque, no el resto de environment.ts', () => {
    const { status, salida } = guardas({ 'src/config/environment.ts': `${ARRANQUE}export const swagger = (nodeEnv: string) => nodeEnv === 'test';\n` });
    expect(status).toBe(1);
    expect(salida).toContain('src/config/environment.ts:6');
  });

  it('falla si desaparece el rechazo de arranque (la excepción debe existir exactamente una vez)', () => {
    expect(guardas({ 'src/config/environment.ts': 'export const nada = 1;\n' }).status).toBe(1);
  });

  it('ignora las pruebas unitarias dentro de src/', () => {
    expect(guardas({ 'src/config/environment.spec.ts': "expect(nodeEnv === 'test').toBe(true);\n" }).status).toBe(0);
  });

  it('el repositorio actual cumple las guardas', () => {
    const resultado = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(`${resultado.stdout}${resultado.stderr}`).toContain('sin hallazgos');
    expect(resultado.status).toBe(0);
  });
});
