import { resumenCatalogo, type CatalogoAcademico } from '../academico/catalogo-academico.js';
import type { PeriodoResponseDto } from './dto/periodo-response.dto.js';
import type { PeriodoTitulacion } from './entities/periodo-titulacion.entity.js';

export function periodoResponse(periodo: PeriodoTitulacion, catalogo: CatalogoAcademico): PeriodoResponseDto {
  return {
    id: periodo.id,
    codigo: periodo.codigo,
    nombre: periodo.nombre,
    fecha_inicio_postulacion: periodo.fecha_inicio_postulacion,
    fecha_fin_postulacion: periodo.fecha_fin_postulacion,
    fecha_inicio_titulacion: periodo.fecha_inicio_titulacion,
    estado: periodo.estado,
    max_integrantes_default: periodo.max_integrantes_default,
    facultad_id: periodo.facultad_id,
    facultad: resumenCatalogo(catalogo.facultad(periodo.facultad_id), periodo.facultad_id),
  };
}
