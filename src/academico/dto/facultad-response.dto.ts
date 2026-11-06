import { ApiProperty } from '@nestjs/swagger';

export class CarreraCatalogoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ maxLength: 80 }) codigo: string;
  @ApiProperty({ maxLength: 150 }) nombre: string;
}

export class FacultadResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ maxLength: 80 }) codigo: string;
  @ApiProperty({ maxLength: 150 }) nombre: string;
  @ApiProperty({ type: [CarreraCatalogoDto], description: 'Ordenadas por nombre.' }) carreras: CarreraCatalogoDto[];
}
