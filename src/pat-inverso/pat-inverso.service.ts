import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { EstudianteDatosPat } from '../generaciones-pat/entities/estudiante-datos-pat.entity.js';
import { ContenidoPatEstudiante } from '../generaciones-pat/entities/contenido-pat.entity.js';
import { EquiposService } from '../equipos/equipos.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { parrafosDocxOficial } from './docx-seguro.js';
import { parsearPatOficial, type PatOficialExtraido } from './parsear-pat-oficial.js';
import { PreparacionPatInverso } from './entities/preparacion-pat-inverso.entity.js';
import { vistaPatInverso, type SistemaPatInverso, type VistaPatInverso } from './vista-pat-inverso.js';

const VIGENCIA_MS = 12 * 60 * 60 * 1000;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

@Injectable()
export class PatInversoService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PreparacionPatInverso) private readonly preparaciones: Repository<PreparacionPatInverso>,
    private readonly equipos: EquiposService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async preparar(periodoId: string, asignacionId: string, estudianteId: string, buffer: Buffer, mime: string, actor: Usuario, ip: string | null) {
    const sistema = await this.sistema(periodoId, asignacionId, estudianteId);
    const vista = vistaPatInverso(parsearPatOficial(parrafosDocxOficial(buffer, mime || DOCX_MIME)), sistema);
    const expira = new Date(Date.now() + VIGENCIA_MS);
    const preparacion = await this.preparaciones.save(this.preparaciones.create({
      periodo_id: periodoId, asignacion_tema_id: asignacionId, estudiante_id: estudianteId, creada_por_id: actor.id,
      estado: 'PENDIENTE', extraido: vista.extraido, expira_en: expira,
    }));
    await this.auditoria.registrar(this.dataSource.manager, {
      actor, accion: 'PREPARAR_PAT_INVERSO', entidad_tipo: 'preparacion_pat_inverso', entidad_id: preparacion.id,
      valores_anteriores: null, valores_nuevos: { asignacion_tema_id: asignacionId, estudiante_id: estudianteId, errores: vista.errores.length, diferencias: vista.diferencias.length }, ip_origen: ip,
    });
    return this.respuesta(preparacion.id, expira, vista);
  }

  async confirmar(periodoId: string, asignacionId: string, estudianteId: string, preparacionId: string, candidatoId: string | undefined, actor: Usuario, ip: string | null) {
    const preparacion = await this.preparaciones.findOneBy({ id: preparacionId, periodo_id: periodoId, asignacion_tema_id: asignacionId, estudiante_id: estudianteId });
    if (!preparacion) throw new NotFoundException('No existe esa vista previa del PAT.');
    if (preparacion.estado !== 'PENDIENTE') throw new ConflictException('Esa vista previa ya fue confirmada.');
    if (preparacion.expira_en.getTime() <= Date.now()) throw new GoneException('La vista previa venció; vuelve a cargar el Word.');
    const sistema = await this.sistema(periodoId, asignacionId, estudianteId);
    const vista = vistaPatInverso(preparacion.extraido as PatOficialExtraido, sistema);
    if (vista.errores.length) throw new ConflictException('La vista previa tiene errores; corrige el Word y vuelve a cargarlo.');
    const candidato = candidatoId ?? (vista.tutor.confianza === 'nula' ? null : vista.tutor.candidato_id);
    if (!candidato) throw new ConflictException('El tutor del Word no coincide con los candidatos del equipo. Elige uno para confirmar.');
    await this.dejarTutor(periodoId, asignacionId, candidato, actor, ip);
    await this.dataSource.transaction(async (manager) => {
      const bloqueada = await manager.getRepository(PreparacionPatInverso).findOne({ where: { id: preparacion.id }, lock: { mode: 'pessimistic_write' } });
      if (!bloqueada || bloqueada.estado !== 'PENDIENTE' || bloqueada.expira_en.getTime() <= Date.now()) throw new ConflictException('La vista previa ya no está disponible.');
      await this.guardarDatos(manager, estudianteId, vista.datos, actor, ip);
      await this.guardarContenido(manager, asignacionId, estudianteId, vista.contenido, actor, ip);
      bloqueada.estado = 'CONFIRMADA';
      await manager.getRepository(PreparacionPatInverso).save(bloqueada);
      await this.auditoria.registrar(manager, {
        actor, accion: 'CONFIRMAR_PAT_INVERSO', entidad_tipo: 'preparacion_pat_inverso', entidad_id: bloqueada.id,
        valores_anteriores: { estado: 'PENDIENTE' }, valores_nuevos: { estado: 'CONFIRMADA', candidato_id: candidato, estudiante_id: estudianteId }, ip_origen: ip,
      });
    });
    return { preparacion_id: preparacion.id, confirmada: true, candidato_id: candidato };
  }

  private respuesta(id: string, expira: Date, vista: VistaPatInverso) {
    return {
      preparacion_id: id, expira_en: expira, puede_confirmar: vista.errores.length === 0,
      extraido: vista.extraido, diferencias: vista.diferencias, errores: vista.errores, tutor: vista.tutor,
      integrantes_sin_coincidencia: vista.integrantes_sin_coincidencia,
    };
  }

  private async sistema(periodoId: string, asignacionId: string, estudianteId: string): Promise<SistemaPatInverso> {
    const s = this.schema();
    const filas = await this.dataSource.query(
      `SELECT a."origen"::text AS origen,a."estado"::text AS estado,a."estudiante_id" AS titular,a."grupo_id",
              u."nombres",u."apellidos",u."email",e."cedula",c."nombre" AS carrera,t."titulo"
       FROM ${s}."asignacion_tema" a
       JOIN ${s}."tema" t ON t."id"=a."tema_id"
       JOIN ${s}."estudiante" e ON e."id"=$3
       JOIN ${s}."usuario" u ON u."id"=e."usuario_id"
       JOIN ${s}."carrera" c ON c."id"=e."carrera_id"
       WHERE a."id"=$1 AND a."periodo_id"=$2`,
      [asignacionId, periodoId, estudianteId],
    ) as Array<Record<string, string | null>>;
    const fila = filas[0];
    if (!fila) throw new NotFoundException('No existe ese equipo o ese estudiante.');
    if (fila.origen !== 'ADMIN' || fila.estado !== 'VIGENTE') throw new ConflictException('El PAT inverso solo aplica a un equipo administrativo vigente.');
    const pertenece = fila.titular === estudianteId || (fila.grupo_id && (await this.dataSource.query(
      `SELECT 1 FROM ${s}."grupo_integrante" WHERE "grupo_id"=$1 AND "estudiante_id"=$2 AND "estado"='ACTIVO'`,
      [fila.grupo_id, estudianteId],
    ) as unknown[]).length);
    if (!pertenece) throw new NotFoundException('El estudiante no pertenece a ese equipo.');
    const integrantes = fila.grupo_id
      ? await this.dataSource.query(
        `SELECT e."id",u."nombres",u."apellidos" FROM ${s}."grupo_integrante" gi JOIN ${s}."estudiante" e ON e."id"=gi."estudiante_id" JOIN ${s}."usuario" u ON u."id"=e."usuario_id" WHERE gi."grupo_id"=$1 AND gi."estado"='ACTIVO'`,
        [fila.grupo_id],
      ) as Array<{ id: string; nombres: string; apellidos: string }>
      : [{ id: estudianteId, nombres: String(fila.nombres), apellidos: String(fila.apellidos) }];
    const candidatos = await this.dataSource.query(
      `SELECT ct."id",u."nombres",u."apellidos",ct."docente_id" FROM ${s}."candidato_tutor" ct JOIN ${s}."docente" d ON d."id"=ct."docente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id" WHERE ct."asignacion_tema_id"=$1 ORDER BY ct."prioridad"`,
      [asignacionId],
    ) as Array<{ id: string; nombres: string; apellidos: string; docente_id: string }>;
    return {
      cedula: String(fila.cedula ?? ''), nombres: String(fila.nombres ?? ''), apellidos: String(fila.apellidos ?? ''),
      carrera: String(fila.carrera ?? ''), titulo_tema: String(fila.titulo ?? ''), correo_institucional: String(fila.email ?? ''),
      modalidad: fila.grupo_id ? 'GRUPAL' : 'INDIVIDUAL', estudiante_id: estudianteId, integrantes, candidatos,
    };
  }

  private async dejarTutor(periodoId: string, asignacionId: string, candidatoId: string, actor: Usuario, ip: string | null): Promise<void> {
    const s = this.schema();
    const vigente = await this.dataSource.query(
      `SELECT "docente_id" FROM ${s}."asignacion_tutor" WHERE "asignacion_tema_id"=$1 AND "estado"='VIGENTE'`,
      [asignacionId],
    ) as Array<{ docente_id: string }>;
    const candidato = await this.dataSource.query(
      `SELECT "docente_id" FROM ${s}."candidato_tutor" WHERE "id"=$1 AND "asignacion_tema_id"=$2`,
      [candidatoId, asignacionId],
    ) as Array<{ docente_id: string }>;
    if (!candidato[0]) throw new NotFoundException('El candidato no pertenece a este equipo.');
    if (vigente[0]?.docente_id === candidato[0].docente_id) return;
    await this.equipos.asignarTutorDesdeCandidatos(periodoId, asignacionId, {
      candidato_id: candidatoId, motivo: vigente[0] ? 'Confirmado desde el PAT en Word' : undefined,
    }, actor, ip);
  }

  private async guardarDatos(manager: import('typeorm').EntityManager, estudianteId: string, datos: Record<string, unknown>, actor: Usuario, ip: string | null): Promise<void> {
    const repo = manager.getRepository(EstudianteDatosPat);
    const antes = await repo.findOneBy({ estudiante_id: estudianteId });
    const fusion = { ...antes?.datos };
    if (datos.tiene_discapacidad === false) {
      delete fusion.discapacidades; delete fusion.grado_discapacidad; delete fusion.otra_discapacidad;
    }
    await repo.save(repo.create({ estudiante_id: estudianteId, estudiante: { id: estudianteId } as never, datos: { ...fusion, ...datos }, actualizado_en: new Date() }));
    await this.auditoria.registrar(manager, {
      actor, accion: 'ACTUALIZAR_DATOS_PAT_ESTUDIANTE', entidad_tipo: 'estudiante_datos_pat', entidad_id: estudianteId,
      valores_anteriores: null, valores_nuevos: { origen: 'PAT_INVERSO', campos: Object.keys(datos) }, ip_origen: ip,
    });
  }

  private async guardarContenido(manager: import('typeorm').EntityManager, asignacionId: string, estudianteId: string, contenido: Record<string, unknown>, actor: Usuario, ip: string | null): Promise<void> {
    const repo = manager.getRepository(ContenidoPatEstudiante);
    const antes = await repo.findOneBy({ asignacion_tema_id: asignacionId, estudiante_id: estudianteId });
    const fusion = { ...antes?.contenido, ...contenido };
    const guardado = await repo.save(repo.create({
      ...(antes ? { id: antes.id } : {}), asignacion_tema_id: asignacionId, estudiante_id: estudianteId,
      asignacion_tema: { id: asignacionId } as never, estudiante: { id: estudianteId } as never, contenido: fusion, actualizado_en: new Date(),
    }));
    await this.auditoria.registrar(manager, {
      actor, accion: 'ACTUALIZAR_CONTENIDO_PAT', entidad_tipo: 'contenido_pat_estudiante', entidad_id: guardado.id,
      valores_anteriores: null, valores_nuevos: { origen: 'PAT_INVERSO', campos: Object.keys(contenido) }, ip_origen: ip,
    });
  }

  private schema(): string {
    const nombre = (this.dataSource.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(nombre)) throw new ConflictException('Esquema PostgreSQL inválido.');
    return `"${nombre}"`;
  }
}
