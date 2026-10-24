import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { AsignacionTutor } from './entities/asignacion-tutor.entity.js';
import { AsignacionTutorEstado } from './enums/asignacion-tutor-estado.enum.js';

@Injectable()
export class AsignacionTutorPersistenciaService {
  constructor(private readonly auditoria: AuditoriaService) {}

  async anularPorAsignacionTema(
    manager: EntityManager,
    periodoId: string,
    asignacionTemaId: string,
    motivo: string,
    actor: Usuario,
    ip: string | null,
  ): Promise<void> {
    const repository = manager.getRepository(AsignacionTutor);
    const tutor = await repository.findOne({
      where: { asignacion_tema_id: asignacionTemaId, estado: AsignacionTutorEstado.VIGENTE },
      lock: { mode: 'pessimistic_write' },
    });
    if (!tutor) return;
    const before = {
      asignacion_tema_id: tutor.asignacion_tema_id,
      docente_id: tutor.docente_id,
      tutor_propuesto_id: tutor.tutor_propuesto_id,
      tipo: tutor.tipo,
      estado: tutor.estado,
      asignada_por_id: tutor.asignada_por_id,
      fecha_asignacion: tutor.fecha_asignacion,
      fecha_fin: tutor.fecha_fin,
      motivo_cambio: tutor.motivo_cambio,
    };
    tutor.estado = AsignacionTutorEstado.ANULADA;
    tutor.fecha_fin = new Date();
    tutor.motivo_cambio = motivo.trim();
    await repository.save(tutor);
    await this.auditoria.registrar(manager, {
      actor,
      accion: 'ANULAR_ASIGNACION_TUTOR',
      entidad_tipo: 'asignacion_tutor',
      entidad_id: tutor.id,
      valores_anteriores: before,
      valores_nuevos: {
        ...before,
        estado: tutor.estado,
        fecha_fin: tutor.fecha_fin,
        motivo_cambio: tutor.motivo_cambio,
        periodo_id: periodoId,
      },
      ip_origen: ip,
    });
  }
}
