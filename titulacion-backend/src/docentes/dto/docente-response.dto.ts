import { ApiProperty } from '@nestjs/swagger';
import { UsuarioResumenDto } from '../../common/dto/usuario-resumen.dto.js';

export class DocenteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => UsuarioResumenDto })
  usuario: UsuarioResumenDto;

  @ApiProperty({ maxLength: 20 })
  cedula: string;

  @ApiProperty({ maxLength: 120 })
  titulo_academico: string;

  @ApiProperty({ maxLength: 120 })
  departamento: string;

  @ApiProperty({ default: false })
  habilitado_tutoria: boolean;
}
