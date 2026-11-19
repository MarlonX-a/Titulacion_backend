import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { AcademicoService } from '../academico/academico.service.js';
import { construirCatalogo } from '../academico/catalogo-academico.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateProgramaDto } from './dto/programa.dto.js';
import { Programa } from './entities/programa.entity.js';
import { ProgramasService } from './programas.service.js';

const admin = { id: 'admin-id', rol: UsuarioRol.ADMIN };
const coordinador = { id: 'coord-id', rol: UsuarioRol.COORDINADOR };
const otroCoordinador = { id: 'coord-2', rol: UsuarioRol.COORDINADOR };
const estudiante = { id: 'est-user', rol: UsuarioRol.ESTUDIANTE };

interface Opciones { temas?: number; programa?: Partial<Programa> | null; usuarioRol?: UsuarioRol; docenteCarrera?: string }

function setup(opciones: Opciones = {}) {
  const programa = opciones.programa === null ? null : {
    id: 'prog-id', nombre: 'Programa IA', descripcion: null, carrera_id: 'car-1', responsable_docente_id: null, responsable_usuario_id: 'coord-id',
    max_temas: 15, activo: true, creado_en: new Date(), actualizado_en: new Date(), responsable_usuario: { nombres: 'Cora', apellidos: 'Coord' }, ...opciones.programa,
  };
  const programaRepo = {
    findOne: vi.fn(async () => (programa ? { ...programa } : null)),
    findAndCount: vi.fn(async () => [programa ? [programa] : [], programa ? 1 : 0]),
    create: vi.fn((value: object) => value),
    save: vi.fn(async (value: object) => ({ id: 'prog-id', ...value })),
  };
  const repos = new Map<unknown, unknown>([
    [Programa, programaRepo],
    [Docente, { findOne: vi.fn(async () => ({ id: 'doc-id', carrera_id: opciones.docenteCarrera ?? 'car-1', usuario: { estado: UsuarioEstado.ACTIVO, nombres: 'D', apellidos: 'D' } })) }],
    [Usuario, { findOne: vi.fn(async () => ({ id: 'coord-id', rol: opciones.usuarioRol ?? UsuarioRol.COORDINADOR, estado: UsuarioEstado.ACTIVO })) }],
    [Estudiante, { findOne: vi.fn(async () => ({ id: 'est-id', carrera_id: 'car-1' })) }],
  ]);
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('GROUP BY "programa_id"')) return [{ programa_id: 'prog-id', total: opciones.temas ?? 0 }];
    if (sql.includes('count(*)::int AS total')) return [{ total: opciones.temas ?? 0 }];
    if (sql.includes('LIMIT 1')) return (opciones.temas ?? 0) > 0 ? [{ '?column?': 1 }] : [];
    return [];
  });
  const manager = { connection: { options: { schema: 'titulacion_dev' } }, query, getRepository: (entity: unknown) => repos.get(entity) };
  const dataSource = { ...manager, manager, transaction: vi.fn(async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager)) };
  const auditoria = { registrar: vi.fn(async () => undefined) };
  const academico = new AcademicoService();
  vi.spyOn(academico, 'catalogo').mockResolvedValue(construirCatalogo(
    [{ id: 'fac-1', codigo: 'F1', nombre: 'Facultad' }],
    [{ id: 'car-1', codigo: 'C1', nombre: 'Software', facultad_id: 'fac-1' }, { id: 'car-2', codigo: 'C2', nombre: 'Sistemas', facultad_id: 'fac-1' }],
  ));
  const service = new ProgramasService(programaRepo as never, dataSource as never, auditoria as never, academico);
  return { service, programaRepo, manager, auditoria };
}

const base = { nombre: '  Programa IA  ', carrera_id: 'car-1' };

describe('ProgramasService: creación y responsables', () => {
  it('ADMIN exige exactamente un responsable', async () => {
    const state = setup();
    await expect(state.service.create(base as never, admin as never, null)).rejects.toBeInstanceOf(BadRequestException);
    await expect(state.service.create({ ...base, responsable_docente_id: 'doc-id', responsable_usuario_id: 'coord-id' } as never, admin as never, null)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ADMIN crea con un docente de la misma carrera, máximo 15 por defecto y auditoría', async () => {
    const state = setup();
    await state.service.create({ ...base, responsable_docente_id: 'doc-id' } as never, admin as never, '10.0.0.1');
    expect(state.programaRepo.create).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Programa IA', responsable_docente_id: 'doc-id', responsable_usuario_id: null, max_temas: 15 }));
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'CREAR_PROGRAMA', entidad_tipo: 'programa' }));
  });

  it('rechaza un docente responsable de otra carrera y un usuario que no es COORDINADOR', async () => {
    const otraCarrera = setup({ docenteCarrera: 'car-2' });
    await expect(otraCarrera.service.create({ ...base, responsable_docente_id: 'doc-id' } as never, admin as never, null)).rejects.toThrow('El docente responsable debe pertenecer a la carrera del programa.');
    const noCoordinador = setup({ usuarioRol: UsuarioRol.DOCENTE });
    await expect(noCoordinador.service.create({ ...base, responsable_usuario_id: 'coord-id' } as never, admin as never, null)).rejects.toThrow('El responsable debe ser una cuenta COORDINADOR activa.');
  });

  it('COORDINADOR queda como responsable y no puede nombrar a otro', async () => {
    const state = setup();
    await state.service.create(base as never, coordinador as never, null);
    expect(state.programaRepo.create).toHaveBeenCalledWith(expect.objectContaining({ responsable_usuario_id: 'coord-id', responsable_docente_id: null }));
    await expect(state.service.create({ ...base, responsable_docente_id: 'doc-id' } as never, coordinador as never, null)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(state.service.create({ ...base, responsable_usuario_id: 'coord-2' } as never, coordinador as never, null)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ProgramasService: edición', () => {
  it('COORDINADOR solo edita sus programas y no cambia el responsable', async () => {
    const state = setup();
    await expect(state.service.update('prog-id', { nombre: 'Otro' }, otroCoordinador as never, null)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(state.service.update('prog-id', { responsable_docente_id: 'doc-id' }, coordinador as never, null)).rejects.toBeInstanceOf(ForbiddenException);
    await state.service.update('prog-id', { nombre: 'Programa renombrado' }, coordinador as never, null);
    expect(state.programaRepo.save).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Programa renombrado' }));
  });

  it('no baja max_temas por debajo de los temas actuales ni cambia la carrera con temas', async () => {
    const state = setup({ temas: 5 });
    await expect(state.service.update('prog-id', { max_temas: 4 }, admin as never, null)).rejects.toThrow('El programa tiene 5 temas; el máximo no puede ser menor.');
    await expect(state.service.update('prog-id', { carrera_id: 'car-2' }, admin as never, null)).rejects.toThrow('No se puede cambiar la carrera de un programa que ya tiene temas.');
    await state.service.update('prog-id', { max_temas: 5, activo: false }, admin as never, null);
    expect(state.programaRepo.save).toHaveBeenCalledWith(expect.objectContaining({ max_temas: 5, activo: false }));
  });

  it('cambiar a un responsable docente quita el COORDINADOR', async () => {
    const state = setup();
    await state.service.update('prog-id', { responsable_docente_id: 'doc-id' }, admin as never, null);
    expect(state.programaRepo.save).toHaveBeenCalledWith(expect.objectContaining({ responsable_docente_id: 'doc-id', responsable_usuario_id: null }));
  });

  it('rechaza un cuerpo vacío y un programa inexistente', async () => {
    await expect(setup().service.update('prog-id', {}, admin as never, null)).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ programa: null }).service.update('prog-id', { nombre: 'X' }, admin as never, null)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProgramasService: reglas de temas', () => {
  it('rechaza un programa de otra carrera, inactivo o sin cupo', async () => {
    const otraCarrera = setup();
    await expect(otraCarrera.service.validarParaTema(otraCarrera.manager as never, 'prog-id', 'car-2', admin as never, null)).rejects.toThrow('La carrera del tema debe coincidir con la del programa.');
    const inactivo = setup({ programa: { activo: false } });
    await expect(inactivo.service.validarParaTema(inactivo.manager as never, 'prog-id', 'car-1', admin as never, null)).rejects.toThrow('El programa está inactivo.');
    const lleno = setup({ temas: 15 });
    await expect(lleno.service.validarParaTema(lleno.manager as never, 'prog-id', 'car-1', admin as never, null)).rejects.toThrow('El programa alcanzó su máximo de 15 temas.');
  });

  it('acepta el tema número max_temas y bloquea la fila del programa', async () => {
    const state = setup({ temas: 14 });
    await expect(state.service.validarParaTema(state.manager as never, 'prog-id', 'car-1', admin as never, null)).resolves.toMatchObject({ id: 'prog-id' });
    expect(state.programaRepo.findOne).toHaveBeenCalledWith({ where: { id: 'prog-id' }, lock: { mode: 'pessimistic_write' } });
  });

  it('un COORDINADOR solo usa sus programas', async () => {
    const state = setup();
    await expect(state.service.validarParaTema(state.manager as never, 'prog-id', 'car-1', otroCoordinador as never, null)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(state.service.assertCoordinadorDelPrograma(state.manager as never, null, coordinador as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(state.service.assertCoordinadorDelPrograma(state.manager as never, 'prog-id', coordinador as never)).resolves.toBeUndefined();
    await expect(state.service.assertCoordinadorDelPrograma(state.manager as never, null, admin as never)).resolves.toBeUndefined();
  });
});

describe('ProgramasService: lectura', () => {
  it('ESTUDIANTE solo ve programas activos de su carrera', async () => {
    const state = setup();
    await state.service.list({ page: 1, limit: 20, carrera_id: 'car-1' } as never, estudiante as never);
    expect(state.programaRepo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ carrera_id: 'car-1', activo: true }) }));
    await expect(state.service.list({ page: 1, limit: 20, carrera_id: 'car-2' } as never, estudiante as never)).resolves.toMatchObject({ data: [], total: 0 });
    const inactivo = setup({ programa: { activo: false } });
    await expect(inactivo.service.getById('prog-id', estudiante as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mios=true filtra por el COORDINADOR responsable y la respuesta incluye responsable y temas', async () => {
    const state = setup({ temas: 3 });
    const result = await state.service.list({ page: 1, limit: 20, mios: true, facultad_id: 'fac-1' } as never, coordinador as never);
    expect(state.programaRepo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: { carrera: { facultad_id: 'fac-1' }, responsable_usuario_id: 'coord-id' } }));
    expect(result.data[0]).toMatchObject({ temas_registrados: 3, responsable: { tipo: 'COORDINADOR', id: 'coord-id' }, carrera: { id: 'car-1', nombre: 'Software' } });
  });
});

describe('CreateProgramaDto', () => {
  it('limita max_temas a 1..50 y exige nombre', async () => {
    const errores = async (body: object) => (await validate(plainToInstance(CreateProgramaDto, body))).map((error) => error.property);
    expect(await errores({ nombre: 'P', carrera_id: '00000000-0000-4000-8000-000000000001', max_temas: 51 })).toEqual(['max_temas']);
    expect(await errores({ nombre: 'P', carrera_id: '00000000-0000-4000-8000-000000000001', max_temas: 0 })).toEqual(['max_temas']);
    expect(await errores({ nombre: '   ', carrera_id: '00000000-0000-4000-8000-000000000001' })).toEqual(['nombre']);
    expect(await errores({ nombre: 'P', carrera_id: '00000000-0000-4000-8000-000000000001', max_temas: 50 })).toEqual([]);
  });
});

describe('Conflictos de base de datos', () => {
  it('traduce el nombre repetido por carrera a 409', async () => {
    const state = setup();
    const { QueryFailedError } = await import('typeorm');
    state.programaRepo.save.mockRejectedValueOnce(new QueryFailedError('INSERT', [], Object.assign(new Error('dup'), { code: '23505', constraint: 'UQ_programa_carrera_nombre' })));
    await expect(state.service.create({ ...base, responsable_docente_id: 'doc-id' } as never, admin as never, null)).rejects.toThrow(new ConflictException('Ya existe un programa con ese nombre en la carrera.'));
  });
});
