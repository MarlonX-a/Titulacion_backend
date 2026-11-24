import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AsignacionTema } from '../asignaciones-tema/entities/asignacion-tema.entity.js';
import { AsignacionTemaEstado } from '../asignaciones-tema/enums/asignacion-tema-estado.enum.js';
import { AsignacionTemaOrigen } from '../asignaciones-tema/enums/asignacion-tema-origen.enum.js';
import { AsignacionTutor } from '../asignaciones-tutor/entities/asignacion-tutor.entity.js';
import { AsignacionTutorEstado } from '../asignaciones-tutor/enums/asignacion-tutor-estado.enum.js';
import { AsignacionTutorTipo } from '../asignaciones-tutor/enums/asignacion-tutor-tipo.enum.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { Grupo } from '../grupos/entities/grupo.entity.js';
import { GrupoIntegrante } from '../grupos/entities/grupo-integrante.entity.js';
import { GrupoEstado } from '../grupos/enums/grupo-estado.enum.js';
import { GrupoIntegranteRol } from '../grupos/enums/grupo-integrante-rol.enum.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { TipoTema } from '../temas/enums/tipo-tema.enum.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CandidatoTutor } from './entities/candidato-tutor.entity.js';
import { EquiposService } from './equipos.service.js';

const CARRERA = 'carrera-1';
const estudiante = (id: string, apellidos: string) => ({ id, carrera_id: CARRERA, usuario: { nombres: 'Ana', apellidos } });
const docente = (id: string, apellidos: string, habilitado = true) => ({ id, habilitado_tutoria: habilitado, usuario: { nombres: 'Luis', apellidos, estado: UsuarioEstado.ACTIVO, rol: UsuarioRol.DOCENTE } });
const config = (bloquear: boolean, max = 5) => ({ id: 'config-1', max_trabajos: max, bloquear_al_superar: bloquear });

interface Opciones {
  periodo?: PeriodoEstado | null;
  tipoTema?: TipoTema;
  estadoTema?: EstadoTema;
  enGrupoActivo?: string[];
  cargaExcedida?: { bloquear: boolean };
  asignacionExistente?: Partial<AsignacionTema>;
  tutorVigente?: Partial<AsignacionTutor> | null;
}

function setup(o: Opciones = {}) {
  const actor = { id: 'admin-id' };
  const saved = { asignaciones: [] as Array<Record<string, unknown>>, grupos: [] as Array<Record<string, unknown>>, integrantes: [] as Array<Record<string, unknown>>, candidatos: [] as Array<Record<string, unknown>>, tutores: [] as Array<Record<string, unknown>>, temas: [] as Array<Record<string, unknown>>, historial: [] as unknown[] };
  const periodo = o.periodo === null ? null : { id: 'periodo-id', estado: o.periodo ?? PeriodoEstado.POSTULACION_CERRADA, max_integrantes_default: 4, fecha_inicio_titulacion: new Date(Date.now() + 86_400_000) };
  const tema = { id: 'tema-id', titulo: 'Plataforma de seguimiento', tipo: o.tipoTema ?? TipoTema.INDIVIDUAL, estado: o.estadoTema ?? EstadoTema.PUBLICADO, carrera_id: CARRERA, linea: { id: 'linea-id' }, docente_proponente: { id: 'doc-proponente' } };
  const estudiantes = [estudiante('e1', 'Zambrano'), estudiante('e2', 'Briones'), estudiante('e3', 'Cedeño')];
  const docentes = [docente('d1', 'Mendoza'), docente('d2', 'Vera'), docente('d3', 'Loor')];
  let id = 0;
  const nuevo = (prefijo: string) => `${prefijo}-${++id}`;
  const guardar = (lista: Array<Record<string, unknown>>, prefijo: string) => vi.fn(async (value: Record<string, unknown>) => {
    if (!value.id) value.id = nuevo(prefijo);
    if (!lista.includes(value)) lista.push(value);
    return value;
  });
  const asignacionExistente = o.asignacionExistente ? { id: 'asig-1', periodo_id: 'periodo-id', origen: AsignacionTemaOrigen.ADMIN, estado: AsignacionTemaEstado.VIGENTE, ...o.asignacionExistente } : null;
  const candidatoExistente = { id: 'cand-2', asignacion_tema_id: 'asig-1', docente_id: 'd2', prioridad: 2 };
  const tutorVigente = o.tutorVigente ? { id: 'tutor-viejo', docente_id: 'd1', tipo: AsignacionTutorTipo.CANDIDATO_CONFIRMADO, estado: AsignacionTutorEstado.VIGENTE, ...o.tutorVigente } : null;
  const repos = new Map<unknown, Record<string, unknown>>([
    [PeriodoTitulacion, { findOne: vi.fn(async () => periodo) }],
    [Tema, { findOne: vi.fn(async () => tema), save: vi.fn(async (value: Record<string, unknown>) => { saved.temas.push({ ...value }); return value; }) }],
    [TemaHistorial, { create: (value: unknown) => value, save: vi.fn(async (value: unknown) => { saved.historial.push(value); return value; }) }],
    [AsignacionTema, { exist: vi.fn(async () => false), create: (value: unknown) => value, save: guardar(saved.asignaciones, 'asig'), findOne: vi.fn(async () => asignacionExistente) }],
    [Estudiante, { find: vi.fn(async () => estudiantes) }],
    [EstudianteHabilitado, { findOne: vi.fn(async () => ({ situacion_ingreso: SituacionIngreso.ADMITIDO })) }],
    [GrupoIntegrante, { exist: vi.fn(async ({ where }: { where: { estudiante: { id: string } } }) => (o.enGrupoActivo ?? []).includes(where.estudiante.id)), create: (value: unknown) => value, save: guardar(saved.integrantes, 'int') }],
    [Grupo, { create: (value: unknown) => value, save: guardar(saved.grupos, 'grupo') }],
    [CandidatoTutor, { create: (value: unknown) => value, save: guardar(saved.candidatos, 'cand'), findOneBy: vi.fn(async ({ id: candidatoId, asignacion_tema_id }: { id: string; asignacion_tema_id: string }) => candidatoId === candidatoExistente.id && asignacion_tema_id === candidatoExistente.asignacion_tema_id ? candidatoExistente : null) }],
    [AsignacionTutor, { create: (value: unknown) => value, save: guardar(saved.tutores, 'tutor'), findOne: vi.fn(async () => tutorVigente) }],
    [Docente, { createQueryBuilder: () => {
      let buscado = '';
      const qb = { innerJoinAndSelect: () => qb, where: (_sql: string, params: { id: string }) => { buscado = params.id; return qb; }, setLock: () => qb, getOne: async () => docentes.find((item) => item.id === buscado) ?? null };
      return qb;
    } }],
  ]);
  const query = vi.fn(async () => [] as unknown[]);
  const manager = { connection: { options: { schema: 'titulacion_dev' } }, query, getRepository: (entity: unknown) => { const repo = repos.get(entity); if (!repo) throw new Error('Repositorio no configurado.'); return repo; } };
  const dataSource = { transaction: vi.fn(async (_nivel: string, callback: (value: typeof manager) => Promise<unknown>) => callback(manager)) };
  const habilitados = { getEligibleStudentForGroup: vi.fn(async () => ({})) };
  const postulaciones = { estudianteTienePostulacionIndividualActiva: vi.fn(async () => false) };
  const asignaciones = { tieneVigenteParaEstudiante: vi.fn(async () => false), rechazarAbiertasDeOtrosPeriodos: vi.fn(async () => undefined) };
  const excede = o.cargaExcedida;
  const cargaTutorial = {
    evaluarCargaProyectada: vi.fn(async () => ({ actual: excede ? 5 : 1, proyectada: excede ? 6 : 2, excede_limite: !!excede, origen: 'GLOBAL', configuracion: config(excede?.bloquear ?? false), advertencia: excede && !excede.bloquear ? 'La carga proyectada (6) supera el máximo configurado (5).' : null })),
    resumirCargaDocentes: vi.fn(async (_m: unknown, _p: string, ids: string[]) => new Map(ids.map((docenteId) => [docenteId, { origen: 'GLOBAL', configuracion: config(false, 2), actual: docenteId === 'd3' ? 2 : 0 }]))),
  };
  const auditoria = { registrar: vi.fn(async () => undefined) };
  const notificaciones = { asignacionTema: vi.fn(async () => undefined), tutor: vi.fn(async () => undefined) };
  const consulta = { detalle: vi.fn(async (_p: string, asignacionId: string) => ({ id: asignacionId })) };
  const service = new EquiposService(dataSource as never, habilitados as never, postulaciones as never, asignaciones as never, cargaTutorial as never, auditoria as never, notificaciones as never, consulta as never);
  const acciones = () => auditoria.registrar.mock.calls.map((call) => ((call as unknown[])[1] as { accion: string }).accion);
  return { service, actor, saved, tema, query, dataSource, habilitados, postulaciones, asignaciones, cargaTutorial, auditoria, notificaciones, consulta, acciones };
}

const dto = (estudiante_ids: string[], docente_ids: string[], extra: Record<string, unknown> = {}) => ({ estudiante_ids, tema_id: 'tema-id', docente_ids, motivo: '  Acta de conformación 12  ', ...extra });

describe('EquiposService.crear', () => {
  it('conforma un trabajo individual sin postulación y deja vigente al único candidato', async () => {
    const s = setup();
    const result = await s.service.crear('periodo-id', dto(['e1'], ['d1']), s.actor as never, '127.0.0.1');

    expect(s.dataSource.transaction).toHaveBeenCalledWith('SERIALIZABLE', expect.any(Function));
    expect(s.saved.grupos).toHaveLength(0);
    expect(s.saved.asignaciones[0]).toMatchObject({ origen: AsignacionTemaOrigen.ADMIN, postulacion_id: null, estudiante_id: 'e1', grupo_id: null, estado: AsignacionTemaEstado.VIGENTE, motivo: 'Acta de conformación 12' });
    expect(s.tema.estado).toBe(EstadoTema.ASIGNADO);
    expect(s.saved.historial).toHaveLength(1);
    expect(s.saved.candidatos).toEqual([expect.objectContaining({ docente_id: 'd1', prioridad: 1, registrado_por_id: 'admin-id' })]);
    expect(s.saved.tutores[0]).toMatchObject({ docente_id: 'd1', candidato_tutor_id: s.saved.candidatos[0]!.id, tutor_propuesto_id: null, tipo: AsignacionTutorTipo.CANDIDATO_CONFIRMADO, estado: AsignacionTutorEstado.VIGENTE });
    expect(s.acciones()).toEqual(['ASIGNAR_TEMA', 'CONFORMAR_EQUIPO', 'ASIGNAR_TUTOR']);
    expect(s.notificaciones.tutor).toHaveBeenCalledWith(expect.anything(), s.saved.tutores[0]!.id, NotificacionTipo.TUTOR_ASIGNADO, 'admin-id');
    expect(s.notificaciones.asignacionTema).toHaveBeenCalledWith(expect.anything(), s.saved.asignaciones[0]!.id, NotificacionTipo.TEMA_ASIGNADO, 'admin-id');
    expect(s.asignaciones.rechazarAbiertasDeOtrosPeriodos).toHaveBeenCalledWith(expect.anything(), 'tema-id', 'periodo-id', 'Acta de conformación 12', s.actor, '127.0.0.1');
    expect(result).toEqual({ equipo: { id: s.saved.asignaciones[0]!.id }, advertencias: [] });
  });

  it('conforma un grupo con el primero como representante y registra los candidatos en orden sin tutor vigente', async () => {
    const s = setup({ tipoTema: TipoTema.GRUPO });
    const result = await s.service.crear('periodo-id', dto(['e2', 'e1', 'e3'], ['d3', 'd1', 'd2']), s.actor as never, null);

    expect(s.saved.grupos[0]).toMatchObject({ estado: GrupoEstado.ACTIVO, nombre: 'Equipo — Plataforma de seguimiento' });
    expect(s.saved.integrantes.map((item) => [(item.estudiante as { id: string }).id, item.rol_en_grupo])).toEqual([
      ['e2', GrupoIntegranteRol.REPRESENTANTE], ['e1', GrupoIntegranteRol.INTEGRANTE], ['e3', GrupoIntegranteRol.INTEGRANTE],
    ]);
    expect(s.saved.asignaciones[0]).toMatchObject({ grupo_id: s.saved.grupos[0]!.id, estudiante_id: null, origen: AsignacionTemaOrigen.ADMIN });
    expect(s.saved.candidatos.map((item) => [item.docente_id, item.prioridad])).toEqual([['d3', 1], ['d1', 2], ['d2', 3]]);
    expect(s.saved.tutores).toHaveLength(0);
    expect(s.cargaTutorial.evaluarCargaProyectada).not.toHaveBeenCalled();
    expect(s.notificaciones.tutor).not.toHaveBeenCalled();
    expect(s.acciones()).toEqual(['CREAR_GRUPO', 'INCORPORAR_INTEGRANTE_GRUPO', 'INCORPORAR_INTEGRANTE_GRUPO', 'INCORPORAR_INTEGRANTE_GRUPO', 'ASIGNAR_TEMA', 'CONFORMAR_EQUIPO']);
    expect(result.advertencias).toEqual(['Loor Luis ya alcanzó su límite de carga (2/2).']);
  });

  it('usa el nombre de grupo indicado', async () => {
    const s = setup({ tipoTema: TipoTema.PAREJA });
    await s.service.crear('periodo-id', dto(['e1', 'e2'], ['d1', 'd2'], { nombre_grupo: '  Equipo Alfa ' }), s.actor as never, null);
    expect(s.saved.grupos[0]).toMatchObject({ nombre: 'Equipo Alfa' });
  });

  it.each([
    ['no existe el período', { periodo: null }, NotFoundException],
    ['el período está en BORRADOR', { periodo: PeriodoEstado.BORRADOR }, ConflictException],
    ['el período está ARCHIVADO', { periodo: PeriodoEstado.ARCHIVADO }, ConflictException],
    ['el tema está RESERVADO', { estadoTema: EstadoTema.RESERVADO }, ConflictException],
    ['el tema ya está ASIGNADO', { estadoTema: EstadoTema.ASIGNADO }, ConflictException],
  ] as const)('rechaza sin escribir cuando %s', async (_caso, opciones, error) => {
    const s = setup(opciones as Opciones);
    await expect(s.service.crear('periodo-id', dto(['e1'], ['d1']), s.actor as never, null)).rejects.toBeInstanceOf(error);
    expect(s.saved.asignaciones).toHaveLength(0);
    expect(s.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('rechaza una composición que no corresponde al tipo del tema', async () => {
    const s = setup({ tipoTema: TipoTema.INDIVIDUAL });
    await expect(s.service.crear('periodo-id', dto(['e1', 'e2'], ['d1']), s.actor as never, null)).rejects.toThrow('El tema INDIVIDUAL admite 1 integrante(s); la solicitud tiene 2.');
    expect(s.saved.asignaciones).toHaveLength(0);
  });

  it('rechaza un tema con postulaciones abiertas en el período', async () => {
    const s = setup();
    s.query.mockImplementation(async (sql?: unknown) => (String(sql).includes('"postulacion"') ? [{ '?column?': 1 }] : []));
    await expect(s.service.crear('periodo-id', dto(['e1'], ['d1']), s.actor as never, null)).rejects.toThrow('El tema tiene postulaciones abiertas en este período');
  });

  it('rechaza a un estudiante que ya pertenece a un grupo activo, nombrándolo', async () => {
    const s = setup({ tipoTema: TipoTema.PAREJA, enGrupoActivo: ['e2'] });
    await expect(s.service.crear('periodo-id', dto(['e1', 'e2'], ['d1']), s.actor as never, null)).rejects.toThrow('Briones Ana ya pertenece a un grupo activo en este período.');
    expect(s.saved.grupos).toHaveLength(0);
  });

  it('rechaza a estudiantes con asignación vigente, postulación activa, otra carrera o sin habilitación elegible', async () => {
    const vigente = setup();
    vigente.asignaciones.tieneVigenteParaEstudiante.mockResolvedValue(true);
    await expect(vigente.service.crear('periodo-id', dto(['e1'], ['d1']), vigente.actor as never, null)).rejects.toThrow('ya tiene una asignación de tema vigente');
    const postulacion = setup();
    postulacion.postulaciones.estudianteTienePostulacionIndividualActiva.mockResolvedValue(true);
    await expect(postulacion.service.crear('periodo-id', dto(['e1'], ['d1']), postulacion.actor as never, null)).rejects.toThrow('tiene una postulación activa en este período');
    const carrera = setup();
    carrera.tema.carrera_id = 'otra-carrera';
    await expect(carrera.service.crear('periodo-id', dto(['e1'], ['d1']), carrera.actor as never, null)).rejects.toThrow('no pertenece a la carrera del tema');
    const habilitacion = setup();
    habilitacion.habilitados.getEligibleStudentForGroup.mockRejectedValue(new ForbiddenException('El estudiante no está habilitado en este período.'));
    await expect(habilitacion.service.crear('periodo-id', dto(['e1'], ['d1']), habilitacion.actor as never, null)).rejects.toThrow(new ConflictException('Zambrano Ana: El estudiante no está habilitado en este período.'));
  });

  it('bloquea con el límite de carga en modo bloquear y advierte en modo advertir', async () => {
    const bloqueo = setup({ cargaExcedida: { bloquear: true } });
    await expect(bloqueo.service.crear('periodo-id', dto(['e1'], ['d1']), bloqueo.actor as never, null)).rejects.toThrow('superaría el máximo de carga configurado (5)');
    expect(bloqueo.saved.asignaciones).toHaveLength(0);
    const aviso = setup({ cargaExcedida: { bloquear: false } });
    const result = await aviso.service.crear('periodo-id', dto(['e1'], ['d1']), aviso.actor as never, null);
    expect(result.advertencias).toEqual(['La carga proyectada (6) supera el máximo configurado (5).']);
    expect(aviso.saved.tutores).toHaveLength(1);
  });
});

describe('EquiposService.asignarTutorDesdeCandidatos', () => {
  it('confirma un candidato como tutor vigente', async () => {
    const s = setup({ asignacionExistente: {} });
    await s.service.asignarTutorDesdeCandidatos('periodo-id', 'asig-1', { candidato_id: 'cand-2' }, s.actor as never, null);
    expect(s.saved.tutores).toEqual([expect.objectContaining({ docente_id: 'd2', candidato_tutor_id: 'cand-2', tipo: AsignacionTutorTipo.CANDIDATO_CONFIRMADO, estado: AsignacionTutorEstado.VIGENTE })]);
    expect(s.acciones()).toEqual(['ASIGNAR_TUTOR']);
    expect(s.consulta.detalle).toHaveBeenCalledWith('periodo-id', 'asig-1');
  });

  it('reemplaza al tutor vigente solo con motivo y conserva el anterior como REEMPLAZADA', async () => {
    const sinMotivo = setup({ asignacionExistente: {}, tutorVigente: {} });
    await expect(sinMotivo.service.asignarTutorDesdeCandidatos('periodo-id', 'asig-1', { candidato_id: 'cand-2' }, sinMotivo.actor as never, null)).rejects.toThrow('indica un motivo para reemplazarlo');
    const s = setup({ asignacionExistente: {}, tutorVigente: {} });
    await s.service.asignarTutorDesdeCandidatos('periodo-id', 'asig-1', { candidato_id: 'cand-2', motivo: ' Elegido en el PAT ' }, s.actor as never, null);
    expect(s.saved.tutores[0]).toMatchObject({ id: 'tutor-viejo', estado: AsignacionTutorEstado.REEMPLAZADA, motivo_cambio: 'Elegido en el PAT' });
    expect(s.saved.tutores[1]).toMatchObject({ docente_id: 'd2', estado: AsignacionTutorEstado.VIGENTE });
    expect(s.acciones()).toEqual(['REEMPLAZAR_TUTOR']);
    expect(s.notificaciones.tutor).toHaveBeenCalledWith(expect.anything(), s.saved.tutores[1]!.id, NotificacionTipo.TUTOR_REEMPLAZADO, 'admin-id');
  });

  it('rechaza equipos de postulación, asignaciones anuladas, candidatos ajenos y el mismo tutor', async () => {
    const postulacion = setup({ asignacionExistente: { origen: AsignacionTemaOrigen.POSTULACION } });
    await expect(postulacion.service.asignarTutorDesdeCandidatos('periodo-id', 'asig-1', { candidato_id: 'cand-2' }, postulacion.actor as never, null)).rejects.toThrow('Solo los equipos conformados por ADMIN');
    const anulada = setup({ asignacionExistente: { estado: AsignacionTemaEstado.ANULADA } });
    await expect(anulada.service.asignarTutorDesdeCandidatos('periodo-id', 'asig-1', { candidato_id: 'cand-2' }, anulada.actor as never, null)).rejects.toBeInstanceOf(ConflictException);
    const ajeno = setup({ asignacionExistente: {} });
    await expect(ajeno.service.asignarTutorDesdeCandidatos('periodo-id', 'asig-1', { candidato_id: 'cand-de-otro' }, ajeno.actor as never, null)).rejects.toBeInstanceOf(NotFoundException);
    const mismo = setup({ asignacionExistente: {}, tutorVigente: { docente_id: 'd2' } });
    await expect(mismo.service.asignarTutorDesdeCandidatos('periodo-id', 'asig-1', { candidato_id: 'cand-2', motivo: 'x' }, mismo.actor as never, null)).rejects.toThrow('ya es el tutor vigente');
    for (const s of [postulacion, anulada, ajeno, mismo]) expect(s.saved.tutores).toHaveLength(0);
  });

  it('no admite asignar tutores con el período en BORRADOR', async () => {
    const s = setup({ periodo: PeriodoEstado.BORRADOR, asignacionExistente: {} });
    await expect(s.service.asignarTutorDesdeCandidatos('periodo-id', 'asig-1', { candidato_id: 'cand-2' }, s.actor as never, null)).rejects.toThrow('POSTULACION_CERRADA o EN_CURSO');
  });
});
