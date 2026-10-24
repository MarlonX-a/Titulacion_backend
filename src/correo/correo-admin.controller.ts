import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CorreoOutboxService } from './correo-outbox.service.js';

@ApiTags('Administración de correo')
@ApiBearerAuth('bearer')
@Roles(UsuarioRol.ADMIN)
@Controller('admin/correos')
export class CorreoAdminController {
  constructor(private readonly outbox: CorreoOutboxService) {}

  @Get()
  @ApiOperation({ summary: 'Consultar entregas de correo pendientes o fallidas' })
  @ApiOkResponse({ description: 'Lista de mensajes sin secretos ni contenido sensible.' })
  list(@Query() query: PaginationQueryDto, @CurrentUsuario() actor: Usuario) {
    return this.outbox.listAdmin(actor, query.page, query.limit);
  }

  @Post(':id/reintentar')
  @ApiOperation({ summary: 'Reintentar el envío de un correo pendiente o fallido' })
  @ApiOkResponse({ description: 'El mensaje se vuelve a colocar en la cola.' })
  retry(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.outbox.retry(id, actor, request.ip ?? null);
  }
}
