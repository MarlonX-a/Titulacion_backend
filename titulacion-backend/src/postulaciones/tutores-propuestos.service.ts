import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { Docente } from '../docentes/entities/docente.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { TemasService } from '../temas/temas.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { TutorPropuesto } from './entities/tutor-propuesto.entity.js';
import { Postulacion } from './entities/postulacion.entity.js';
import { TutorPropuestoResponseDto, PagedAvailableTutorsResponseDto } from './dto/tutores-propuestos.dto.js';

interface DriverError { code?: string; }

@Injectable()
export class TutoresPropuestosService {
  constructor(
    @InjectRepository(TutorPropuesto) private readonly repository: Repository<TutorPropuesto>,
    @InjectRepository(Docente) private readonly docentes: Repository<Docente>,
    private readonly dataSource: DataSource,
    private readonly temas: TemasService,
  ) {}

  async agregar(manager: EntityManager, postulacionId: string, docenteIds: string[]): Promise<void> {
    const orderedIds = [...docenteIds];
    const uniqueSortedIds = [...orderedIds].sort((a, b) => a.localeCompare(b));
    const teachers = await manager.getRepository(Docente).createQueryBuilder('d')
      .innerJoinAndSelect('d.usuario', 'u')
      .where('d.id IN (:...ids)', { ids: uniqueSortedIds })
      .orderBy('d.id', 'ASC')
      .setLock('pessimistic_write', undefined, ['d', 'u'])
      .getMany();
    if (teachers.length !== uniqueSortedIds.length) throw new ConflictException('Uno o más docentes propuestos no existen.');
    const byId = new Map(teachers.map((teacher) => [teacher.id, teacher]));
    for (const id of uniqueSortedIds) {
      const teacher = byId.get(id);
      if (!teacher || !teacher.habilitado_tutoria || teacher.usuario.estado !== UsuarioEstado.ACTIVO || teacher.usuario.rol !== UsuarioRol.DOCENTE) {
        throw new ConflictException('Todos los docentes propuestos deben tener cuenta activa y estar habilitados para tutoría.');
      }
    }
    const repo = manager.getRepository(TutorPropuesto);
    await repo.insert(orderedIds.map((id, index) => ({
      postulacion: { id: postulacionId }, docente: { id }, orden_prioridad: index + 1,
    })));
  }

  async disponibles(periodoId: string, temaId: string, actor: Usuario, query: PaginationQueryDto): Promise<PagedAvailableTutorsResponseDto> {
    try {
      const topic = await this.temas.getById(periodoId, temaId, actor);
      const qb = this.docentes.createQueryBuilder('d')
        .innerJoinAndSelect('d.usuario', 'u')
        .select(['d.id', 'd.titulo_academico', 'd.departamento', 'u.id', 'u.nombres', 'u.apellidos'])
        .where('d.habilitado_tutoria = true')
        .andWhere('u.estado = :active', { active: UsuarioEstado.ACTIVO })
        .andWhere('u.rol = :role', { role: UsuarioRol.DOCENTE })
        .addSelect('CASE WHEN d.id = :proponent THEN 0 ELSE 1 END', 'proponent_order')
        .orderBy('proponent_order', 'ASC')
        .addOrderBy('u.apellidos', 'ASC').addOrderBy('u.nombres', 'ASC').addOrderBy('d.id', 'ASC')
        .setParameter('proponent', topic.docente_proponente_id);
      const [records, total] = await qb.skip((query.page - 1) * query.limit).take(query.limit).getManyAndCount();
      return {
        data: records.map((teacher) => ({
          id: teacher.id, nombres: teacher.usuario.nombres, apellidos: teacher.usuario.apellidos,
          titulo_academico: teacher.titulo_academico, departamento: teacher.departamento,
          es_proponente_tema: teacher.id === topic.docente_proponente_id,
        })), total, page: query.page, limit: query.limit,
      };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async listar(postulacionId: string, tema: Tema, page: number, limit: number): Promise<{ data: TutorPropuestoResponseDto[]; total: number; page: number; limit: number }> {
    try {
      const [records, total] = await this.repository.findAndCount({
        where: { postulacion: { id: postulacionId } }, relations: { docente: { usuario: true } },
        order: { orden_prioridad: 'ASC', id: 'ASC' }, skip: (page - 1) * limit, take: limit,
      });
      return { data: records.map((record) => ({
        id: record.id, postulacion_id: postulacionId, docente_id: record.docente.id,
        orden_prioridad: record.orden_prioridad,
        docente: { id: record.docente.id, nombres: record.docente.usuario.nombres, apellidos: record.docente.usuario.apellidos, titulo_academico: record.docente.titulo_academico, departamento: record.docente.departamento },
        es_proponente_tema: record.docente.id === tema.docente_proponente.id,
        elegible_actualmente: record.docente.habilitado_tutoria && record.docente.usuario.estado === UsuarioEstado.ACTIVO && record.docente.usuario.rol === UsuarioRol.DOCENTE,
      })), total, page, limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async listarDePostulacion(periodoId: string, postulacionId: string, page: number, limit: number) {
    try {
      const application = await this.dataSource.getRepository(Postulacion).findOne({
        where: { id: postulacionId, periodo: { id: periodoId } },
        relations: { tema: { docente_proponente: true } },
      });
      if (!application) throw new NotFoundException('No existe esa postulación en el período indicado.');
      return this.listar(postulacionId, application.tema, page, limit);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async listarTodasDePostulacion(periodoId: string, postulacionId: string) {
    const page = await this.listarDePostulacion(periodoId, postulacionId, 1, 32767);
    return page.data;
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof QueryFailedError) {
      const code = (error.driverError as DriverError).code;
      if (code === '23505') throw new ConflictException('La lista contiene un docente o prioridad duplicados.');
      if (code === '23503' || code === '23514') throw new ConflictException('La propuesta no cumple las restricciones de tutores.');
    }
    throw new ServiceUnavailableException('No fue posible consultar los docentes propuestos.');
  }
}
