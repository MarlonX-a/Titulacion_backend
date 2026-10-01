import { Module } from '@nestjs/common';

// Las pruebas HTTP de configuración no necesitan conexiones ni repositorios.
@Module({})
export class DatabaseTestingModule {}
