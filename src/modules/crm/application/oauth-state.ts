import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

import { OAuthStateInvalidException } from '../domain/crm.exceptions'
import { ListingChannel } from '../domain/listing'

/** El navegador tiene 10 minutos para volver del portal (Fase 23, 6.2). */
export const OAUTH_STATE_TTL_MS = 10 * 60_000

export interface OAuthStatePayload {
  tenantId: string
  userId: string
  channel: ListingChannel
}

/** Lo que devuelve `verify`: el payload más su nonce de un solo uso (D-255). */
export interface VerifiedOAuthState extends OAuthStatePayload {
  nonce: string
}

/**
 * `state` del OAuth: `<payload en base64url>.<firma HMAC-SHA256>`. Lleva el
 * tenant, el usuario y la expiración, así el callback público (sin JWT) sabe
 * a quién conectar la cuenta y nadie puede fabricarlo ni cambiarlo. Una
 * firma, una expiración o un formato inválidos dan el mismo error.
 */
export class OAuthStateSigner {
  constructor(private readonly secret: string) {}

  sign(payload: OAuthStatePayload, now: Date = new Date()): string {
    const body = Buffer.from(
      JSON.stringify({
        ...payload,
        exp: now.getTime() + OAUTH_STATE_TTL_MS,
        nonce: randomUUID(),
      }),
    ).toString('base64url')
    return `${body}.${this.signature(body)}`
  }

  verify(state: string, now: Date = new Date()): VerifiedOAuthState {
    const [body, signature, extra] = state.split('.')
    if (!body || !signature || extra !== undefined) {
      throw new OAuthStateInvalidException()
    }
    const expected = Buffer.from(this.signature(body))
    const received = Buffer.from(signature)
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new OAuthStateInvalidException()
    }
    try {
      const data = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as OAuthStatePayload & { exp: number; nonce?: string }
      if (
        typeof data.exp !== 'number' ||
        data.exp < now.getTime() ||
        !data.tenantId ||
        !data.userId ||
        !data.channel ||
        typeof data.nonce !== 'string' ||
        !data.nonce
      ) {
        throw new OAuthStateInvalidException()
      }
      return {
        tenantId: data.tenantId,
        userId: data.userId,
        channel: data.channel,
        nonce: data.nonce,
      }
    } catch {
      throw new OAuthStateInvalidException()
    }
  }

  private signature(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url')
  }
}
