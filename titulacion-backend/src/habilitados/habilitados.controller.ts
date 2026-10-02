import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { Roles } from '../common/roles.decorator.js';
import { CreateHabilitacionDto } from './dto/create-habilitacion.dto.js';
import { HabilitadoResponseDto } from './dto/habilitado-response.dto.js';
import { ListHabilitadosQueryDto } from './dto/list-habilitados-query.dto.js';
import { ResolveIngresoDto } from './dto/resolve-ingreso.dto.js';
import { HabilitadosService } from './habilitados.service.js';

@ApiTags('Estudiantes habilitados')
@ApiBearerAuth('bearer')
@ApiExtraModels(HabilitadoResponseDto)
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos/:periodoId/habilitados')
export class HabilitadosController {
  constructor(private readonly habilitados: HabilitadosService) {}

  @Post()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Habilitar un estudiante en un período BORRADOR' })
  @ApiCreatedResponse({ type: HabilitadoResponseDto })
  @ApiBadRequestResponse({ description: 'Datos inválidos o requisito pendiente vacío.' })
  @ApiForbiddenResponse({ description: 'Se requiere una cuenta ADMIN activa.' })
  @ApiNotFoundResponse({ description: 'No existe el período o perfil indicado.' })
  @ApiConflictResponse({ description: 'El período no está en BORRADOR, la cuenta no es compatible o ya existe la habilitación.' })
  create(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Body() dto: CreateHabilitacionDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ): Promise<HabilitadoResponseDto> {
    return this.habilitados.create(periodoId, actor, dto, request.ip || null);
  }

  @Get()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Listar habilitaciones paginadas de un período' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'condicion_ingreso', required: false, enum: ['REGULAR', 'CONDICIONADO'] })
  @ApiQuery({ name: 'situacion_ingreso', required: false, enum: ['PENDIENTE', 'ADMITIDO', 'NO_ADMITIDO'] })
  @ApiQuery({ name: 'estado', required: false, enum: ['HABILITADO', 'SUSPENDIDO'] })
  @ApiOkResponse({ schema: {
    type: 'object',
    required: ['data', 'total', 'page', 'limit'],
    properties: {
      data: { type: 'array', items: { $ref: getSchemaPath(HabilitadoResponseDto) } },
      total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' },
    },
  } })
  @ApiBadRequestResponse({ description: 'Paginación o filtros inválidos.' })
  @ApiForbiddenResponse({ description: 'Se requiere una cuenta ADMIN activa.' })
  list(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Query() query: ListHabilitadosQueryDto,
  ) {
    return this.habilitados.list(periodoId, query);
  }

  @Get('me')
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar la habilitación propia en un período' })
  @ApiOkResponse({ type: HabilitadoResponseDto })
  @ApiForbiddenResponse({ description: 'Se requiere una cuenta ESTUDIANTE activa.' })
  @ApiNotFoundResponse({ description: 'No tienes perfil o habilitación en ese período.' })
  getMine(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @CurrentUsuario() usuario: Usuario,
  ): Promise<HabilitadoResponseDto> {
    return this.habilitados.getMine(periodoId, usuario);
  }

  @Get(':id')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Consultar una habilitación del período' })
  @ApiOkResponse({ type: HabilitadoResponseDto })
  @ApiBadRequestResponse({ description: 'El identificador debe ser un UUID válido.' })
  @ApiForbiddenResponse({ description: 'Se requiere una cuenta ADMIN activa.' })
  @ApiNotFoundResponse({ description: 'No existe la habilitación en el período indicado.' })
  getById(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<HabilitadoResponseDto> {
    return this.habilitados.getById(periodoId, id);
  }

  @Post(':id/resolver-ingreso')
  @HttpCode(200)
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Resolver el ingreso de un estudiante condicionado pendiente' })
  @ApiOkResponse({ type: HabilitadoResponseDto })
  @ApiBadRequestResponse({ description: 'Situación u observación inválida.' })
  @ApiForbiddenResponse({ description: 'Se requiere una cuenta ADMIN activa.' })
  @ApiNotFoundResponse({ description: 'No existe la habilitación en el período indicado.' })
  @ApiConflictResponse({ description: 'El período no está en BORRADOR o el ingreso ya fue resuelto.' })
  resolve(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResolveIngresoDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ): Promise<HabilitadoResponseDto> {
    return this.habilitados.resolve(periodoId, id, actor, dto, request.ip || null);
  }
}
