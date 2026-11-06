import { ApiProperty } from '@nestjs/swagger';
import { CarreraResumenDto } from '../../academico/dto/resumen-academico.dto.js';
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

  @ApiProperty({ format: 'uuid' })
  carrera_id: string;

  @ApiProperty({ type: () => CarreraResumenDto })
  carrera: CarreraResumenDto;

  @ApiProperty({ minimum: 1, maximum: 32767 })
  nivel: number;
}
