import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { Notificacion } from './entities/notificacion.entity.js';
import { NotificacionCanal } from './enums/notificacion-canal.enum.js';
import { NotificacionQueryDto } from './dto/notificacion-query.dto.js';
import type { NotificacionPageDto, NotificacionResponseDto } from './dto/notificacion-response.dto.js';

@Injectable()
export class NotificacionesService {
  constructor(@InjectRepository(Notificacion) private readonly repository: Repository<Notificacion>, private readonly dataSource: DataSource) {}

  async listar(actor: Usuario, query: NotificacionQueryDto): Promise<NotificacionPageDto> {
    try {
      const where: Record<string, unknown> = { usuario_id: actor.id, canal: NotificacionCanal.EN_APP };
      if (query.tipo) where.tipo = query.tipo;
      if (query.leida !== undefined) where.leida = query.leida;
      const [rows, total] = await this.repository.findAndCount({ where, order: { fecha_creacion: 'DESC', id: 'ASC' }, skip: (query.page - 1) * query.limit, take: query.limit });
      return { data: rows.map((row) => this.toResponse(row)), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleError(error); }
  }

  async contador(actor: Usuario): Promise<{ total: number }> {
    try { return { total: await this.repository.count({ where: { usuario_id: actor.id, canal: NotificacionCanal.EN_APP, leida: false } }) }; }
    catch (error: unknown) { this.handleError(error); }
  }

  async porId(id: string, actor: Usuario): Promise<NotificacionResponseDto> {
    try {
      const item = await this.repository.findOneBy({ id, usuario_id: actor.id, canal: NotificacionCanal.EN_APP });
      if (!item) throw new NotFoundException('No existe la notificación solicitada.');
      return this.toResponse(item);
    } catch (error: unknown) { this.handleError(error); }
  }

  async marcarLeida(id: string, actor: Usuario): Promise<NotificacionResponseDto> {
    try {
      const result = await this.repository.update({ id, usuario_id: actor.id, canal: NotificacionCanal.EN_APP }, { leida: true });
      if (!result.affected) throw new NotFoundException('No existe la notificación solicitada.');
      return this.porId(id, actor);
    } catch (error: unknown) { this.handleError(error); }
  }

  private toResponse(item: Notificacion): NotificacionResponseDto {
    return { id: item.id, tipo: item.tipo, titulo: item.titulo, mensaje: item.mensaje, entidad_tipo: item.entidad_tipo, entidad_id: item.entidad_id, canal: item.canal, leida: item.leida, fecha_creacion: item.fecha_creacion, fecha_envio: item.fecha_envio };
  }
  private handleError(error: unknown): never {
    if (error instanceof NotFoundException) throw error;
    if (error instanceof QueryFailedError) throw new ServiceUnavailableException('No fue posible consultar las notificaciones.');
    throw error;
  }
}
