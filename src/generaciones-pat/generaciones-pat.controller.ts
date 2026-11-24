import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { ActualizarContenidoPatDto, ActualizarDatosPatDto, ConfigurarFormatoPatDto, DescargaGeneracionPatQueryDto, GenerarPatDto } from './dto/actualizar-datos-pat.dto.js';
import { TutoresPropuestosPatResponseDto } from './dto/tutores-propuestos-pat.dto.js';
import { GeneracionPatResponseDto, ListaGeneracionesPatResponseDto, ResumenPatResponseDto } from './dto/resumen-pat.dto.js';
import { GeneracionesPatService } from './generaciones-pat.service.js';

@ApiTags('Generación individual del PAT')
@ApiBearerAuth('bearer')
@Controller()
export class GeneracionesPatController {
  constructor(private readonly service: GeneracionesPatService) {}

  @Get('estudiantes/me/datos-pat') @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar datos complementarios propios y campos pendientes del PAT' })
  datos(@CurrentUsuario() actor: Usuario) { return this.service.obtenerDatos(actor); }

  @Patch('estudiantes/me/datos-pat') @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Guardar o corregir datos complementarios personales del PAT' })
  actualizarDatos(@Body() dto: ActualizarDatosPatDto,@CurrentUsuario() actor:Usuario,@Req()req:Request){return this.service.actualizarDatos(dto,actor,req.ip??null);}

  @Get('periodos/:periodoId/asignaciones-tema/:asignacionId/pat/me') @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar contenido individual del PAT y campos pendientes' })
  contenido(@Param('periodoId',new ParseUUIDPipe())p:string,@Param('asignacionId',new ParseUUIDPipe())a:string,@CurrentUsuario()actor:Usuario){return this.service.obtenerContenido(p,a,actor);}

  @Get('periodos/:periodoId/asignaciones-tema/:asignacionId/pat/me/tutores-propuestos') @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar tutor vigente o propuestas propias necesarias para generar el PAT' })
  @ApiOkResponse({ type: TutoresPropuestosPatResponseDto })
  tutoresPropuestos(@Param('periodoId',new ParseUUIDPipe())p:string,@Param('asignacionId',new ParseUUIDPipe())a:string,@CurrentUsuario()actor:Usuario){return this.service.tutoresPropuestos(p,a,actor);}

  @Get('periodos/:periodoId/asignaciones-tema/:asignacionId/pat/me/resumen') @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Resumen del PAT: datos autocompletados con su fuente, campos editables, pendientes y tutores' })
  @ApiOkResponse({ type: ResumenPatResponseDto })
  resumen(@Param('periodoId',new ParseUUIDPipe())p:string,@Param('asignacionId',new ParseUUIDPipe())a:string,@CurrentUsuario()actor:Usuario){return this.service.resumen(p,a,actor);}

  @Patch('periodos/:periodoId/asignaciones-tema/:asignacionId/pat/me') @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Completar o corregir el contenido individual del PAT' })
  actualizarContenido(@Param('periodoId',new ParseUUIDPipe())p:string,@Param('asignacionId',new ParseUUIDPipe())a:string,@Body()dto:ActualizarContenidoPatDto,@CurrentUsuario()actor:Usuario,@Req()req:Request){return this.service.actualizarContenido(p,a,dto,actor,req.ip??null);}

  @Post('periodos/:periodoId/asignaciones-tema/:asignacionId/pat/me/generaciones') @HttpCode(HttpStatus.ACCEPTED) @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Solicitar el PDF individual del PAT desde la información guardada' })
  @ApiAcceptedResponse({ schema: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, estado: { type: 'string', example: 'EN_COLA' } } } })
  generar(@Param('periodoId',new ParseUUIDPipe())p:string,@Param('asignacionId',new ParseUUIDPipe())a:string,@Body()dto:GenerarPatDto,@CurrentUsuario()actor:Usuario,@Req()req:Request){return this.service.solicitar(p,a,dto,actor,req.ip??null);}

  @Get('periodos/:periodoId/asignaciones-tema/:asignacionId/pat/me/generaciones') @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Listar las generaciones PAT propias de la asignación, de la más reciente a la más antigua' })
  @ApiOkResponse({ type: ListaGeneracionesPatResponseDto })
  listar(@Param('periodoId',new ParseUUIDPipe())p:string,@Param('asignacionId',new ParseUUIDPipe())a:string,@CurrentUsuario()actor:Usuario){return this.service.listar(p,a,actor);}

  @Get('periodos/:periodoId/asignaciones-tema/:asignacionId/pat/me/generaciones/:id') @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOkResponse({ type: GeneracionPatResponseDto })
  @ApiOperation({ summary: 'Consultar el procesamiento de una generación PAT propia' })
  generacion(@Param('periodoId',new ParseUUIDPipe())p:string,@Param('asignacionId',new ParseUUIDPipe())a:string,@Param('id',new ParseUUIDPipe())id:string,@CurrentUsuario()actor:Usuario){return this.service.porId(p,a,id,actor);}

  @Get('periodos/:periodoId/asignaciones-tema/:asignacionId/pat/me/generaciones/:id/descarga') @Roles(UsuarioRol.ESTUDIANTE) @Header('Cache-Control','no-store')
  @ApiOperation({ summary: 'Obtener URL temporal para descargar el PAT generado sin firma (PDF o Word institucional PAT-04-F-002)' })
  descargar(@Param('periodoId',new ParseUUIDPipe())p:string,@Param('asignacionId',new ParseUUIDPipe())a:string,@Param('id',new ParseUUIDPipe())id:string,@Query()query:DescargaGeneracionPatQueryDto,@CurrentUsuario()actor:Usuario){return this.service.descarga(p,a,id,actor,query.formato??'pdf');}

  @Post('periodos/:periodoId/asignaciones-tema/:asignacionId/pat/me/generaciones/:id/reintentar') @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Reintentar una generación PAT propia fallida (nuevo ciclo)' })
  reintentar(@Param('periodoId',new ParseUUIDPipe())p:string,@Param('asignacionId',new ParseUUIDPipe())a:string,@Param('id',new ParseUUIDPipe())id:string,@CurrentUsuario()actor:Usuario,@Req()req:Request){return this.service.reintentar(p,a,id,actor,req.ip??null);}
}

@ApiTags('Períodos') @ApiBearerAuth('bearer') @Controller('periodos')
export class ConfigurarFormatoPatController {
  constructor(private readonly service:GeneracionesPatService){}
  @Patch(':periodoId/datos-formato-pat') @Roles(UsuarioRol.ADMIN)
  @ApiOperation({summary:'Configurar la extensión o sede que se imprimirá en los PAT del período'})
  configurar(@Param('periodoId',new ParseUUIDPipe())id:string,@Body()body:ConfigurarFormatoPatDto,@CurrentUsuario()actor:Usuario,@Req()req:Request){return this.service.configurar(id,body.extension,actor,req.ip??null);}
}
