import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Roles } from '../common/roles.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { PagedAvailableTutorsResponseDto } from './dto/tutores-propuestos.dto.js';
import { TutoresPropuestosService } from './tutores-propuestos.service.js';

@ApiTags('Tutores propuestos')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos/:periodoId/temas/:temaId/tutores-disponibles')
export class TutoresDisponiblesController {
  constructor(private readonly tutores: TutoresPropuestosService) {}

  @Get()
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar docentes elegibles para proponer como tutores, con el proponente sugerido primero' })
  @ApiOkResponse({ type: PagedAvailableTutorsResponseDto })
  @ApiBadRequestResponse({ description: 'UUID o paginación inválidos.' })
  @ApiForbiddenResponse({ description: 'El actor no puede consultar ese tema.' })
  list(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('temaId', new ParseUUIDPipe()) temaId: string, @Query() query: PaginationQueryDto, @CurrentUsuario() actor: Usuario) {
    return this.tutores.disponibles(periodoId, temaId, actor, query);
  }
}
