import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import { Roles } from '../common/roles.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateDocenteDto } from './dto/create-docente.dto.js';
import { DocenteResponseDto } from './dto/docente-response.dto.js';
import { DocentesService } from './docentes.service.js';

@ApiTags('Docentes')
@ApiExtraModels(DocenteResponseDto)
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiForbiddenResponse({ description: 'La cuenta no tiene el rol requerido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('docentes')
export class DocentesController {
  constructor(private readonly docentes: DocentesService) {}

  @Post()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Crear perfil docente para una cuenta existente' })
  @ApiBadRequestResponse({ description: 'Los campos del perfil no son válidos.' })
  @ApiCreatedResponse({ type: DocenteResponseDto })
  @ApiConflictResponse({ description: 'Cuenta incompatible o perfil duplicado.' })
  @ApiNotFoundResponse({ description: 'La cuenta indicada no existe.' })
  create(@Body() dto: CreateDocenteDto): Promise<DocenteResponseDto> {
    return this.docentes.create(dto);
  }

  @Get()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Listar perfiles de docentes paginados' })
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
          items: { $ref: getSchemaPath(DocenteResponseDto) },
        },
        total: { type: 'integer' },
        page: { type: 'integer' },
        limit: { type: 'integer' },
      },
    },
  })
  list(@Query() query: PaginationQueryDto) {
    return this.docentes.list(query);
  }

  @Get('me')
  @Roles(UsuarioRol.DOCENTE)
  @ApiOperation({ summary: 'Consultar el perfil docente propio' })
  @ApiOkResponse({ type: DocenteResponseDto })
  @ApiNotFoundResponse({ description: 'La cuenta aún no tiene perfil.' })
  getCurrent(@CurrentUsuario() usuario: Usuario): Promise<DocenteResponseDto> {
    return this.docentes.getByUsuarioId(usuario.id);
  }

  @Get(':id')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Consultar un perfil docente' })
  @ApiOkResponse({ type: DocenteResponseDto })
  @ApiBadRequestResponse({ description: 'El identificador no es un UUID válido.' })
  @ApiNotFoundResponse({ description: 'No existe el perfil solicitado.' })
  getById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DocenteResponseDto> {
    return this.docentes.getById(id);
  }
}
