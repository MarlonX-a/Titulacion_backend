import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEmail, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ActualizarDatosPatDto {
  @ApiPropertyOptional({ example: '2002-05-18' }) @IsOptional() @IsString() fecha_nacimiento?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) curso?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) paralelo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) sexo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) nacionalidad?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) estado_civil?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) certificado_votacion?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() certificado_votacion_no_aplica?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) provincia?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) canton?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) parroquia?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(150) correo_personal?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() correo_personal_no_aplica?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) celular?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) telefono_convencional?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() telefono_convencional_no_aplica?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() tiene_discapacidad?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) discapacidades?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) grado_discapacidad?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) otra_discapacidad?: string;
}

export class ActualizarContenidoPatDto {
  @ApiPropertyOptional({ example: 'TRABAJO_INTEGRACION_CURRICULAR' }) @IsOptional() @IsString() @MaxLength(120) modalidad_academica?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) problematica?: string;
  @ApiPropertyOptional({ type: [String], enum: ['INVESTIGACION', 'VINCULACION', 'DOCENCIA', 'NINGUNA'] }) @IsOptional() @IsArray() @IsString({ each: true }) articulaciones?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirma_problematica?: boolean;
}

export class GenerarPatDto {
  @ApiPropertyOptional({ description: 'Obligatorio si aún no hay tutor vigente; debe pertenecer a la postulación.' })
  @IsOptional() @IsUUID() tutor_propuesto_id?: string;
}

export class ConfigurarFormatoPatDto {
  @ApiPropertyOptional({ example: 'Extensión Manta - Matriz' })
  @IsString()
  @MaxLength(150)
  extension: string;
}
