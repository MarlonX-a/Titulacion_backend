import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CorreoOutboxService } from './correo-outbox.service.js';
import { NotificacionCorreoAdminPageDto, NotificacionCorreoQueryDto } from './dto/notificacion-correo-query.dto.js';

@ApiTags('Administración de notificaciones por correo')
@ApiBearerAuth('bearer')
@Roles(UsuarioRol.ADMIN)
@Controller('admin/notificaciones-email')
export class NotificacionesCorreoAdminController {
  constructor(private readonly outbox: CorreoOutboxService) {}
  @Get() @ApiOperation({ summary: 'Consultar el estado de los correos de notificación' }) @ApiOkResponse({ type: NotificacionCorreoAdminPageDto })
  listar(@Query() query: NotificacionCorreoQueryDto) { return this.outbox.listNotificationAdmin(query.page, query.limit, query.estado); }
  @Post(':id/reintentar') @ApiOperation({ summary: 'Reintentar un correo de notificación fallido' }) @ApiOkResponse()
  reintentar(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario, @Req() request: Request) { return this.outbox.retryNotification(id, actor, request.ip ?? null); }
}
