import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'

import { RequestContext } from '@/shared/context/request-context'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  IdempotencyKeyInProgressException,
  IdempotencyKeyReusedException,
  InvalidIdempotencyKeyException,
} from './idempotency.exceptions'

/** Cuánto vale una clave: lo que tarda en reintentar un cliente, con holgura. */
export const IDEMPOTENCY_TTL_HOURS = 24

const KEY_PATTERN = /^[\x21-\x7e]{1,128}$/

export type IdempotencyStart =
  /** Primera vez: hacer el trabajo y cerrarlo con `complete`. */
  | { replay: false }
  /** Ya se hizo: devolver `response` (lo que se guardó con `complete`). */
  | { replay: true; response: unknown }

/**
 * Idempotencia de los POST que mueven dinero (auditoría de datos, A3).
 *
 * El cliente manda `Idempotency-Key`; si el request se repite (reintento de
 * red, doble click) con la misma clave y el mismo cuerpo, la segunda vez no
 * repite el efecto: devuelve lo de la primera.
 *
 * **Tiene que llamarse dentro de `prisma.transaction()`**, junto con el
 * trabajo que protege. La fila de la clave se inserta en esa transacción, así
 * que o están el efecto y la clave, o no hay ninguno. Y dos requests con la
 * misma clave en paralelo se serializan solos: el segundo INSERT espera en el
 * índice único a que el primero confirme o deshaga.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Una clave opcional, normalizada: `undefined`/vacía = sin idempotencia. */
  static normalizeKey(raw: string | string[] | undefined): string | null {
    const value = Array.isArray(raw) ? raw[0] : raw
    const key = value?.trim()
    if (!key) return null
    if (!KEY_PATTERN.test(key)) throw new InvalidIdempotencyKeyException()
    return key
  }

  /** Huella del pedido: la misma clave con otro cuerpo es un error. */
  static hashRequest(...parts: (string | Buffer)[]): string {
    const hash = createHash('sha256')
    for (const part of parts) {
      const bytes = Buffer.from(part)
      // El largo evita que ("ab","c") y ("a","bc") den la misma huella.
      hash.update(String(bytes.length)).update(':').update(bytes)
    }
    return hash.digest('hex')
  }

  async begin(
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<IdempotencyStart> {
    const tenantId = RequestContext.tenantId
    if (!tenantId) throw new Error('Idempotencia sin tenant en el contexto')

    // SQL directo por el ON CONFLICT: o se inserta, o se pisa una clave
    // vencida, o no se toca nada, todo en una sentencia atómica. Una clave
    // vencida vale como nueva.
    const claimed = await this.prisma.db.$queryRaw<{ id: string }[]>`
      INSERT INTO idempotency_keys (tenant_id, scope, key, request_hash, expires_at)
      VALUES (
        ${tenantId}::uuid, ${scope}, ${key}, ${requestHash},
        now() + make_interval(hours => ${IDEMPOTENCY_TTL_HOURS}::int)
      )
      ON CONFLICT (tenant_id, scope, key) DO UPDATE
        SET request_hash = EXCLUDED.request_hash,
            response = NULL,
            created_at = now(),
            expires_at = EXCLUDED.expires_at
        WHERE idempotency_keys.expires_at < now()
      RETURNING id
    `
    if (claimed.length > 0) return { replay: false }

    const existing = await this.prisma.db.idempotencyKey.findUnique({
      where: { tenantId_scope_key: { tenantId, scope, key } },
    })
    if (!existing) {
      // La borró otra transacción entre las dos consultas (rollback ajeno):
      // el cliente puede reintentar.
      throw new IdempotencyKeyInProgressException()
    }
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyKeyReusedException()
    }
    if (existing.response === null)
      throw new IdempotencyKeyInProgressException()
    return { replay: true, response: existing.response }
  }

  /**
   * Reclama una clave de un solo uso (un nonce): `true` la primera vez,
   * `false` si ya se usó y no venció. Atómico (una sentencia), así dos pedidos
   * a la vez no la ganan los dos. No necesita transacción.
   */
  async claimOnce(scope: string, key: string, ttlMs: number): Promise<boolean> {
    const tenantId = RequestContext.tenantId
    if (!tenantId) throw new Error('Idempotencia sin tenant en el contexto')
    const expiresAt = new Date(Date.now() + ttlMs)
    const claimed = await this.prisma.db.$queryRaw<{ id: string }[]>`
      INSERT INTO idempotency_keys (tenant_id, scope, key, request_hash, expires_at, response)
      VALUES (${tenantId}::uuid, ${scope}, ${key}, '', ${expiresAt}, '{}'::jsonb)
      ON CONFLICT (tenant_id, scope, key) DO UPDATE
        SET created_at = now(), expires_at = EXCLUDED.expires_at
        WHERE idempotency_keys.expires_at < now()
      RETURNING id
    `
    return claimed.length > 0
  }

  /** Guarda con qué se reconstruye la respuesta si la clave se repite. */
  async complete(
    scope: string,
    key: string,
    response: Record<string, unknown>,
  ): Promise<void> {
    const tenantId = RequestContext.tenantId
    if (!tenantId) throw new Error('Idempotencia sin tenant en el contexto')
    await this.prisma.db.idempotencyKey.update({
      where: { tenantId_scope_key: { tenantId, scope, key } },
      data: { response: response as object },
    })
  }

  /**
   * Borra las vencidas del tenant. Barato (índice por `expires_at`); se llama
   * de pasada en cada alta con clave, así la tabla no necesita un job.
   */
  async purgeExpired(): Promise<void> {
    await this.prisma.db.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
  }
}
