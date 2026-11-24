/** Checks the target before the interactive command can create the first administrator. */
export function assertBootstrapAdminTarget(schema: string, confirmation?: string): void {
  if (schema === 'public' || schema === 'local_demo') {
    throw new Error(`El bootstrap de ADMIN está bloqueado para el esquema protegido ${schema}.`);
  }
  if (schema === 'titulacion_dev') return;
  if (confirmation !== schema) {
    throw new Error(`Para crear el ADMIN fuera de titulacion_dev, confirma escribiendo exactamente el esquema ${schema}.`);
  }
}
