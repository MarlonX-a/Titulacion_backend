import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AcademicoService } from '../academico/academico.service.js';
import { construirCatalogo } from '../academico/catalogo-academico.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { DocentesService } from './docentes.service.js';
import { Docente } from './entities/docente.entity.js';

const CATALOGO = construirCatalogo(
  [{ id: 'fac-1', codigo: 'FAC', nombre: 'Facultad' }],
  [{ id: 'car-1', codigo: 'SOFTWARE', nombre: 'Ingeniería en Software', facultad_id: 'fac-1' }, { id: 'car-2', codigo: 'SISTEMAS', nombre: 'Ingeniería en Sistemas', facultad_id: 'fac-1' }],
);

function setup(temasPropuestos = 0) {
  const usuario = { id: 'u-1', email: 'd@uleam.edu.ec', nombres: 'Doc', apellidos: 'Ente', rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO };
  const docente = { id: 'd-1', usuario, cedula: null, titulo_academico: null, carrera_id: 'car-1', habilitado_tutoria: false };
  const docenteRepo = {
    findOne: vi.fn(async (options: { where: { id?: string; cedula?: string } }) => (options.where.cedula ? null : { ...docente })),
    create: vi.fn((value: object) => value),
    save: vi.fn(async (value: object) => ({ id: 'd-2', ...value })),
    update: vi.fn(async () => ({ affected: 1 })),
  };
  const usuarioRepo = { findOne: vi.fn(async () => usuario), update: vi.fn(async () => ({ affected: 1 })) };
  const manager = {
    getRepository: (entity: unknown) => (entity === Docente ? docenteRepo : entity === Usuario ? usuarioRepo : null),
    query: vi.fn(async () => [{ total: temasPropuestos }]),
    connection: { options: { schema: 'titulacion_dev' } },
  };
  const dataSource = { options: { schema: 'titulacion_dev' }, transaction: vi.fn(async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager)) };
  const academico = new AcademicoService();
  vi.spyOn(academico, 'catalogo').mockResolvedValue(CATALOGO);
  const auditoria = { registrar: vi.fn(async () => undefined) };
  const service = new DocentesService({} as never, dataSource as never, { revocarSesiones: vi.fn() } as never, auditoria as never, academico);
  return { service, docenteRepo, auditoria };
}

describe('DocentesService carrera', () => {
  it('vincula una cuenta con su carrera y responde la carrera como { id, nombre }', async () => {
    const state = setup();
    const result = await state.service.create({ usuario_id: 'u-1', carrera_id: 'car-1' } as never, { id: 'admin' } as never, null);
    expect(state.docenteRepo.create).toHaveBeenCalledWith(expect.objectContaining({ carrera_id: 'car-1' }));
    expect(result.carrera).toEqual({ id: 'car-1', nombre: 'Ingeniería en Software' });
  });

  it('rechaza una carrera inexistente con 400', async () => {
    const state = setup();
    await expect(state.service.create({ usuario_id: 'u-1', carrera_id: 'nope' } as never, { id: 'admin' } as never, null)).rejects.toBeInstanceOf(BadRequestException);
    expect(state.docenteRepo.save).not.toHaveBeenCalled();
  });

  it('cambia la carrera de un docente sin temas propuestos y la audita', async () => {
    const state = setup(0);
    const result = await state.service.update('d-1', { carrera_id: 'car-2' } as never, { id: 'admin' } as never, null);
    expect(state.docenteRepo.update).toHaveBeenCalledWith({ id: 'd-1' }, { carrera_id: 'car-2' });
    expect(result.carrera).toEqual({ id: 'car-2', nombre: 'Ingeniería en Sistemas' });
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ valores_nuevos: expect.objectContaining({ carrera_id: 'car-2' }) }));
  });

  it('impide cambiar la carrera de un docente proponente de temas', async () => {
    const state = setup(1);
    await expect(state.service.update('d-1', { carrera_id: 'car-2' } as never, { id: 'admin' } as never, null)).rejects.toBeInstanceOf(ConflictException);
    expect(state.docenteRepo.update).not.toHaveBeenCalled();
  });
});
