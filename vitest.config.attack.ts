import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Suite ofensiva: arranca la aplicación compilada (dist/) contra PostgreSQL, Redis y
// almacenamiento reales. Comparte Redis y la base, por eso se ejecuta en serie.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/attack/**/*.attack-spec.ts'],
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
    // dist/ se importa con el cargador nativo de Node: TypeORM carga las entidades por glob
    // con import() nativo y ambas rutas deben compartir las mismas clases.
    server: { deps: { external: [/[\\/]dist[\\/]/] } },
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
