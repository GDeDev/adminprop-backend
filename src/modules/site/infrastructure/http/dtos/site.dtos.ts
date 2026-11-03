import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

import {
  SITE_SECTION_KEYS,
  SITE_TEMPLATE_KEYS,
  SOCIAL_NETWORKS,
  STEP_ICONS,
} from '../../../domain/site.types'

// ---------------------------------------------------------------- Pedidos

export class UpdateSiteSettingsDto {
  @ApiPropertyOptional({ enum: SITE_TEMPLATE_KEYS })
  @IsOptional()
  template?: string

  @ApiPropertyOptional({
    type: () => SiteThemeDto,
    description: 'Parcial: solo los campos que se mandan cambian.',
  })
  @IsOptional()
  @IsObject({ message: 'El tema tiene que ser un objeto' })
  theme?: Record<string, unknown>

  @ApiPropertyOptional({
    type: () => SiteContentDto,
    description:
      'Parcial por bloque: cada bloque que se manda (brand, hero, steps…) reemplaza al anterior entero.',
  })
  @IsOptional()
  @IsObject({ message: 'El contenido tiene que ser un objeto' })
  content?: Record<string, unknown>

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'mi-inmobiliaria',
    description:
      'Único en todo el sistema. `null` lo quita. Se aplica al instante.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(63)
  subdomain?: string | null

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'www.mi-inmobiliaria.com.ar',
    description:
      'Dominio propio, sin https://. Hay que apuntar el DNS a mano. `null` lo quita.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  customDomain?: string | null
}

export class ResetSiteTemplateDto {
  @ApiProperty({
    description: 'true: conserva textos e imágenes y restaura solo el tema.',
  })
  @IsBoolean({ message: 'keepContent tiene que ser true o false' })
  keepContent: boolean
}

// ------------------------------------------------------------- Respuestas

export class SiteThemeDto {
  @ApiProperty({ example: '#B6A28E' }) primary: string
  @ApiProperty() secondary: string
  @ApiProperty() background: string
  @ApiProperty() surface: string
  @ApiProperty() text: string
  @ApiProperty({ example: 'system' }) fontKey: string
  @ApiProperty({ enum: [0, 8, 16, 24] }) radius: number
}

class SiteBrandDto {
  @ApiProperty({ maxLength: 80 }) displayName: string
  @ApiProperty({ type: String, nullable: true, maxLength: 120 }) tagline:
    string | null
  @ApiProperty({ type: String, nullable: true }) logoUrl: string | null
  @ApiProperty({ type: String, nullable: true }) faviconUrl: string | null
}

class SiteSocialDto {
  @ApiProperty({ enum: SOCIAL_NETWORKS }) network: string
  @ApiProperty() url: string
}

class SiteContactDto {
  @ApiProperty({ type: String, nullable: true }) address: string | null
  @ApiProperty({ type: String, nullable: true }) hours: string | null
  @ApiProperty({ type: String, nullable: true }) phone: string | null
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Solo dígitos con código de país',
  })
  whatsapp: string | null
  @ApiProperty({ type: String, nullable: true }) whatsappMessage: string | null
  @ApiProperty({ type: String, nullable: true }) email: string | null
  @ApiProperty({ type: [SiteSocialDto] }) socials: SiteSocialDto[]
}

class SiteHeroDto {
  @ApiProperty() title: string
  @ApiProperty({ type: String, nullable: true }) subtitle: string | null
  @ApiProperty({ type: String, nullable: true }) ctaLabel: string | null
  @ApiProperty({ type: String, nullable: true }) backgroundImageUrl:
    string | null
  @ApiProperty() showSearch: boolean
}

class SiteStepDto {
  @ApiProperty() title: string
  @ApiProperty() description: string
  @ApiProperty({ enum: STEP_ICONS }) icon: string
}

class SiteFeaturedDto {
  @ApiProperty() title: string
  @ApiProperty({ type: String, nullable: true }) subtitle: string | null
  @ApiProperty({ minimum: 3, maximum: 12 }) count: number
  @ApiProperty({ enum: ['LATEST', 'MANUAL'] }) mode: string
  @ApiProperty({ type: [String] }) propertyIds: string[]
}

class SiteMetricDto {
  @ApiProperty() value: string
  @ApiProperty() label: string
}

class SiteServiceDto {
  @ApiProperty() title: string
  @ApiProperty() description: string
  @ApiProperty({ type: String, nullable: true }) imageUrl: string | null
}

class SiteTestimonialDto {
  @ApiProperty() name: string
  @ApiProperty() text: string
  @ApiProperty({ type: String, nullable: true }) role: string | null
  @ApiProperty({ type: String, nullable: true }) photoUrl: string | null
}

class SiteFaqDto {
  @ApiProperty() question: string
  @ApiProperty() answer: string
}

class SiteAboutDto {
  @ApiProperty() title: string
  @ApiProperty({ type: String, nullable: true }) body: string | null
  @ApiProperty({ type: String, nullable: true }) imageUrl: string | null
}

class SiteSeoDto {
  @ApiProperty() title: string
  @ApiProperty() description: string
  @ApiProperty({ type: String, nullable: true }) ogImageUrl: string | null
}

class SiteSectionDto {
  @ApiProperty({ enum: SITE_SECTION_KEYS }) key: string
  @ApiProperty() visible: boolean
}

export class SiteContentDto {
  @ApiProperty({ type: SiteBrandDto }) brand: SiteBrandDto
  @ApiProperty({ type: SiteContactDto }) contact: SiteContactDto
  @ApiProperty({ type: SiteHeroDto }) hero: SiteHeroDto
  @ApiProperty({ type: [SiteStepDto] }) steps: SiteStepDto[]
  @ApiProperty({ type: SiteFeaturedDto }) featured: SiteFeaturedDto
  @ApiProperty({ type: [SiteMetricDto] }) metrics: SiteMetricDto[]
  @ApiProperty({ type: [SiteServiceDto] }) services: SiteServiceDto[]
  @ApiProperty({ type: [SiteTestimonialDto] })
  testimonials: SiteTestimonialDto[]
  @ApiProperty({ type: [SiteFaqDto] }) faqs: SiteFaqDto[]
  @ApiProperty({ type: SiteAboutDto }) about: SiteAboutDto
  @ApiProperty({ type: SiteSeoDto }) seo: SiteSeoDto
  @ApiProperty({ type: [SiteSectionDto] }) sections: SiteSectionDto[]
}

export class SiteSettingsDraftDto {
  @ApiProperty({ enum: SITE_TEMPLATE_KEYS }) template: string
  @ApiProperty({ type: SiteThemeDto }) theme: SiteThemeDto
  @ApiProperty({ type: SiteContentDto }) content: SiteContentDto
}

export class SiteSettingsDto {
  @ApiProperty() enabled: boolean
  @ApiProperty({ type: String, nullable: true }) subdomain: string | null
  @ApiProperty({ type: String, nullable: true }) customDomain: string | null
  @ApiProperty({ type: SiteSettingsDraftDto }) draft: SiteSettingsDraftDto
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'null = nunca publicado',
  })
  publishedAt: string | null
  @ApiProperty({
    description: 'El borrador difiere de lo publicado (o nunca se publicó)',
  })
  hasUnpublishedChanges: boolean
  @ApiProperty({ type: String, nullable: true }) publicUrl: string | null
}

class SiteFontOptionDto {
  @ApiProperty() key: string
  @ApiProperty() label: string
}

export class SiteTemplateInfoDto {
  @ApiProperty({ enum: SITE_TEMPLATE_KEYS }) key: string
  @ApiProperty() name: string
  @ApiProperty() description: string
  @ApiProperty({ type: String, nullable: true }) previewImageUrl: string | null
  @ApiProperty({ type: SiteThemeDto }) defaultTheme: SiteThemeDto
  @ApiProperty({ enum: SITE_SECTION_KEYS, isArray: true })
  supportedSections: string[]
  @ApiProperty({ type: [SiteFontOptionDto] }) fontOptions: SiteFontOptionDto[]
}

class PublicSiteTenantDto {
  @ApiProperty() slug: string
  @ApiProperty() name: string
  @ApiProperty({ type: String, nullable: true }) logoUrl: string | null
}

export class PublicSiteDto {
  @ApiProperty({ enum: SITE_TEMPLATE_KEYS }) template: string
  @ApiProperty({ type: SiteThemeDto }) theme: SiteThemeDto
  @ApiProperty({ type: SiteContentDto }) content: SiteContentDto
  @ApiProperty({ type: PublicSiteTenantDto }) tenant: PublicSiteTenantDto
  @ApiProperty() publishedAt: string
}

export class SiteAssetDto {
  @ApiProperty() id: string
  @ApiProperty() url: string
  @ApiProperty({ type: Number, nullable: true }) width: number | null
  @ApiProperty({ type: Number, nullable: true }) height: number | null
}

export class SitePreviewTokenDto {
  @ApiProperty({ description: 'JWT corto; se manda como ?preview= al sitio' })
  token: string
  @ApiProperty() expiresAt: string
}

export class SubdomainAvailabilityDto {
  @ApiProperty() value: string
  @ApiProperty() available: boolean
  @ApiProperty({ type: String, nullable: true }) reason: string | null
}

export class SiteHostDto {
  @ApiProperty() slug: string
}
