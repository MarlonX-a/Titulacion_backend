import { ApiProperty } from '@nestjs/swagger';
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

  @ApiProperty({ maxLength: 120, nullable: true, type: String })
  departamento: string | null;

  @ApiProperty({ default: false })
  habilitado_tutoria: boolean;
}
