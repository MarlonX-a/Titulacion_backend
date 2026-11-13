import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateHabilitacionDto } from './create-habilitacion.dto.js';
import { ResolveIngresoDto } from './resolve-ingreso.dto.js';
import { UpdateHabilitacionDto } from './update-habilitacion.dto.js';

const uuid = '3f6d3b0e-6f6e-4a35-9c1b-0f5a8f6a3d11';

describe('límites de texto de habilitaciones (ADMIN)', () => {
  it('rechaza un requisito_pendiente de más de 1000 caracteres al crear', async () => {
    const dto = plainToInstance(CreateHabilitacionDto, { estudiante_id: uuid, condicion_ingreso: 'CONDICIONADO', requisito_pendiente: 'x'.repeat(1001) });
    expect((await validate(dto)).map((e) => e.property)).toContain('requisito_pendiente');
    expect(await validate(plainToInstance(CreateHabilitacionDto, { estudiante_id: uuid, condicion_ingreso: 'CONDICIONADO', requisito_pendiente: 'x'.repeat(1000) }))).toHaveLength(0);
  });

  it('rechaza una observación de ingreso de más de 1000 caracteres', async () => {
    const dto = plainToInstance(ResolveIngresoDto, { situacion_ingreso: 'NO_ADMITIDO', observacion_ingreso: 'x'.repeat(1001) });
    expect((await validate(dto)).map((e) => e.property)).toContain('observacion_ingreso');
    expect(await validate(plainToInstance(ResolveIngresoDto, { situacion_ingreso: 'NO_ADMITIDO', observacion_ingreso: 'x'.repeat(1000) }))).toHaveLength(0);
  });

  it('rechaza un requisito_pendiente de más de 1000 caracteres al editar', async () => {
    const dto = plainToInstance(UpdateHabilitacionDto, { condicion_ingreso: 'CONDICIONADO', requisito_pendiente: 'x'.repeat(1001) });
    expect((await validate(dto)).map((e) => e.property)).toContain('requisito_pendiente');
  });
});
