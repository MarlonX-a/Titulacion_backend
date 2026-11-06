import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AcademicoService } from '../academico/academico.service.js';
import { construirCatalogo } from '../academico/catalogo-academico.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { Estudiante } from './entities/estudiante.entity.js';
import { EstudiantesService } from './estudiantes.service.js';

function setup() {
  const usuario = { id: 'u-1', email: 'e1@live.uleam.edu.ec', nombres: 'Ana', apellidos: 'Pérez', rol: UsuarioRol.ESTUDIANTE, estado: UsuarioEstado.ACTIVO };
  const estudianteRepo = { create: vi.fn((v: object) => v), save: vi.fn(async (v: object) => ({ id: 'e-1', ...v })), findAndCount: vi.fn(async () => [[], 0]) };
  const manager = { getRepository: (entity: unknown) => (entity === Usuario ? { findOne: vi.fn(async () => usuario) } : entity === Estudiante ? estudianteRepo : null) };
  const dataSource = { transaction: vi.fn(async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager)) };
  const academico = new AcademicoService();
  vi.spyOn(academico, 'catalogo').mockResolvedValue(construirCatalogo([{ id: 'fac-1', codigo: 'F', nombre: 'Facultad' }], [{ id: 'car-1', codigo: 'SOFTWARE', nombre: 'Ingeniería en Software', facultad_id: 'fac-1' }]));
  return { service: new EstudiantesService(estudianteRepo as never, dataSource as never, academico), estudianteRepo };
}

describe('EstudiantesService carrera', () => {
  const dto = { usuario_id: 'u-1', cedula: '1316661675', matricula: 'M-1', carrera_id: 'car-1', nivel: 8 };

  it('guarda carrera_id y responde la carrera como { id, nombre }', async () => {
    const state = setup();
    const result = await state.service.create(dto as never);
    expect(state.estudianteRepo.create).toHaveBeenCalledWith(expect.objectContaining({ carrera_id: 'car-1' }));
    expect(result.carrera).toEqual({ id: 'car-1', nombre: 'Ingeniería en Software' });
  });

  it('rechaza una carrera inexistente con 400', async () => {
    const state = setup();
    await expect(state.service.create({ ...dto, carrera_id: 'nope' } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(state.estudianteRepo.save).not.toHaveBeenCalled();
  });

  it('filtra el listado por carrera', async () => {
    const state = setup();
    await state.service.list({ page: 1, limit: 20, carrera_id: 'car-1' } as never);
    expect(state.estudianteRepo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: { carrera_id: 'car-1' } }));
  });
});
