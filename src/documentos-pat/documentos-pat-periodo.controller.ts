import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Roles } from '../common/roles.decorator.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { ListUltimasPatQueryDto, PagedUltimasPatResponseDto } from './dto/ultimas-pat-periodo.dto.js';
import { DocumentosPatService } from './documentos-pat.service.js';

@ApiTags('Documentos PAT')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiForbiddenResponse({ description: 'Se requiere una cuenta ADMIN activa.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos/:periodoId/documentos-pat')
@Roles(UsuarioRol.ADMIN)
export class DocumentosPatPeriodoController {
  constructor(private readonly documentos: DocumentosPatService) {}

  @Get('ultimas')
  @ApiOperation({ summary: 'Última versión PAT y su revisión por cada asignación VIGENTE del período (bandeja de revisión)' })
  @ApiOkResponse({ type: PagedUltimasPatResponseDto })
  @ApiBadRequestResponse({ description: 'UUID, paginación o estado inválidos.' })
  @ApiNotFoundResponse({ description: 'No existe el período indicado.' })
  ultimas(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Query() query: ListUltimasPatQueryDto) {
    return this.documentos.ultimasDelPeriodo(periodoId, query);
  }
}
