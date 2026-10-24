import 'reflect-metadata';
import { loadEnvironment } from '../config/load-environment.js';
import { DatabaseDataSource } from './database-data-source.js';
import { createDatabaseOptions } from './database.options.js';

// El CLI de TypeORM necesita una única instancia exportada y sin inicializar.
export default new DatabaseDataSource(createDatabaseOptions(loadEnvironment()));
