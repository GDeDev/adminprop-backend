import { ApiProperty } from '@nestjs/swagger'
import { IsString, MaxLength } from 'class-validator'

export class CreateExampleDto {
  @ApiProperty({ required: true, type: String })
  @IsString()
  @MaxLength(10)
  name: string
}
