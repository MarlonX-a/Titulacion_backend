import { DataSource } from 'typeorm';

export const DATABASE_CONNECTION_ERROR =
  'No se pudo inicializar PostgreSQL. Comprueba que el servicio esté disponible y revisa DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD y DB_NAME.';

export class DatabaseDataSource extends DataSource {
  override async initialize(): Promise<this> {
    try {
      return await super.initialize();
    } catch {
      // Los errores del driver pueden incluir usuario, host u otros datos privados.
      throw new Error(DATABASE_CONNECTION_ERROR);
    }
  }
}
