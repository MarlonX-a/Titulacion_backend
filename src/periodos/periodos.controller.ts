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
import { TransicionPeriodoDto } from './dto/transicion-periodo.dto.js';
import { ArchivarPeriodoDto } from './dto/archivar-periodo.dto.js';
import { CreatePeriodoDto } from './dto/create-periodo.dto.js';
import { PeriodoResponseDto } from './dto/periodo-response.dto.js';
import { UpdatePeriodoDto } from './dto/update-periodo.dto.js';
import { PeriodosService } from './periodos.service.js';
import { InicioTitulacionService } from './inicio-titulacion.service.js';
import { ArchivoPeriodoService } from './archivo-periodo.service.js';
import { ResumenPeriodoService } from './resumen-periodo.service.js';
import { ResumenPeriodoResponseDto } from './dto/resumen-periodo-response.dto.js';

@ApiTags('Períodos de titulación')
@ApiBearerAuth('bearer')
@ApiExtraModels(PeriodoResponseDto)
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiForbiddenResponse({ description: 'Se requiere una cuenta ADMIN activa.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos')
@Roles(UsuarioRol.ADMIN)
export class PeriodosController {
  constructor(
    private readonly periodos: PeriodosService,
    private readonly inicioTitulacion: InicioTitulacionService,
    private readonly archivoPeriodo: ArchivoPeriodoService,
    private readonly resumenPeriodo: ResumenPeriodoService,
  ) {}

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
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
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
  list(@Query() query: PaginationQueryDto, @CurrentUsuario() actor: Usuario) {
    return this.periodos.list(query, actor.rol === UsuarioRol.ADMIN);
  }

  @Get(':id')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar un período por UUID' })
  @ApiOkResponse({ type: PeriodoResponseDto })
  @ApiBadRequestResponse({ description: 'El identificador debe ser un UUID válido.' })
  @ApiNotFoundResponse({ description: 'No existe el período solicitado.' })
  getById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUsuario() actor: Usuario,
  ): Promise<PeriodoResponseDto> {
    return this.periodos.getById(id, actor.rol === UsuarioRol.ADMIN);
  }

  @Get(':id/resumen')
  @ApiOperation({ summary: 'Indicadores agregados del período para el panel administrativo' })
  @ApiOkResponse({ type: ResumenPeriodoResponseDto })
  @ApiBadRequestResponse({ description: 'El identificador debe ser un UUID válido.' })
  @ApiNotFoundResponse({ description: 'No existe el período solicitado.' })
  resumen(@Param('id', new ParseUUIDPipe()) id: string): Promise<ResumenPeriodoResponseDto> {
    return this.resumenPeriodo.obtener(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar un período en BORRADOR o la fecha fin de postulación en POSTULACION_CERRADA' })
  @ApiOkResponse({ type: PeriodoResponseDto })
  @ApiBadRequestResponse({
    description: 'Cuerpo vacío, entrada inválida o cronología incompatible.',
  })
  @ApiNotFoundResponse({ description: 'No existe el período solicitado.' })
  @ApiConflictResponse({ description: 'El estado no permite la edición solicitada (en POSTULACION_CERRADA solo la fecha fin de postulación) o el código está duplicado.' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePeriodoDto,
  ): Promise<PeriodoResponseDto> {
    return this.periodos.update(id, dto);
  }

  @Post(':id/abrir-postulacion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Abrir (desde BORRADOR) o reabrir (desde POSTULACION_CERRADA) la postulación dentro de su plazo', description: 'Con { forzar: true, motivo } y antes de la fecha de inicio, la fecha de inicio de postulación pasa a la hora actual y se audita como ABRIR_POSTULACION_FORZADA / REABRIR_POSTULACION_FORZADA.' })
  @ApiOkResponse({ type: PeriodoResponseDto })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido o motivo ausente/fuera de 10–500 caracteres al forzar.' })
  @ApiNotFoundResponse({ description: 'No existe el período solicitado.' })
  @ApiConflictResponse({ description: 'El estado no es BORRADOR ni POSTULACION_CERRADA, la fecha actual está fuera del plazo (sin forzar) o la fecha fin de postulación ya pasó (al forzar).' })
  abrirPostulacion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TransicionPeriodoDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ): Promise<PeriodoResponseDto> {
    return this.periodos.abrirPostulacion(id, dto, actor, request.ip || null);
  }

  @Post(':id/cerrar-postulacion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar el período cuando venza el plazo de postulación', description: 'Con { forzar: true, motivo } antes del vencimiento, la fecha fin de postulación pasa a la hora actual (CERRAR_POSTULACION_FORZADA).' })
  @ApiOkResponse({ type: PeriodoResponseDto })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido o motivo ausente/fuera de 10–500 caracteres al forzar.' })
  @ApiNotFoundResponse({ description: 'No existe el período solicitado.' })
  @ApiConflictResponse({ description: 'El período sigue abierto o no está en POSTULACION_ABIERTA.' })
  cerrarPostulacion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TransicionPeriodoDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ): Promise<PeriodoResponseDto> {
    return this.periodos.cerrarPostulacion(id, dto, actor, request.ip || null);
  }

  @Post(':id/iniciar-titulacion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Iniciar formalmente la titulación',
    description: 'Los condicionados que sigan pendientes quedan SUSPENDIDO y NO_ADMITIDO en la misma transacción, con auditoría individual. Con { forzar: true, motivo } antes de la fecha configurada, fecha_inicio_titulacion pasa a la hora actual (INICIAR_TITULACION_FORZADA).',
  })
  @ApiOkResponse({ type: PeriodoResponseDto })
  @ApiBadRequestResponse({ description: 'El identificador es inválido, el cuerpo tiene propiedades no permitidas o falta el motivo al forzar.' })
  @ApiNotFoundResponse({ description: 'No existe el período solicitado.' })
  @ApiConflictResponse({ description: 'El período no está en POSTULACION_CERRADA, la fecha de inicio no ha llegado o hubo una actualización concurrente.' })
  iniciarTitulacion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TransicionPeriodoDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ): Promise<PeriodoResponseDto> {
    return this.inicioTitulacion.iniciar(id, actor, request.ip || null, dto);
  }

  @Post(':id/archivar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archivar un período en cualquier estado no archivado y conservar su historial' })
  @ApiOkResponse({ type: PeriodoResponseDto })
  @ApiBadRequestResponse({ description: 'UUID o motivo inválido, o cuerpo con propiedades no permitidas.' })
  @ApiNotFoundResponse({ description: 'No existe el período solicitado.' })
  @ApiConflictResponse({ description: 'El período ya está ARCHIVADO (estado terminal e inmutable) o hubo una actualización concurrente.' })
  archivar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ArchivarPeriodoDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ): Promise<PeriodoResponseDto> {
    return this.archivoPeriodo.archivar(id, dto, actor, request.ip || null);
  }
}
