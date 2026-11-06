import { ApiProperty } from '@nestjs/swagger';
import { CarreraResumenDto } from '../../academico/dto/resumen-academico.dto.js';
import { UsuarioResumenDto } from '../../common/dto/usuario-resumen.dto.js';

export class DocenteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => UsuarioResumenDto })
  usuario: UsuarioResumenDto;

  @ApiProperty({ maxLength: 20, nullable: true, type: String })
  cedula: string | null;

  @ApiProperty({ maxLength: 120, nullable: true, type: String })
  titulo_academico: string | null;

  @ApiProperty({ format: 'uuid' })
  carrera_id: string;

  @ApiProperty({ type: () => CarreraResumenDto })
  carrera: CarreraResumenDto;

  @ApiProperty({ default: false })
  habilitado_tutoria: boolean;
}
