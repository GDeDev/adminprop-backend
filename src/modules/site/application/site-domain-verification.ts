import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac } from 'node:crypto'

import { Configuration } from '@/shared/config/configuration'

export const VERIFICATION_PREFIX = '_adminprop-verify'

/** Lo que hay que cargar en el DNS para demostrar que el dominio es propio. */
export interface DomainRecord {
  type: 'TXT'
  host: string
  value: string
}

/**
 * Prueba de propiedad de un dominio propio: un registro TXT en
 * `_adminprop-verify.<dominio>` con un valor que solo esta inmobiliaria puede
 * conocer (HMAC del tenant y el dominio con un secreto del servidor). Sin esto,
 * cualquier administrador podría reservar el dominio de otro.
 */
@Injectable()
export class SiteDomainVerification {
  constructor(private readonly config: ConfigService<Configuration, true>) {}

  /** Si está apagado (desarrollo), el dominio se da por verificado al cargarlo. */
  get required(): boolean {
    return this.config.get('sites', { infer: true }).domainVerification
  }

  record(tenantId: string, domain: string): DomainRecord {
    const secret = this.config.get('sites', { infer: true }).previewSecret
    const digest = createHmac('sha256', secret)
      .update(`domain-verify:${tenantId}:${domain}`)
      .digest('hex')
      .slice(0, 32)
    return {
      type: 'TXT',
      host: `${VERIFICATION_PREFIX}.${domain}`,
      value: `adminprop-verify=${digest}`,
    }
  }
}
