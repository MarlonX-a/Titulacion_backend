import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { NotificacionQueryDto } from './dto/notificacion-query.dto.js';
import { NotificacionCountDto, NotificacionPageDto, NotificacionResponseDto } from './dto/notificacion-response.dto.js';
import { NotificacionesService } from './notificaciones.service.js';

class EmptyBodyDto {}

@ApiTags('Notificaciones')
@ApiBearerAuth('bearer')
@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly service: NotificacionesService) {}
  @Get() @ApiOperation({ summary: 'Consultar la bandeja propia de notificaciones' }) @ApiOkResponse({ type: NotificacionPageDto })
  listar(@CurrentUsuario() actor: Usuario, @Query() query: NotificacionQueryDto) { return this.service.listar(actor, query); }
  @Get('no-leidas/contador') @ApiOperation({ summary: 'Contar notificaciones propias sin leer' }) @ApiOkResponse({ type: NotificacionCountDto })
  contador(@CurrentUsuario() actor: Usuario) { return this.service.contador(actor); }
  @Get(':id') @ApiOperation({ summary: 'Consultar una notificación propia' }) @ApiOkResponse({ type: NotificacionResponseDto })
  porId(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario) { return this.service.porId(id, actor); }
  @Post(':id/leer') @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar una notificación propia como leída' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false, maxProperties: 0 } })
  @ApiOkResponse({ type: NotificacionResponseDto })
  @ApiBadRequestResponse({ description: 'El endpoint no admite campos de entrada.' })
  leer(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario, @Body() _body: EmptyBodyDto) { return this.service.marcarLeida(id, actor); }
}
