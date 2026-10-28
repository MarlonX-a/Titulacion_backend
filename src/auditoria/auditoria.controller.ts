import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../common/roles.decorator.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { AuditoriaConsultaService } from './auditoria-consulta.service.js';
import { AuditoriaPageDto } from './dto/auditoria-response.dto.js';
import { ListAuditoriaQueryDto } from './dto/list-auditoria-query.dto.js';

@ApiTags('Auditoría')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiForbiddenResponse({ description: 'Se requiere una cuenta ADMIN activa.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('auditoria')
@Roles(UsuarioRol.ADMIN)
export class AuditoriaController {
  constructor(private readonly consulta: AuditoriaConsultaService) {}

  @Get()
  @ApiOperation({
    summary: 'Consultar el registro de auditoría (más reciente primero)',
    description: 'Incluye actor, valores anteriores/nuevos e IP de origen. Ordena por fecha_hora DESC, id DESC. `q` busca sin distinguir mayúsculas en acción, tipo de entidad y correo del actor.',
  })
  @ApiOkResponse({ type: AuditoriaPageDto })
  @ApiBadRequestResponse({ description: 'Paginación, filtros o rango de fechas inválidos.' })
  listar(@Query() query: ListAuditoriaQueryDto): Promise<AuditoriaPageDto> {
    return this.consulta.listar(query);
  }
}
