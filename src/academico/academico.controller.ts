import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Roles } from '../common/roles.decorator.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { AcademicoService } from './academico.service.js';
import { FacultadResponseDto } from './dto/facultad-response.dto.js';

@ApiTags('Catálogo académico')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@Controller('facultades')
export class AcademicoController {
  constructor(private readonly academico: AcademicoService, private readonly dataSource: DataSource) {}

  @Get()
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Listar facultades con sus carreras (ordenadas por nombre)' })
  @ApiOkResponse({ type: [FacultadResponseDto] })
  async listar(): Promise<FacultadResponseDto[]> {
    const catalogo = await this.academico.catalogo(this.dataSource);
    return catalogo.facultades.map((f) => ({
      id: f.id, codigo: f.codigo, nombre: f.nombre,
      carreras: f.carreras.map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre })),
    }));
  }
}
