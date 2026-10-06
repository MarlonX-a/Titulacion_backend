import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResolverConflictoDto } from '../src/conflictos/dto/resolver-conflicto.dto.js';
import { CriterioConflicto } from '../src/conflictos/enums/criterio-conflicto.enum.js';

const first = '10000000-0000-4000-8000-000000000001';
const second = '10000000-0000-4000-8000-000000000002';

function dto(value: Record<string, unknown>): ResolverConflictoDto {
  return plainToInstance(ResolverConflictoDto, value);
}

describe('ResolverConflictoDto', () => {
  it('acepta una decisión PROMEDIO con puntajes numéricos y justificación', async () => {
    const errors = await validate(dto({
      criterio_aplicado: CriterioConflicto.PROMEDIO,
      postulacion_ganadora_id: second,
      justificacion: 'Decisión de la comisión.',
      participantes: [
        { postulacion_id: first, puntaje_criterio: 8.25 },
        { postulacion_id: second, puntaje_criterio: 9.5 },
      ],
    }), { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
  });

  it('rechaza puntajes enviados como texto, nulos o con más de dos decimales', async () => {
    for (const score of ['9.5', null, 9.555]) {
      const errors = await validate(dto({
        criterio_aplicado: CriterioConflicto.PROMEDIO,
        postulacion_ganadora_id: second,
        justificacion: 'Decisión de la comisión.',
        participantes: [
          { postulacion_id: first, puntaje_criterio: score },
          { postulacion_id: second, puntaje_criterio: 9.5 },
        ],
      }));
      expect(errors).not.toHaveLength(0);
    }
  });

  it('rechaza justificación vacía, menos de dos candidaturas y campos adicionales', async () => {
    const errors = await validate(dto({
      criterio_aplicado: CriterioConflicto.SORTEO,
      postulacion_ganadora_id: first,
      justificacion: '   ',
      participantes: [{ postulacion_id: first }],
      resuelto_por_id: 'no-controlado-por-cliente',
    }), { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
