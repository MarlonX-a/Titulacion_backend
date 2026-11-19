import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateProgramaDto, ListProgramasQueryDto, PagedProgramasResponseDto, ProgramaResponseDto, UpdateProgramaDto } from './dto/programa.dto.js';
import { ProgramasService } from './programas.service.js';

@ApiTags('Programas de temas')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('programas')
export class ProgramasController {
  constructor(private readonly programas: ProgramasService) {}

  @Get()
  @Roles(UsuarioRol.ADMIN, UsuarioRol.COORDINADOR, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Listar programas (ESTUDIANTE: solo los activos de su carrera; mios=true: los propios)' })
  @ApiOkResponse({ type: PagedProgramasResponseDto })
  @ApiBadRequestResponse({ description: 'Filtros o paginación inválidos.' })
  list(@Query() query: ListProgramasQueryDto, @CurrentUsuario() actor: Usuario) {
    return this.programas.list(query, actor);
  }

  @Get(':id')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.COORDINADOR, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar un programa' })
  @ApiOkResponse({ type: ProgramaResponseDto })
  @ApiNotFoundResponse({ description: 'No existe o no es visible para el usuario.' })
  getById(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario) {
    return this.programas.getById(id, actor);
  }

  @Post()
  @Roles(UsuarioRol.ADMIN, UsuarioRol.COORDINADOR)
  @ApiOperation({ summary: 'Crear un programa (COORDINADOR: queda como responsable)' })
  @ApiCreatedResponse({ type: ProgramaResponseDto })
  @ApiBadRequestResponse({ description: 'Datos inválidos, carrera inexistente o responsable ausente/duplicado.' })
  @ApiForbiddenResponse({ description: 'Rol no permitido o COORDINADOR con otro responsable.' })
  @ApiNotFoundResponse({ description: 'No existe el docente o usuario responsable.' })
  @ApiConflictResponse({ description: 'Nombre repetido en la carrera o responsable incompatible.' })
  create(@Body() dto: CreateProgramaDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.programas.create(dto, actor, request.ip || null);
  }

  @Patch(':id')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.COORDINADOR)
  @ApiOperation({ summary: 'Editar o desactivar un programa (COORDINADOR: solo los propios, sin cambiar el responsable)' })
  @ApiOkResponse({ type: ProgramaResponseDto })
  @ApiBadRequestResponse({ description: 'Cuerpo vacío o datos inválidos.' })
  @ApiForbiddenResponse({ description: 'COORDINADOR sobre un programa ajeno o cambiando el responsable.' })
  @ApiNotFoundResponse({ description: 'No existe el programa o el responsable.' })
  @ApiConflictResponse({ description: 'Nombre repetido, máximo menor que los temas actuales, cambio de carrera con temas o responsable incompatible.' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateProgramaDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.programas.update(id, dto, actor, request.ip || null);
  }
}
