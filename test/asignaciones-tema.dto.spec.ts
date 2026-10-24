import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AsignarTemaDto } from '../src/asignaciones-tema/dto/asignar-tema.dto.js';

describe('AsignarTemaDto', () => {
  it('recorta y acepta un motivo no vacío de hasta 1000 caracteres', async () => {
    const dto = plainToInstance(AsignarTemaDto, { motivo: '  Decisión de la comisión.  ' });

    expect(dto.motivo).toBe('Decisión de la comisión.');
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    { motivo: '   ' },
    { motivo: null },
    { motivo: 'x'.repeat(1001) },
    { motivo: 'Válido', estado: 'ACEPTADA' },
  ])('rechaza entrada inválida o campos que no pertenecen al contrato: %j', async (value) => {
    const dto = plainToInstance(AsignarTemaDto, value);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.length).toBeGreaterThan(0);
  });
});
