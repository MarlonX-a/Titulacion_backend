import { ApiProperty } from '@nestjs/swagger';
import { UsuarioResumenDto } from '../../common/dto/usuario-resumen.dto.js';

export class EstudianteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: () => UsuarioResumenDto })
  usuario: UsuarioResumenDto;

  @ApiProperty({ maxLength: 20 })
  cedula: string;

  @ApiProperty({ maxLength: 20 })
  matricula: string;

  @ApiProperty({ maxLength: 120 })
  carrera: string;

  @ApiProperty({ minimum: 1, maximum: 32767 })
  nivel: number;
}
