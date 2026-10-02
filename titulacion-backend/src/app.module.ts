import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { validateEnvironment } from './config/environment.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { EstudiantesModule } from './estudiantes/estudiantes.module.js';
import { DocentesModule } from './docentes/docentes.module.js';
import { PeriodosModule } from './periodos/periodos.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AuthModule,
    EstudiantesModule,
    DocentesModule,
    PeriodosModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
