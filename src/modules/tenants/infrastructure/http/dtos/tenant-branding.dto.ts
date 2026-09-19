import { ApiProperty } from '@nestjs/swagger'

export class TenantBrandingDto {
  @ApiProperty({ example: '3f8c1b1e-3a6f-4f2e-9a1c-6d9f2b7c4e11' })
  id: string

  @ApiProperty({ example: 'Inmobiliaria Demo' })
  name: string

  @ApiProperty({ example: 'demo' })
  slug: string

  @ApiProperty({ nullable: true, type: String, example: null })
  logoUrl: string | null

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Color de marca en hex. El front lo aplica sobre --primary.',
    example: '#1f4e79',
  })
  primaryColor: string | null
}
