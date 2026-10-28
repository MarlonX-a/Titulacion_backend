import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { InvitacionPersistenciaModule } from '../invitaciones/invitacion-persistencia.module.js';
import { PostulacionesPersistenciaModule } from '../postulaciones/postulaciones-persistencia.module.js';
import { GrupoIntegrantePersistenciaService } from './grupo-integrante-persistencia.service.js';

@Module({
  imports: [AuditoriaModule, InvitacionPersistenciaModule, PostulacionesPersistenciaModule],
  providers: [GrupoIntegrantePersistenciaService],
  exports: [GrupoIntegrantePersistenciaService],
})
export class GrupoIntegrantePersistenciaModule {}
