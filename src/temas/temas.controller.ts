import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiExtraModels, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse, getSchemaPath } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { ConsultaTemaQueryDto } from './dto/consulta-tema-query.dto.js';
import { CreateTemaDto } from './dto/create-tema.dto.js';
import { ListTemasQueryDto } from './dto/list-temas-query.dto.js';
import { MotivoTemaDto } from './dto/motivo-tema.dto.js';
import { PublicarTemaDto } from './dto/publicar-tema.dto.js';
import { TemaHistorialResponseDto } from './dto/tema-historial-response.dto.js';
import { TemaResponseDto } from './dto/tema-response.dto.js';
import { UpdateTemaDto } from './dto/update-tema.dto.js';
import { TemasService } from './temas.service.js';

const paginado = (modelo: typeof TemaResponseDto | typeof TemaHistorialResponseDto) => ({
  schema: { type: 'object', required: ['data', 'total', 'page', 'limit'], properties: { data: { type: 'array', items: { $ref: getSchemaPath(modelo) } }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } } },
});

@ApiTags('Temas de titulación')
@ApiBearerAuth('bearer')
@ApiExtraModels(TemaResponseDto, TemaHistorialResponseDto)
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('temas')
export class TemasController {
  constructor(private readonly temas: TemasService) {}

  @Post()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Registrar un tema en borrador en el banco de su carrera' })
  @ApiCreatedResponse({ type: TemaResponseDto })
  @ApiBadRequestResponse({ description: 'Datos inválidos, carrera inexistente o docente de otra carrera.' })
  @ApiForbiddenResponse({ description: 'Se requiere una cuenta ADMIN activa.' })
  @ApiNotFoundResponse({ description: 'No existe la línea o el docente indicado.' })
  @ApiConflictResponse({ description: 'Una referencia está inactiva.' })
  create(@Body() dto: CreateTemaDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.temas.create(dto, actor, request.ip || null);
  }

  @Get()
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Listar el banco de temas (ESTUDIANTE: temas publicados de su carrera en un período abierto)' })
  @ApiOkResponse(paginado(TemaResponseDto))
  @ApiBadRequestResponse({ description: 'Filtros inválidos o ESTUDIANTE sin periodo_id.' })
  @ApiForbiddenResponse({ description: 'El rol, período o habilitación no permite consultar estos temas.' })
  list(@Query() query: ListTemasQueryDto, @CurrentUsuario() actor: Usuario) {
    return this.temas.list(query, actor);
  }

  @Get(':id/historial')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Consultar el historial de un tema' })
  @ApiOkResponse(paginado(TemaHistorialResponseDto))
  @ApiNotFoundResponse({ description: 'No existe el tema indicado.' })
  history(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: PaginationQueryDto) {
    return this.temas.history(id, query);
  }

  @Get(':id')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar el detalle de un tema' })
  @ApiOkResponse({ type: TemaResponseDto })
  @ApiNotFoundResponse({ description: 'No existe el tema o no es visible para el usuario.' })
  getById(@Param('id', new ParseUUIDPipe()) id: string, @Query() query: ConsultaTemaQueryDto, @CurrentUsuario() actor: Usuario) {
    return this.temas.getById(id, query, actor);
  }

  @Patch(':id')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Editar un tema sin asignación VIGENTE' })
  @ApiOkResponse({ type: TemaResponseDto })
  @ApiBadRequestResponse({ description: 'Cuerpo vacío, datos inválidos o carrera incompatible.' })
  @ApiNotFoundResponse({ description: 'No existe el tema indicado.' })
  @ApiConflictResponse({ description: 'Asignación VIGENTE, referencia inactiva o cambio de tipo/carrera con postulaciones abiertas.' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateTemaDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.temas.update(id, dto, actor, request.ip || null);
  }

  @Post(':id/publicar')
  @HttpCode(HttpStatus.OK)
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Publicar un tema en borrador o reabrir un tema CERRADO' })
  @ApiOkResponse({ type: TemaResponseDto })
  @ApiBadRequestResponse({ description: 'El cuerpo debe estar vacío o los datos del tema son inválidos.' })
  @ApiNotFoundResponse({ description: 'No existe el tema indicado.' })
  @ApiConflictResponse({ description: 'Referencia inactiva, asignación VIGENTE o estado que no se publica.' })
  publish(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: PublicarTemaDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.temas.publish(id, dto, actor, request.ip || null);
  }

  @Post(':id/cerrar')
  @HttpCode(HttpStatus.OK)
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Cerrar un tema PUBLICADO y rechazar sus postulaciones abiertas' })
  @ApiOkResponse({ type: TemaResponseDto })
  @ApiBadRequestResponse({ description: 'El motivo es obligatorio y admite hasta 1000 caracteres.' })
  @ApiNotFoundResponse({ description: 'No existe el tema indicado.' })
  @ApiConflictResponse({ description: 'El tema tiene asignación VIGENTE o no está PUBLICADO.' })
  close(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: MotivoTemaDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.temas.close(id, dto, actor, request.ip || null);
  }

  @Post(':id/retirar')
  @HttpCode(HttpStatus.OK)
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Retirar definitivamente un tema y rechazar sus postulaciones abiertas' })
  @ApiOkResponse({ type: TemaResponseDto })
  @ApiBadRequestResponse({ description: 'El motivo es obligatorio y admite hasta 1000 caracteres.' })
  @ApiNotFoundResponse({ description: 'No existe el tema indicado.' })
  @ApiConflictResponse({ description: 'El tema tiene asignación VIGENTE o ya está RETIRADO.' })
  withdraw(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: MotivoTemaDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.temas.withdraw(id, dto, actor, request.ip || null);
  }
}
