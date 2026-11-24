import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager, In, QueryFailedError } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AsignacionTemaPersistenciaService } from '../asignaciones-tema/asignacion-tema-persistencia.service.js';
import { AsignacionTema } from '../asignaciones-tema/entities/asignacion-tema.entity.js';
import { AsignacionTemaEstado } from '../asignaciones-tema/enums/asignacion-tema-estado.enum.js';
import { AsignacionTemaOrigen } from '../asignaciones-tema/enums/asignacion-tema-origen.enum.js';
import { AsignacionTutor } from '../asignaciones-tutor/entities/asignacion-tutor.entity.js';
import { AsignacionTutorEstado } from '../asignaciones-tutor/enums/asignacion-tutor-estado.enum.js';
import { AsignacionTutorTipo } from '../asignaciones-tutor/enums/asignacion-tutor-tipo.enum.js';
import { CargaTutorialPersistenciaService, type EvaluacionCargaTutorial } from '../carga-tutorial/carga-tutorial-persistencia.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { Grupo } from '../grupos/entities/grupo.entity.js';
import { GrupoIntegrante } from '../grupos/entities/grupo-integrante.entity.js';
import { GrupoEstado } from '../grupos/enums/grupo-estado.enum.js';
import { GrupoIntegranteEstado } from '../grupos/enums/grupo-integrante-estado.enum.js';
import { GrupoIntegranteRol } from '../grupos/enums/grupo-integrante-rol.enum.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { HabilitadosService } from '../habilitados/habilitados.service.js';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PostulacionPersistenciaService } from '../postulaciones/postulacion-persistencia.service.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { admiteIntegrantes, mensajeRangoIntegrantes } from '../temas/integrantes-tema.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { AsignarTutorCandidatoDto } from './dto/asignar-tutor-candidato.dto.js';
import { CrearEquipoDto } from './dto/crear-equipo.dto.js';
import { ResultadoEquipoResponseDto } from './dto/equipo-response.dto.js';
import { CandidatoTutor } from './entities/candidato-tutor.entity.js';
import { EquiposConsultaService } from './equipos-consulta.service.js';
import { ESTADOS_PERIODO_EQUIPOS, nombreGrupoPorDefecto, nombrePersona, periodoAdmiteEquipos, situacionAdmiteAsignacion } from './reglas-equipo.js';

interface DriverError { code?: string }

/**
 * Conformación administrativa de equipos (diseño 2026-11-23, pieza A): ADMIN crea un grupo o un
 * trabajo individual, le asigna un tema sin postulación (origen ADMIN), registra candidatos a
 * tutor en orden y, con un único candidato, deja el tutor vigente en la misma transacción.
 * Las reglas también las respaldan los disparadores de la migración `20261123120000`.
 */
@Injectable()
export class EquiposService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly habilitados: HabilitadosService,
    private readonly postulaciones: PostulacionPersistenciaService,
    private readonly asignaciones: AsignacionTemaPersistenciaService,
    private readonly cargaTutorial: CargaTutorialPersistenciaService,
    private readonly auditoria: AuditoriaService,
    private readonly notificaciones: NotificacionesPersistenciaService,
    private readonly consulta: EquiposConsultaService,
  ) {}

  async crear(periodoId: string, dto: CrearEquipoDto, actor: Usuario, ip: string | null): Promise<ResultadoEquipoResponseDto> {
    try {
      const resultado = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
        const periodo = await this.bloquearPeriodoOperable(manager, periodoId);
        const tema = await this.bloquearTemaDisponible(manager, dto.tema_id);
        const cantidad = dto.estudiante_ids.length;
        if (!admiteIntegrantes(tema.tipo, cantidad, periodo.max_integrantes_default)) throw new ConflictException(mensajeRangoIntegrantes(tema.tipo, cantidad, periodo.max_integrantes_default));
        await this.rechazarSiHayPostulacionesAbiertas(manager, periodoId, tema.id);
        const estudiantes = await this.validarEstudiantes(manager, periodo, tema, dto.estudiante_ids);
        const docentes = await this.bloquearDocentesElegibles(manager, dto.docente_ids);
        const unico = docentes.length === 1 ? docentes[0]! : null;
        const carga = unico ? await this.evaluarCarga(manager, periodoId, unico) : null;
        const advertencias = carga?.advertencia ? [carga.advertencia] : await this.advertenciasCandidatos(manager, periodoId, docentes);
        const motivo = dto.motivo.trim();

        const grupo = cantidad > 1 ? await this.crearGrupo(manager, periodo, estudiantes, dto.nombre_grupo?.trim() || nombreGrupoPorDefecto(tema.titulo), actor, ip) : null;
        const ahora = new Date();
        const repo = manager.getRepository(AsignacionTema);
        const asignacion = await repo.save(repo.create({
          tema_id: tema.id, tema, periodo_id: periodoId, postulacion_id: null, postulacion: null, origen: AsignacionTemaOrigen.ADMIN,
          grupo_id: grupo?.id ?? null, grupo, estudiante_id: grupo ? null : estudiantes[0]!.id, estudiante: grupo ? null : estudiantes[0]!,
          aprobada_por_id: actor.id, aprobada_por: actor, estado: AsignacionTemaEstado.VIGENTE, fecha_asignacion: ahora, motivo,
          causa_anulacion: null, motivo_anulacion: null, anulada_por_id: null, anulada_por: null, fecha_anulacion: null,
        }));
        await this.marcarTemaAsignado(manager, tema, actor, ip, ahora);
        const candidatos = await this.registrarCandidatos(manager, asignacion.id, docentes, actor);
        await this.auditoria.registrar(manager, {
          actor, accion: 'CONFORMAR_EQUIPO', entidad_tipo: 'asignacion_tema', entidad_id: asignacion.id, valores_anteriores: null,
          valores_nuevos: {
            periodo_id: periodoId, tema_id: tema.id, origen: AsignacionTemaOrigen.ADMIN, grupo_id: grupo?.id ?? null, estudiante_id: asignacion.estudiante_id,
            participantes: estudiantes.map((item) => item.id), candidatos: candidatos.map((item) => ({ id: item.id, docente_id: item.docente_id, prioridad: item.prioridad })),
            aprobada_por_id: actor.id, estado: asignacion.estado, fecha_asignacion: ahora, motivo,
          },
          ip_origen: ip,
        });
        if (unico && carga) await this.crearTutorVigente(manager, asignacion, candidatos[0]!, unico, carga, actor, ip, null);
        await this.notificaciones.asignacionTema(manager, asignacion.id, NotificacionTipo.TEMA_ASIGNADO, actor.id);
        await this.asignaciones.rechazarAbiertasDeOtrosPeriodos(manager, tema.id, periodoId, motivo, actor, ip);
        return { id: asignacion.id, advertencias };
      });
      return { equipo: await this.consulta.detalle(periodoId, resultado.id), advertencias: resultado.advertencias };
    } catch (error: unknown) { this.manejarError(error); }
  }

  /**
   * Deja como tutor vigente a uno de los candidatos del equipo (confirmación manual o, más
   * adelante, la del Word del PAT). Si ya hay tutor vigente lo reemplaza y exige motivo.
   */
  async asignarTutorDesdeCandidatos(periodoId: string, asignacionId: string, dto: AsignarTutorCandidatoDto, actor: Usuario, ip: string | null): Promise<ResultadoEquipoResponseDto> {
    try {
      const advertencias = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
        await this.bloquearPeriodoOperable(manager, periodoId);
        const repo = manager.getRepository(AsignacionTema);
        const asignacion = await repo.findOne({ where: { id: asignacionId, periodo_id: periodoId }, lock: { mode: 'pessimistic_write' } });
        if (!asignacion) throw new NotFoundException('No existe ese equipo en el período indicado.');
        if (asignacion.origen !== AsignacionTemaOrigen.ADMIN) throw new ConflictException('Solo los equipos conformados por ADMIN tienen candidatos a tutor; usa la asignación de tutor de la asignación.');
        if (asignacion.estado !== AsignacionTemaEstado.VIGENTE) throw new ConflictException('El equipo no tiene una asignación de tema VIGENTE.');
        const candidato = await manager.getRepository(CandidatoTutor).findOneBy({ id: dto.candidato_id, asignacion_tema_id: asignacion.id });
        if (!candidato) throw new NotFoundException('El candidato no pertenece a este equipo.');
        const tutorRepo = manager.getRepository(AsignacionTutor);
        const vigente = await tutorRepo.findOne({ where: { asignacion_tema_id: asignacion.id, estado: AsignacionTutorEstado.VIGENTE }, lock: { mode: 'pessimistic_write' } });
        if (vigente?.docente_id === candidato.docente_id) throw new ConflictException('Ese candidato ya es el tutor vigente del equipo.');
        const motivo = dto.motivo?.trim() ?? '';
        if (vigente && !motivo) throw new ConflictException('El equipo ya tiene tutor vigente; indica un motivo para reemplazarlo.');
        const [docente] = await this.bloquearDocentesElegibles(manager, [candidato.docente_id]);
        const carga = await this.evaluarCarga(manager, periodoId, docente!);
        await this.crearTutorVigente(manager, asignacion, candidato, docente!, carga, actor, ip, vigente ? { anterior: vigente, motivo } : null);
        return carga.advertencia ? [carga.advertencia] : [];
      });
      return { equipo: await this.consulta.detalle(periodoId, asignacionId), advertencias };
    } catch (error: unknown) { this.manejarError(error); }
  }

  private async bloquearPeriodoOperable(manager: EntityManager, periodoId: string): Promise<PeriodoTitulacion> {
    const periodo = await manager.getRepository(PeriodoTitulacion).findOne({ where: { id: periodoId }, lock: { mode: 'pessimistic_write' } });
    if (!periodo) throw new NotFoundException('No existe el período indicado.');
    if (!periodoAdmiteEquipos(periodo.estado)) throw new ConflictException(`Los equipos se conforman y sus tutores se asignan con el período en ${ESTADOS_PERIODO_EQUIPOS.join(' o ')}.`);
    return periodo;
  }

  private async bloquearTemaDisponible(manager: EntityManager, temaId: string): Promise<Tema> {
    const repo = manager.getRepository(Tema);
    const bloqueado = await repo.findOne({ where: { id: temaId }, lock: { mode: 'pessimistic_write' } });
    if (!bloqueado) throw new NotFoundException('No existe el tema indicado.');
    const tema = await repo.findOne({ where: { id: temaId }, relations: { linea: true, docente_proponente: true } });
    if (!tema) throw new NotFoundException('No existe el tema indicado.');
    if (tema.estado !== EstadoTema.PUBLICADO) throw new ConflictException('El tema no está disponible: debe estar PUBLICADO (no reservado, asignado, cerrado ni retirado).');
    if (await manager.getRepository(AsignacionTema).exist({ where: { tema_id: tema.id, estado: AsignacionTemaEstado.VIGENTE } })) throw new ConflictException('El tema ya tiene una asignación vigente.');
    return tema;
  }

  private async rechazarSiHayPostulacionesAbiertas(manager: EntityManager, periodoId: string, temaId: string): Promise<void> {
    const filas = await manager.query(`SELECT 1 FROM ${this.schema(manager)}."postulacion" WHERE "periodo_id"=$1 AND "tema_id"=$2 AND "estado" IN ('PENDIENTE_CONFIRMACION','PENDIENTE','EN_CONFLICTO','ACEPTADA') LIMIT 1`, [periodoId, temaId]) as unknown[];
    if (filas.length) throw new ConflictException('El tema tiene postulaciones abiertas en este período; resuélvelas antes de conformar el equipo.');
  }

  /**
   * Valida a cada estudiante bajo el mismo bloqueo consultivo que usa el disparador de
   * asignaciones (orden por id). Devuelve los estudiantes en el orden recibido (el primero es el
   * representante del grupo).
   */
  private async validarEstudiantes(manager: EntityManager, periodo: PeriodoTitulacion, tema: Tema, ids: string[]): Promise<Estudiante[]> {
    const encontrados = await manager.getRepository(Estudiante).find({ where: { id: In(ids) }, relations: { usuario: true } });
    const porId = new Map(encontrados.map((item) => [item.id, item]));
    const faltante = ids.find((id) => !porId.has(id));
    if (faltante) throw new NotFoundException('Uno de los estudiantes seleccionados no existe.');
    const ahora = new Date();
    for (const id of [...ids].sort((a, b) => a.localeCompare(b))) {
      const estudiante = porId.get(id)!;
      const nombre = nombrePersona(estudiante.usuario);
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 7319))', [id]);
      try {
        await this.habilitados.getEligibleStudentForGroup(periodo.id, id, manager);
      } catch (error: unknown) {
        if (error instanceof ForbiddenException) throw new ConflictException(`${nombre}: ${error.message}`);
        throw error;
      }
      const habilitacion = await manager.getRepository(EstudianteHabilitado).findOne({ where: { periodo: { id: periodo.id }, estudiante: { id } } });
      if (!habilitacion || !situacionAdmiteAsignacion(habilitacion.situacion_ingreso, ahora, periodo.fecha_inicio_titulacion)) throw new ConflictException(`${nombre}: los condicionados solo pueden recibir asignación antes del inicio de titulación.`);
      if (estudiante.carrera_id !== tema.carrera_id) throw new ConflictException(`${nombre} no pertenece a la carrera del tema.`);
      if (await manager.getRepository(GrupoIntegrante).exist({ where: { periodo: { id: periodo.id }, estudiante: { id }, estado: GrupoIntegranteEstado.ACTIVO } })) throw new ConflictException(`${nombre} ya pertenece a un grupo activo en este período.`);
      if (await this.asignaciones.tieneVigenteParaEstudiante(manager, id)) throw new ConflictException(`${nombre} ya tiene una asignación de tema vigente.`);
      if (await this.postulaciones.estudianteTienePostulacionIndividualActiva(manager, periodo.id, id)) throw new ConflictException(`${nombre} tiene una postulación activa en este período.`);
    }
    return ids.map((id) => porId.get(id)!);
  }

  /** Bloqueo exclusivo (antes que el compartido del disparador de candidatos) en orden de id. */
  private async bloquearDocentesElegibles(manager: EntityManager, ids: string[]): Promise<Docente[]> {
    const bloqueados = new Map<string, Docente>();
    for (const id of [...ids].sort((a, b) => a.localeCompare(b))) {
      const docente = await manager.getRepository(Docente).createQueryBuilder('docente')
        .innerJoinAndSelect('docente.usuario', 'usuario')
        .where('docente.id = :id', { id })
        .setLock('pessimistic_write', undefined, ['docente', 'usuario'])
        .getOne();
      if (!docente) throw new NotFoundException('Uno de los docentes seleccionados no existe.');
      if (!docente.habilitado_tutoria || docente.usuario.estado !== UsuarioEstado.ACTIVO || docente.usuario.rol !== UsuarioRol.DOCENTE) {
        throw new ConflictException(`${nombrePersona(docente.usuario)} debe tener cuenta activa, rol DOCENTE y habilitación para tutoría.`);
      }
      bloqueados.set(id, docente);
    }
    return ids.map((id) => bloqueados.get(id)!);
  }

  private async evaluarCarga(manager: EntityManager, periodoId: string, docente: Docente): Promise<EvaluacionCargaTutorial> {
    const carga = await this.cargaTutorial.evaluarCargaProyectada(manager, periodoId, docente.id);
    if (carga.excede_limite && carga.configuracion.bloquear_al_superar) {
      throw new ConflictException(`${nombrePersona(docente.usuario)} superaría el máximo de carga configurado (${carga.configuracion.max_trabajos}).`);
    }
    return carga;
  }

  /** Con varios candidatos ninguno queda asignado todavía: solo se avisa de quienes ya están en su límite. */
  private async advertenciasCandidatos(manager: EntityManager, periodoId: string, docentes: Docente[]): Promise<string[]> {
    const resumen = await this.cargaTutorial.resumirCargaDocentes(manager, periodoId, docentes.map((item) => item.id));
    return docentes.flatMap((docente) => {
      const carga = resumen.get(docente.id);
      const limite = carga?.configuracion?.max_trabajos;
      if (limite === undefined) return [`${nombrePersona(docente.usuario)} no tiene límite de carga configurado; configúralo antes de confirmarlo como tutor.`];
      return carga!.actual + 1 > limite ? [`${nombrePersona(docente.usuario)} ya alcanzó su límite de carga (${carga!.actual}/${limite}).`] : [];
    });
  }

  private async crearGrupo(manager: EntityManager, periodo: PeriodoTitulacion, estudiantes: Estudiante[], nombre: string, actor: Usuario, ip: string | null): Promise<Grupo> {
    const grupoRepo = manager.getRepository(Grupo);
    // Los disparadores de integridad del grupo son diferidos: grupo ACTIVO e integrantes en la misma transacción.
    const grupo = await grupoRepo.save(grupoRepo.create({ periodo, nombre, estado: GrupoEstado.ACTIVO }));
    await this.auditoria.registrar(manager, { actor, accion: 'CREAR_GRUPO', entidad_tipo: 'grupo', entidad_id: grupo.id, valores_anteriores: null, valores_nuevos: { periodo_id: periodo.id, nombre, estado: grupo.estado, representante_id: estudiantes[0]!.id, origen: AsignacionTemaOrigen.ADMIN }, ip_origen: ip });
    const integranteRepo = manager.getRepository(GrupoIntegrante);
    for (const [indice, estudiante] of estudiantes.entries()) {
      const rol = indice === 0 ? GrupoIntegranteRol.REPRESENTANTE : GrupoIntegranteRol.INTEGRANTE;
      const integrante = await integranteRepo.save(integranteRepo.create({ grupo, periodo, estudiante, rol_en_grupo: rol, estado: GrupoIntegranteEstado.ACTIVO, fecha_ingreso: new Date(), fecha_salida: null, motivo_salida: null }));
      await this.auditoria.registrar(manager, { actor, accion: 'INCORPORAR_INTEGRANTE_GRUPO', entidad_tipo: 'grupo_integrante', entidad_id: integrante.id, valores_anteriores: null, valores_nuevos: { grupo_id: grupo.id, periodo_id: periodo.id, estudiante_id: estudiante.id, rol_en_grupo: rol, estado: integrante.estado, origen: AsignacionTemaOrigen.ADMIN }, ip_origen: ip });
    }
    return grupo;
  }

  private async marcarTemaAsignado(manager: EntityManager, tema: Tema, actor: Usuario, ip: string | null, fecha: Date): Promise<void> {
    const antes = this.valoresTema(tema);
    tema.estado = EstadoTema.ASIGNADO;
    await manager.getRepository(Tema).save(tema);
    const despues = this.valoresTema(tema);
    const historial = manager.getRepository(TemaHistorial);
    await historial.save(historial.create({ tema, usuario: actor, estado_anterior: EstadoTema.PUBLICADO, estado_nuevo: EstadoTema.ASIGNADO, cambios: { anteriores: antes, nuevos: despues, origen: AsignacionTemaOrigen.ADMIN }, fecha }));
    await this.auditoria.registrar(manager, { actor, accion: 'ASIGNAR_TEMA', entidad_tipo: 'tema', entidad_id: tema.id, valores_anteriores: antes, valores_nuevos: despues, ip_origen: ip });
  }

  private async registrarCandidatos(manager: EntityManager, asignacionId: string, docentes: Docente[], actor: Usuario): Promise<CandidatoTutor[]> {
    const repo = manager.getRepository(CandidatoTutor);
    const candidatos: CandidatoTutor[] = [];
    for (const [indice, docente] of docentes.entries()) {
      candidatos.push(await repo.save(repo.create({ asignacion_tema_id: asignacionId, docente_id: docente.id, prioridad: indice + 1, registrado_por_id: actor.id })));
    }
    return candidatos;
  }

  private async crearTutorVigente(
    manager: EntityManager, asignacion: AsignacionTema, candidato: CandidatoTutor, docente: Docente, carga: EvaluacionCargaTutorial,
    actor: Usuario, ip: string | null, reemplazo: { anterior: AsignacionTutor; motivo: string } | null,
  ): Promise<void> {
    const repo = manager.getRepository(AsignacionTutor);
    const ahora = new Date();
    if (reemplazo) {
      reemplazo.anterior.estado = AsignacionTutorEstado.REEMPLAZADA;
      reemplazo.anterior.fecha_fin = ahora;
      reemplazo.anterior.motivo_cambio = reemplazo.motivo;
      await repo.save(reemplazo.anterior);
    }
    const tutor = await repo.save(repo.create({
      asignacion_tema_id: asignacion.id, docente_id: docente.id, tutor_propuesto_id: null, tutor_propuesto: null, candidato_tutor_id: candidato.id,
      tipo: AsignacionTutorTipo.CANDIDATO_CONFIRMADO, estado: AsignacionTutorEstado.VIGENTE, asignada_por_id: actor.id, asignada_por: actor,
      fecha_asignacion: ahora, fecha_fin: null, motivo_cambio: null,
    }));
    const valores = {
      periodo_id: asignacion.periodo_id, asignacion_tema_id: asignacion.id, docente_id: docente.id, candidato_tutor_id: candidato.id, prioridad_candidato: candidato.prioridad,
      tipo: tutor.tipo, estado: tutor.estado, asignada_por_id: actor.id, fecha_asignacion: ahora,
      carga: { actual: carga.actual, proyectada: carga.proyectada, origen: carga.origen, configuracion_id: carga.configuracion.id, max_trabajos: carga.configuracion.max_trabajos, bloquear_al_superar: carga.configuracion.bloquear_al_superar },
    };
    await this.auditoria.registrar(manager, {
      actor, accion: reemplazo ? 'REEMPLAZAR_TUTOR' : 'ASIGNAR_TUTOR', entidad_tipo: 'asignacion_tutor', entidad_id: tutor.id,
      valores_anteriores: reemplazo ? { asignacion_tutor_id: reemplazo.anterior.id, docente_id: reemplazo.anterior.docente_id, tipo: reemplazo.anterior.tipo, estado: AsignacionTutorEstado.VIGENTE } : null,
      valores_nuevos: reemplazo ? { ...valores, reemplaza_asignacion_tutor_id: reemplazo.anterior.id, motivo: reemplazo.motivo } : valores,
      ip_origen: ip,
    });
    await this.notificaciones.tutor(manager, tutor.id, reemplazo ? NotificacionTipo.TUTOR_REEMPLAZADO : NotificacionTipo.TUTOR_ASIGNADO, actor.id);
  }

  private valoresTema(tema: Tema): Record<string, unknown> {
    return { tema_id: tema.id, carrera_id: tema.carrera_id, estado: tema.estado, titulo: tema.titulo, linea_id: tema.linea.id, docente_proponente_id: tema.docente_proponente.id, tipo: tema.tipo };
  }

  private schema(manager: EntityManager): string {
    const value = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
    return `"${value}"`;
  }

  private manejarError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof QueryFailedError) {
      const code = (error.driverError as DriverError).code;
      if (code === '23505') throw new ConflictException('Un participante, el tema o un candidato ya tiene una asignación o registro incompatible.');
      if (code === '23503' || code === '23514') throw new ConflictException('El equipo incumple una regla de integridad (período, tema, composición, tutoría o carga).');
      if (code === '40001' || code === '40P01') throw new ConflictException('La operación coincidió con otro cambio simultáneo. Vuelve a intentarlo.');
    }
    throw new ServiceUnavailableException('No se pudo completar la operación de equipos en PostgreSQL.', { cause: error });
  }
}
