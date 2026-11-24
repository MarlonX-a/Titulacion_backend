import { assertBootstrapAdminTarget } from './bootstrap-admin-target.js';

describe('assertBootstrapAdminTarget', () => {
  it('permite el esquema de desarrollo sin confirmación adicional', () => {
    expect(() => assertBootstrapAdminTarget('titulacion_dev')).not.toThrow();
  });

  it.each(['public', 'local_demo'])('rechaza el esquema protegido %s incluso si se confirma', (schema) => {
    expect(() => assertBootstrapAdminTarget(schema, schema)).toThrow(schema);
  });

  it('requiere confirmar el nombre exacto para un esquema de despliegue', () => {
    expect(() => assertBootstrapAdminTarget('titulacion_prod')).toThrow('confirma');
    expect(() => assertBootstrapAdminTarget('titulacion_prod', 'titulacion-dev')).toThrow('confirma');
    expect(() => assertBootstrapAdminTarget('titulacion_prod', 'titulacion_prod')).not.toThrow();
  });
});
