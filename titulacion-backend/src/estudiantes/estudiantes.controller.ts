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
import { CreateEstudianteDto } from './dto/create-estudiante.dto.js';
import { EstudianteResponseDto } from './dto/estudiante-response.dto.js';
import { EstudiantesService } from './estudiantes.service.js';

@ApiTags('Estudiantes')
@ApiExtraModels(EstudianteResponseDto)
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiForbiddenResponse({ description: 'La cuenta no tiene el rol requerido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('estudiantes')
export class EstudiantesController {
  constructor(private readonly estudiantes: EstudiantesService) {}

  @Post()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Crear perfil de estudiante para una cuenta existente' })
  @ApiBadRequestResponse({ description: 'Los campos del perfil no son válidos.' })
  @ApiCreatedResponse({ type: EstudianteResponseDto })
  @ApiConflictResponse({ description: 'Cuenta incompatible o perfil duplicado.' })
  @ApiNotFoundResponse({ description: 'La cuenta indicada no existe.' })
  create(@Body() dto: CreateEstudianteDto): Promise<EstudianteResponseDto> {
    return this.estudiantes.create(dto);
  }

  @Get()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Listar perfiles de estudiantes paginados' })
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
          items: { $ref: getSchemaPath(EstudianteResponseDto) },
        },
        total: { type: 'integer' },
        page: { type: 'integer' },
        limit: { type: 'integer' },
      },
    },
  })
  list(@Query() query: PaginationQueryDto) {
    return this.estudiantes.list(query);
  }

  @Get('me')
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar el perfil de estudiante propio' })
  @ApiOkResponse({ type: EstudianteResponseDto })
  @ApiNotFoundResponse({ description: 'La cuenta aún no tiene perfil.' })
  getCurrent(
    @CurrentUsuario() usuario: Usuario,
  ): Promise<EstudianteResponseDto> {
    return this.estudiantes.getByUsuarioId(usuario.id);
  }

  @Get(':id')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Consultar un perfil de estudiante' })
  @ApiOkResponse({ type: EstudianteResponseDto })
  @ApiBadRequestResponse({ description: 'El identificador no es un UUID válido.' })
  @ApiNotFoundResponse({ description: 'No existe el perfil solicitado.' })
  getById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EstudianteResponseDto> {
    return this.estudiantes.getById(id);
  }
}
