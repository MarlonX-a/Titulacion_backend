import { NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { ConflictosService } from '../conflictos/conflictos.service.js';
import { completarConteo, ResumenPeriodoService } from './resumen-periodo.service.js';

describe('ResumenPeriodoService', () => {
  const periodoId = '00000000-0000-4000-8000-000000000010';

  function setup(row: Record<string, unknown> | undefined) {
    const query = vi.fn().mockResolvedValue(row ? [row] : []);
    const dataSource = { options: { schema: 'titulacion_dev' }, query } as unknown as DataSource;
    const conflictos = { contarSinResolver: vi.fn().mockResolvedValue(2) } as unknown as ConflictosService;
    return { service: new ResumenPeriodoService(dataSource, conflictos), query, conflictos };
  }

  it('devuelve los indicadores del panel con todos los estados completados en 0', async () => {
    const { service, query } = setup({
      existe: true, estudiantes_habilitados: 12, condicionados_pendientes: 3,
      habilitados_por_estado: { HABILITADO: 11, SUSPENDIDO: 1 }, habilitados_por_condicion: { REGULAR: 9, CONDICIONADO: 3 },
      habilitados_por_situacion: { ADMITIDO: 8, PENDIENTE: 3, NO_ADMITIDO: 1 },
      temas_por_estado: { PUBLICADO: 4 }, postulaciones_por_estado: null,
      asignaciones_vigentes: 5, tutores_asignados: 3, pat_por_estado: { PENDIENTE: 2, APROBADO: 1, SIN_ENTREGA: 2 },
    });

    const resumen = await service.obtener(periodoId);

    expect(resumen).toMatchObject({
      periodo_id: periodoId, estudiantes_habilitados: 12, condicionados_pendientes: 3,
      conflictos_abiertos: 2, asignaciones_vigentes: 5, tutores_asignados: 3, sin_tutor: 2, pat_por_revisar: 2,
      temas_por_estado: { BORRADOR: 0, PUBLICADO: 4, CERRADO: 0, ASIGNADO: 0, RETIRADO: 0 },
      postulaciones_por_estado: { PENDIENTE: 0, EN_CONFLICTO: 0, ACEPTADA: 0, RECHAZADA: 0, CANCELADA: 0, ANULADA: 0 },
      pat_por_estado: { PENDIENTE: 2, APROBADO: 1, OBSERVADO: 0, RECHAZADO: 0, SIN_ENTREGA: 2 },
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('"titulacion_dev"."estudiante_habilitado"');
    expect(query.mock.calls[0][1]).toEqual([periodoId]);
  });

  it('responde 404 cuando el período no existe', async () => {
    const { service, conflictos } = setup({ existe: false });
    await expect(service.obtener(periodoId)).rejects.toBeInstanceOf(NotFoundException);
    expect(conflictos.contarSinResolver).not.toHaveBeenCalled();
  });

  it('completa claves faltantes sin descartar las devueltas', () => {
    expect(completarConteo(['A', 'B'], { B: 2, C: 1 })).toEqual({ A: 0, B: 2, C: 1 });
    expect(completarConteo(['A'], null)).toEqual({ A: 0 });
  });
});
