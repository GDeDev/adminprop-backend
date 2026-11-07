import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'

import { RequestContext } from '@/shared/context/request-context'
import { toIsoDate } from '@/shared/dates/calendar-date'
import { PropertyViewRepository } from '../domain/crm.ports'

/** Una persona cuenta una sola vez por propiedad en esta ventana (A-83). */
export const VIEW_DEDUPE_MINUTES = 30
const MAX_REMEMBERED = 10_000
const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|curl|wget|python-requests|httpclient/i

/**
 * Cuenta las vistas de la ficha pública (Fase 23, 3.3): un contador por
 * propiedad y día, sin guardar IP ni cookie. Para no contar recargas se
 * recuerda un hash de (inmobiliaria, propiedad, IP) sólo en memoria: se pierde
 * al reiniciar y no se comparte entre instancias, a propósito (A-83).
 */
@Injectable()
export class PropertyViewsRecorder {
  private readonly seen = new Map<string, number>()

  constructor(private readonly views: PropertyViewRepository) {}

  /** Devuelve true si la vista se contó. Dentro del tenant del contexto. */
  async record(
    propertyId: string,
    visitor: { ip: string | null; userAgent: string | null },
    now: Date = new Date(),
  ): Promise<boolean> {
    if (visitor.userAgent && BOT_PATTERN.test(visitor.userAgent)) return false

    const key = createHash('sha256')
      .update(`${RequestContext.tenantId}|${propertyId}|${visitor.ip ?? ''}`)
      .digest('hex')
    const last = this.seen.get(key)
    const windowMs = VIEW_DEDUPE_MINUTES * 60_000
    if (last !== undefined && now.getTime() - last < windowMs) return false

    this.remember(key, now.getTime(), windowMs)
    await this.views.increment(propertyId, toIsoDate(now))
    return true
  }

  private remember(key: string, at: number, windowMs: number): void {
    if (this.seen.size >= MAX_REMEMBERED) {
      for (const [k, t] of this.seen) {
        if (at - t >= windowMs) this.seen.delete(k)
      }
      // Si siguen todas vigentes, se descarta la más vieja para no crecer.
      if (this.seen.size >= MAX_REMEMBERED) {
        const oldest = this.seen.keys().next().value
        if (oldest !== undefined) this.seen.delete(oldest)
      }
    }
    this.seen.set(key, at)
  }
}
