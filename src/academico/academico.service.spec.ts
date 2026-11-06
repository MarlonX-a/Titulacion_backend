import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AcademicoService } from './academico.service.js';
import { Carrera } from './entities/carrera.entity.js';
import { Facultad } from './entities/facultad.entity.js';

const facultades = [
  { id: 'fac-vida', codigo: 'FACULTAD_CIENCIAS_DE_LA_VIDA_Y_TECNOLOGIAS', nombre: 'Facultad Ciencias de la Vida y Tecnologías' },
  { id: 'fac-salud', codigo: 'FACULTAD_CIENCIAS_DE_LA_SALUD', nombre: 'Facultad Ciencias de la Salud' },
];
const carreras = [
  { id: 'car-sistemas', codigo: 'INGENIERIA_EN_SISTEMAS', nombre: 'Ingeniería en Sistemas', facultad_id: 'fac-vida' },
  { id: 'car-software', codigo: 'INGENIERIA_EN_SOFTWARE', nombre: 'Ingeniería en Software', facultad_id: 'fac-vida' },
  { id: 'car-medicina', codigo: 'MEDICINA', nombre: 'Medicina', facultad_id: 'fac-salud' },
];

function fuente() {
  const facultadRepo = { find: vi.fn(async () => facultades) };
  const carreraRepo = { find: vi.fn(async () => carreras) };
  return { facultadRepo, getRepository: (entity: unknown) => (entity === Facultad ? facultadRepo : entity === Carrera ? carreraRepo : null) };
}

describe('AcademicoService', () => {
  it('agrupa las carreras por facultad, ordenadas por nombre, y carga el catálogo una sola vez', async () => {
    const service = new AcademicoService();
    const datos = fuente();
    const catalogo = await service.catalogo(datos as never);
    await service.catalogo(datos as never);
    expect(datos.facultadRepo.find).toHaveBeenCalledTimes(1);
    expect(catalogo.facultades.map((f) => f.nombre)).toEqual(['Facultad Ciencias de la Salud', 'Facultad Ciencias de la Vida y Tecnologías']);
    expect(catalogo.facultad('fac-vida')?.carreras.map((c) => c.nombre)).toEqual(['Ingeniería en Sistemas', 'Ingeniería en Software']);
  });

  it('rechaza facultades y carreras inexistentes con 400', async () => {
    const service = new AcademicoService();
    await expect(service.buscarFacultad(fuente() as never, 'nope')).rejects.toThrow(new BadRequestException('No existe la facultad indicada.'));
    await expect(service.buscarCarrera(fuente() as never, 'nope')).rejects.toThrow(new BadRequestException('No existe la carrera indicada.'));
  });

  it('acepta una carrera de la facultad y rechaza otra nombrando ambas', async () => {
    const service = new AcademicoService();
    await expect(service.assertCarreraEnFacultad(fuente() as never, 'car-software', 'fac-vida')).resolves.toMatchObject({ id: 'car-software' });
    await expect(service.assertCarreraEnFacultad(fuente() as never, 'car-medicina', 'fac-vida'))
      .rejects.toThrow('La carrera «Medicina» no pertenece a la facultad «Facultad Ciencias de la Vida y Tecnologías» del período.');
  });

  it('compara la carrera de un participante con la del tema', async () => {
    const service = new AcademicoService();
    await expect(service.assertMismaCarrera(fuente() as never, 'car-software', 'car-software', 'del estudiante')).resolves.toBeUndefined();
    await expect(service.assertMismaCarrera(fuente() as never, 'car-sistemas', 'car-software', 'del docente proponente'))
      .rejects.toThrow('La carrera del docente proponente («Ingeniería en Sistemas») no coincide con la carrera del tema («Ingeniería en Software»).');
  });

  it('reintenta la carga si la primera consulta falla', async () => {
    const service = new AcademicoService();
    const datos = fuente();
    datos.facultadRepo.find.mockRejectedValueOnce(new Error('caída'));
    await expect(service.catalogo(datos as never)).rejects.toThrow('caída');
    await expect(service.catalogo(datos as never)).resolves.toHaveProperty('facultades');
  });
});
