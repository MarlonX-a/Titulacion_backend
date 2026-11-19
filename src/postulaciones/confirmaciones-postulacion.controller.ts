import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { ConfirmacionesPostulacionService } from './confirmaciones-postulacion.service.js';
import { ConfirmacionPostulacionResponseDto, ConfirmarPostulacionDto, RechazarPostulacionDto } from './dto/confirmacion-postulacion.dto.js';

@ApiTags('Postulaciones')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiForbiddenResponse({ description: 'Solo estudiantes.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('postulaciones')
@Roles(UsuarioRol.ESTUDIANTE)
export class ConfirmacionesPostulacionController {
  constructor(private readonly confirmaciones: ConfirmacionesPostulacionService) {}

  @Get('confirmaciones-pendientes')
  @ApiOperation({ summary: 'Postulaciones de mi grupo que esperan mi confirmación (reserva vigente)' })
  @ApiOkResponse({ type: [ConfirmacionPostulacionResponseDto] })
  pendientes(@CurrentUsuario() actor: Usuario): Promise<ConfirmacionPostulacionResponseDto[]> {
    return this.confirmaciones.listarPendientes(actor);
  }

  @Post(':id/confirmar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar la postulación registrada por el representante (idempotente)' })
  @ApiOkResponse({ type: ConfirmacionPostulacionResponseDto })
  @ApiBadRequestResponse({ description: 'UUID inválido o cuerpo con propiedades.' })
  @ApiNotFoundResponse({ description: 'La postulación no existe o el estudiante no participa en ella.' })
  @ApiConflictResponse({ description: 'La postulación ya no espera confirmaciones o la reserva venció.' })
  confirmar(@Param('id', new ParseUUIDPipe()) id: string, @Body() _dto: ConfirmarPostulacionDto, @CurrentUsuario() actor: Usuario, @Req() request: Request): Promise<ConfirmacionPostulacionResponseDto> {
    return this.confirmaciones.confirmar(id, actor, request.ip ?? null);
  }

  @Post(':id/rechazar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rechazar la postulación: queda RECHAZADA y el tema vuelve a PUBLICADO (idempotente)' })
  @ApiOkResponse({ type: ConfirmacionPostulacionResponseDto })
  @ApiBadRequestResponse({ description: 'UUID o motivo inválido.' })
  @ApiNotFoundResponse({ description: 'La postulación no existe o el estudiante no participa en ella.' })
  @ApiConflictResponse({ description: 'Ya confirmó, la postulación ya no espera confirmaciones o la reserva venció.' })
  rechazar(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: RechazarPostulacionDto, @CurrentUsuario() actor: Usuario, @Req() request: Request): Promise<ConfirmacionPostulacionResponseDto> {
    return this.confirmaciones.rechazar(id, actor, dto.motivo, request.ip ?? null);
  }
}
