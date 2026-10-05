import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateInvitacionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  estudiante_destino_id: string;
}
