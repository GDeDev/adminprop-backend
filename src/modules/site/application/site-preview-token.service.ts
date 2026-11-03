import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import { Configuration } from '@/shared/config/configuration'

const TYPE = 'site-preview'
/** Alcanza para editar y mirar; vencido, el editor pide otro. */
export const PREVIEW_TTL_SECONDS = 15 * 60

/**
 * Token de la vista previa del borrador. Va firmado con su propio secreto y
 * lleva `typ`, así que nunca sirve como access token ni al revés; solo abre
 * el borrador de la inmobiliaria que lo pidió.
 */
@Injectable()
export class SitePreviewTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Configuration, true>,
  ) {}

  private get secret(): string {
    return this.config.get('sites', { infer: true }).previewSecret
  }

  async sign(
    tenantId: string,
    userId: string | null,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = await this.jwt.signAsync(
      { typ: TYPE, tid: tenantId, sub: userId ?? undefined },
      { secret: this.secret, expiresIn: PREVIEW_TTL_SECONDS },
    )
    return {
      token,
      expiresAt: new Date(Date.now() + PREVIEW_TTL_SECONDS * 1000),
    }
  }

  /** El id de la inmobiliaria del token, o null si es inválido o venció. */
  async verify(token: string): Promise<string | null> {
    try {
      const payload = await this.jwt.verifyAsync<{
        typ?: string
        tid?: string
      }>(token, { secret: this.secret })
      return payload.typ === TYPE && payload.tid ? payload.tid : null
    } catch {
      return null
    }
  }
}
