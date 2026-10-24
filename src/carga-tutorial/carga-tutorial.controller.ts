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
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Roles } from '../common/roles.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { CreateConfigCargaTutorialDto } from './dto/create-config-carga-tutorial.dto.js';
import { ConfigCargaEfectivaResponseDto } from './dto/config-carga-efectiva-response.dto.js';
import { ConfigCargaTutorialResponseDto } from './dto/config-carga-tutorial-response.dto.js';
import { UpdateConfigCargaTutorialDto } from './dto/update-config-carga-tutorial.dto.js';
import { CargaTutorialService } from './carga-tutorial.service.js';

@ApiTags('Carga tutorial')
@ApiBearerAuth('bearer')
@ApiExtraModels(ConfigCargaTutorialResponseDto)
@ApiForbiddenResponse({ description: 'El rol de la cuenta no permite esta operación.' })
@ApiServiceUnavailableResponse({ description: 'No fue posible consultar o guardar la configuración.' })
@Controller('periodos/:periodoId/config-carga-tutorial')
export class CargaTutorialController {
  constructor(private readonly cargaTutorial: CargaTutorialService) {}

  @Post()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Crear configuración global o específica de carga tutorial' })
  @ApiCreatedResponse({ type: ConfigCargaTutorialResponseDto })
  @ApiBadRequestResponse({ description: 'El máximo o los tipos enviados no son válidos.' })
  @ApiConflictResponse({ description: 'Ámbito duplicado, docente incompatible o período archivado.' })
  create(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Body() dto: CreateConfigCargaTutorialDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ) {
    return this.cargaTutorial.create(periodoId, dto, actor, request.ip || null);
  }

  @Get()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Listar las configuraciones de carga tutorial del período' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, maximum: 100 })
  @ApiOkResponse({
    description: 'Lista paginada, con el ámbito global primero.',
    schema: {
      type: 'object',
      required: ['data', 'total', 'page', 'limit'],
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(ConfigCargaTutorialResponseDto) } },
        total: { type: 'integer' },
        page: { type: 'integer' },
        limit: { type: 'integer' },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'La paginación no es válida.' })
  list(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Query() query: PaginationQueryDto) {
    return this.cargaTutorial.list(periodoId, query);
  }

  @Get('efectiva/me')
  @Roles(UsuarioRol.DOCENTE)
  @ApiOperation({ summary: 'Consultar la configuración efectiva de la cuenta docente' })
  @ApiOkResponse({ type: ConfigCargaEfectivaResponseDto })
  @ApiNotFoundResponse({ description: 'No existe el período o perfil docente.' })
  effectiveMe(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @CurrentUsuario() actor: Usuario,
  ) {
    return this.cargaTutorial.effectiveForUser(periodoId, actor);
  }

  @Get('efectiva/:docenteId')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Consultar la configuración efectiva de un docente' })
  @ApiOkResponse({ type: ConfigCargaEfectivaResponseDto })
  @ApiNotFoundResponse({ description: 'No existe el período o perfil docente.' })
  effectiveForDocente(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Param('docenteId', new ParseUUIDPipe()) docenteId: string,
  ) {
    return this.cargaTutorial.effectiveForDocente(periodoId, docenteId);
  }

  @Patch(':id')
  @Roles(UsuarioRol.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Modificar el máximo o la modalidad de control' })
  @ApiOkResponse({ type: ConfigCargaTutorialResponseDto })
  @ApiBadRequestResponse({ description: 'El cuerpo está vacío o contiene valores inválidos.' })
  @ApiNotFoundResponse({ description: 'No existe esa configuración en el período.' })
  @ApiConflictResponse({ description: 'El período está archivado.' })
  update(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateConfigCargaTutorialDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ) {
    return this.cargaTutorial.update(periodoId, id, dto, actor, request.ip || null);
  }
}
