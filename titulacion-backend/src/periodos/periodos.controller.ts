import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
  ApiExtraModels,
} from '@nestjs/swagger';
import { Roles } from '../common/roles.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { AbrirPostulacionDto } from './dto/abrir-postulacion.dto.js';
import { CreatePeriodoDto } from './dto/create-periodo.dto.js';
import { PeriodoResponseDto } from './dto/periodo-response.dto.js';
import { UpdatePeriodoDto } from './dto/update-periodo.dto.js';
import { PeriodosService } from './periodos.service.js';

@ApiTags('Períodos de titulación')
@ApiBearerAuth('bearer')
@ApiExtraModels(PeriodoResponseDto)
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiForbiddenResponse({ description: 'Se requiere una cuenta ADMIN activa.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos')
@Roles(UsuarioRol.ADMIN)
export class PeriodosController {
  constructor(private readonly periodos: PeriodosService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un período en estado BORRADOR' })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o fechas que incumplen la cronología requerida.',
  })
  @ApiCreatedResponse({ type: PeriodoResponseDto })
  @ApiConflictResponse({ description: 'Ya existe un período con ese código.' })
  create(@Body() dto: CreatePeriodoDto): Promise<PeriodoResponseDto> {
    return this.periodos.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar períodos paginados' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiBadRequestResponse({ description: 'La paginación no es válida.' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['data', 'total', 'page', 'limit'],
      properties: {
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(PeriodoResponseDto) },
        },
        total: { type: 'integer' },
        page: { type: 'integer' },
        limit: { type: 'integer' },
      },
    },
  })
  list(@Query() query: PaginationQueryDto) {
    return this.periodos.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar un período por UUID' })
  @ApiOkResponse({ type: PeriodoResponseDto })
  @ApiBadRequestResponse({ description: 'El identificador debe ser un UUID válido.' })
  @ApiNotFoundResponse({ description: 'No existe el período solicitado.' })
  getById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PeriodoResponseDto> {
    return this.periodos.getById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar un período que siga en estado BORRADOR' })
  @ApiOkResponse({ type: PeriodoResponseDto })
  @ApiBadRequestResponse({
    description: 'Cuerpo vacío, entrada inválida o cronología incompatible.',
  })
  @ApiNotFoundResponse({ description: 'No existe el período solicitado.' })
  @ApiConflictResponse({ description: 'El período ya no está en BORRADOR o el código está duplicado.' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePeriodoDto,
  ): Promise<PeriodoResponseDto> {
    return this.periodos.update(id, dto);
  }

  @Post(':id/abrir-postulacion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Abrir el período dentro del plazo de postulación' })
  @ApiOkResponse({ type: PeriodoResponseDto })
  @ApiBadRequestResponse({ description: 'No se admiten propiedades en el cuerpo.' })
  @ApiNotFoundResponse({ description: 'No existe el período solicitado.' })
  @ApiConflictResponse({ description: 'El estado o las fechas no permiten abrir el período.' })
  abrirPostulacion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AbrirPostulacionDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ): Promise<PeriodoResponseDto> {
    return this.periodos.abrirPostulacion(id, dto, actor, request.ip || null);
  }

  @Post(':id/cerrar-postulacion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar el período cuando venza el plazo de postulación' })
  @ApiOkResponse({ type: PeriodoResponseDto })
  @ApiBadRequestResponse({ description: 'No se admiten propiedades en el cuerpo.' })
  @ApiNotFoundResponse({ description: 'No existe el período solicitado.' })
  @ApiConflictResponse({ description: 'El período sigue abierto o no está en POSTULACION_ABIERTA.' })
  cerrarPostulacion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AbrirPostulacionDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ): Promise<PeriodoResponseDto> {
    return this.periodos.cerrarPostulacion(id, dto, actor, request.ip || null);
  }
}
