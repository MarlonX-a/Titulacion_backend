import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { validateEnvironment } from './config/environment.js';
import { DatabaseModule } from './database/database.module.js';
import { AcademicoModule } from './academico/academico.module.js';
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
import { AsignacionesTutorModule } from './asignaciones-tutor/asignaciones-tutor.module.js';
import { PlantillasPatModule } from './plantillas-pat/plantillas-pat.module.js';
import { DocumentosPatModule } from './documentos-pat/documentos-pat.module.js';
import { RevisionesPatModule } from './revisiones-pat/revisiones-pat.module.js';
import { NotificacionesModule } from './notificaciones/notificaciones.module.js';
import { ReportesModule } from './reportes/reportes.module.js';
import { ExportacionesModule } from './exportaciones/exportaciones.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Se decide antes de cargar la configuración, por eso se lee de process.env; validateEnvironment
      // valida y documenta el mismo valor (IGNORE_ENV_FILE). Las pruebas lo activan en test/setup-env.ts.
      ignoreEnvFile: process.env.IGNORE_ENV_FILE === 'true',
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AuthModule,
    AcademicoModule,
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
    AsignacionesTutorModule,
    PlantillasPatModule,
    DocumentosPatModule,
    RevisionesPatModule,
    NotificacionesModule,
    ReportesModule,
    ExportacionesModule,
    CorreoModule,
    ImportacionesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
