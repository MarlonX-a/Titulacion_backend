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
import { HabilitadosModule } from './habilitados/habilitados.module.js';
import { LineasInvestigacionModule } from './lineas-investigacion/lineas-investigacion.module.js';
import { TemasModule } from './temas/temas.module.js';
import { GruposModule } from './grupos/grupos.module.js';
import { InvitacionesModule } from './invitaciones/invitaciones.module.js';
import { PostulacionesModule } from './postulaciones/postulaciones.module.js';
import { ConflictosModule } from './conflictos/conflictos.module.js';
import { AsignacionesTemaModule } from './asignaciones-tema/asignaciones-tema.module.js';
import { CorreoModule } from './correo/correo.module.js';
import { ImportacionesModule } from './importaciones/importaciones.module.js';
import { CargaTutorialModule } from './carga-tutorial/carga-tutorial.module.js';

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
    HabilitadosModule,
    LineasInvestigacionModule,
    TemasModule,
    GruposModule,
    InvitacionesModule,
    PostulacionesModule,
    ConflictosModule,
    AsignacionesTemaModule,
    CargaTutorialModule,
    ...(process.env.NODE_ENV === 'test' ? [] : [CorreoModule, ImportacionesModule]),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
