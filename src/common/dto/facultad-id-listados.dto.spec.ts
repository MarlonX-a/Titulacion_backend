import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListDocentesQueryDto } from '../../docentes/dto/list-docentes-query.dto.js';
import { ListEstudiantesQueryDto } from '../../estudiantes/dto/list-estudiantes-query.dto.js';
import { ListHabilitadosQueryDto } from '../../habilitados/dto/list-habilitados-query.dto.js';
import { ListTemasQueryDto } from '../../temas/dto/list-temas-query.dto.js';

const uuid = '3f6d3b0e-6f6e-4a35-9c1b-0f5a8f6a3d11';

describe.each([
  ['ListTemasQueryDto', ListTemasQueryDto],
  ['ListDocentesQueryDto', ListDocentesQueryDto],
  ['ListEstudiantesQueryDto', ListEstudiantesQueryDto],
  ['ListHabilitadosQueryDto', ListHabilitadosQueryDto],
])('%s facultad_id', (_nombre, Dto) => {
  it('es opcional', async () => {
    expect(await validate(plainToInstance(Dto, {}))).toHaveLength(0);
  });

  it('acepta un UUID', async () => {
    expect(await validate(plainToInstance(Dto, { facultad_id: uuid }))).toHaveLength(0);
  });

  it('rechaza un valor que no es UUID', async () => {
    expect((await validate(plainToInstance(Dto, { facultad_id: 'no-uuid' }))).map((e) => e.property)).toContain('facultad_id');
  });
});
