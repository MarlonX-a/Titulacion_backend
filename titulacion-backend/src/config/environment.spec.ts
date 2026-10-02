import { validateEnvironment as validate } from './environment.js';

const databaseVariables = {
  DB_USERNAME: 'test_user',
  DB_PASSWORD: 'test_password',
  DB_NAME: 'test_database',
};

function validateEnvironment(overrides: Record<string, unknown>) {
  return validate({ ...databaseVariables, ...overrides });
}

describe('validateEnvironment', () => {
  it('usa valores predeterminados con las credenciales obligatorias', () => {
    expect(validateEnvironment({})).toEqual({
      ...databaseVariables,
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_SCHEMA: 'public',
      AUTH_MODE: 'institutional',
      NODE_ENV: 'development',
      PORT: 3000,
      SWAGGER_ENABLED: true,
    });
  });

  it('permite omitir autenticación en desarrollo y pruebas', () => {
    expect(validateEnvironment({}).OIDC_ISSUER).toBeUndefined();
    expect(validateEnvironment({ NODE_ENV: 'test' }).JWKS_URI).toBeUndefined();
  });

  it.each(['development', 'test'])(
    'exige las tres variables juntas cuando se configura autenticación en %s',
    (nodeEnv) => {
      expect(() =>
        validateEnvironment({
          NODE_ENV: nodeEnv,
          OIDC_ISSUER: 'https://id.test',
        }),
      ).toThrow('OIDC_AUDIENCE');
    },
  );

  it('exige autenticación en producción', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'production' })).toThrow(
      'OIDC_ISSUER',
    );
  });

  it('acepta HTTP únicamente para URLs locales fuera de producción', () => {
    expect(
      validateEnvironment({
        OIDC_ISSUER: 'http://localhost:4100/issuer',
        OIDC_AUDIENCE: 'api-test',
        JWKS_URI: 'http://127.0.0.1:4100/keys',
      }).OIDC_ISSUER,
    ).toBe('http://localhost:4100/issuer');
  });

  it.each([
    {
      config: {
        OIDC_ISSUER: 'http://example.test',
        OIDC_AUDIENCE: 'api',
        JWKS_URI: 'https://keys.test',
      },
      variable: 'OIDC_ISSUER',
    },
    {
      config: {
        OIDC_ISSUER: 'https://id.test',
        OIDC_AUDIENCE: 'api',
        JWKS_URI: 'http://example.test',
      },
      variable: 'JWKS_URI',
    },
    {
      config: {
        OIDC_ISSUER: 'http://localhost:4100',
        OIDC_AUDIENCE: 'api',
        JWKS_URI: 'https://keys.test',
        NODE_ENV: 'production',
      },
      variable: 'OIDC_ISSUER',
    },
    {
      config: {
        OIDC_ISSUER: 'https://user:secret@id.test',
        OIDC_AUDIENCE: 'api',
        JWKS_URI: 'https://keys.test',
      },
      variable: 'OIDC_ISSUER',
    },
  ])(
    'rechaza configuración de URL insegura sin revelar valores: $variable',
    ({ config, variable }) => {
      expect(() => validateEnvironment(config)).toThrow(variable);
    },
  );

  it.each(['development', 'test', 'production'])(
    'acepta NODE_ENV=%s y aplica el valor predeterminado de Swagger',
    (nodeEnv) => {
      const authConfiguration =
        nodeEnv === 'production'
          ? {
              OIDC_ISSUER: 'https://id.test',
              OIDC_AUDIENCE: 'api',
              JWKS_URI: 'https://id.test/keys',
            }
          : {};

      expect(
        validateEnvironment({ NODE_ENV: nodeEnv, ...authConfiguration }),
      ).toMatchObject({
        ...databaseVariables,
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        DB_SCHEMA: 'public',
        AUTH_MODE: 'institutional',
        NODE_ENV: nodeEnv,
        PORT: 3000,
        SWAGGER_ENABLED: nodeEnv !== 'production',
      });
    },
  );

  it.each(['1', '4000', '65535'])('acepta PORT=%s como número', (port) => {
    expect(validateEnvironment({ PORT: port }).PORT).toBe(Number(port));
  });

  it.each(['', '0', '-1', '1.5', '65536', '3000abc', '3e3', '0xBB8', ' 3000 '])(
    'rechaza PORT=%s',
    (port) => {
      expect(() => validateEnvironment({ PORT: port })).toThrow('PORT');
    },
  );

  it.each(['', 'staging', 'DEVELOPMENT', null])(
    'rechaza NODE_ENV inválido: %s',
    (nodeEnv) => {
      expect(() => validateEnvironment({ NODE_ENV: nodeEnv })).toThrow(
        'NODE_ENV',
      );
    },
  );

  it.each([
    ['true', true],
    ['false', false],
  ])('convierte SWAGGER_ENABLED=%s a booleano', (value, expected) => {
    expect(
      validateEnvironment({ SWAGGER_ENABLED: value }).SWAGGER_ENABLED,
    ).toBe(expected);
  });

  it('permite habilitar Swagger explícitamente en producción', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'production',
        SWAGGER_ENABLED: 'true',
        OIDC_ISSUER: 'https://id.test',
        OIDC_AUDIENCE: 'api',
        JWKS_URI: 'https://id.test/keys',
      }).SWAGGER_ENABLED,
    ).toBe(true);
  });

  it.each(['', 'TRUE', 'False', '1', '0', true, false, null])(
    'rechaza SWAGGER_ENABLED inválido: %s',
    (value) => {
      expect(() => validateEnvironment({ SWAGGER_ENABLED: value })).toThrow(
        'SWAGGER_ENABLED',
      );
    },
  );

  it('no incluye valores inválidos ni secretos en el error', () => {
    expect(() =>
      validateEnvironment({
        PORT: 'secreto-de-prueba',
        DATABASE_URL: 'credenciales-de-prueba',
      }),
    ).toThrow(
      'Configuración inválida: PORT debe ser un entero entre 1 y 65535.',
    );
  });

  it.each(['DB_USERNAME', 'DB_PASSWORD', 'DB_NAME'])(
    'exige %s sin asignar credenciales por defecto',
    (key) => {
      for (const value of [undefined, '', '   ', null, 123]) {
        expect(() => validateEnvironment({ [key]: value })).toThrow(
          `Configuración inválida: ${key} es obligatorio y no puede estar vacío.`,
        );
      }
    },
  );

  it('exige credenciales también en NODE_ENV=test', () => {
    expect(() => validate({ NODE_ENV: 'test' })).toThrow('DB_USERNAME');
  });

  it.each(['', '   ', null, 123])('rechaza DB_HOST inválido: %s', (host) => {
    expect(() => validateEnvironment({ DB_HOST: host })).toThrow('DB_HOST');
  });

  it.each(['', '0', '-1', '1.5', '65536', '5432abc', '5e3', ' 5432 ', null])(
    'rechaza DB_PORT inválido: %s',
    (port) => {
      expect(() => validateEnvironment({ DB_PORT: port })).toThrow('DB_PORT');
    },
  );

  it.each(['1', '5433', '65535'])('convierte DB_PORT=%s a número', (port) => {
    expect(validateEnvironment({ DB_PORT: port }).DB_PORT).toBe(Number(port));
  });

  it('conserva contraseñas con espacios significativos y caracteres especiales', () => {
    const password = ' prueba:@/# ';
    expect(validateEnvironment({ DB_PASSWORD: password }).DB_PASSWORD).toBe(
      password,
    );
  });

  it('permite modo local solo con esquema aislado, host local y contraseña', () => {
    expect(
      validateEnvironment({
        AUTH_MODE: 'local',
        DB_SCHEMA: 'local_demo',
        LOCAL_AUTH_PASSWORD: 'clave-local-de-pruebas-segura',
      }),
    ).toMatchObject({
      AUTH_MODE: 'local',
      DB_SCHEMA: 'local_demo',
      LOCAL_AUTH_PASSWORD: 'clave-local-de-pruebas-segura',
    });
  });

  it.each([
    { NODE_ENV: 'production', AUTH_MODE: 'local' },
    { AUTH_MODE: 'local', DB_SCHEMA: 'public' },
    { AUTH_MODE: 'institutional', DB_SCHEMA: 'local_demo' },
    { AUTH_MODE: 'local', DB_HOST: 'db.example.test' },
    {
      AUTH_MODE: 'local',
      DB_SCHEMA: 'local_demo',
      LOCAL_AUTH_PASSWORD: 'short',
    },
    { AUTH_MODE: 'local', DB_SCHEMA: 'local_demo' },
    {
      AUTH_MODE: 'local',
      DB_SCHEMA: 'local_demo',
      LOCAL_AUTH_PASSWORD: 'clave-local-de-pruebas-segura',
      OIDC_ISSUER: 'https://issuer.test',
      OIDC_AUDIENCE: 'api-test',
      JWKS_URI: 'https://issuer.test/keys',
    },
  ])('rechaza configuraciones locales inseguras: %j', (config) => {
    expect(() => validateEnvironment(config)).toThrow('Configuración inválida');
  });

  it('los errores de base de datos no exponen valores sensibles', () => {
    expect(() =>
      validateEnvironment({
        DB_PORT: 'valor-secreto',
        DB_PASSWORD: 'password-secreto',
      }),
    ).toThrow(
      'Configuración inválida: DB_PORT debe ser un entero entre 1 y 65535.',
    );
  });
});
