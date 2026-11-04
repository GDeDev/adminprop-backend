import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

import { StoragePort } from './storage.port'

/**
 * Firma, justo antes de salir, toda URL de un archivo privado que viaje en la
 * respuesta JSON (D-196).
 *
 * En la base queda la URL "cruda" que devolvió el proveedor, que para un
 * archivo `authenticated` no abre. Firmar acá, en un único punto, evita tocar
 * cada vista que muestra un recibo o un PDF y garantiza que una vista nueva no
 * filtre una URL sin firmar. Las URLs públicas pasan sin cambios.
 */
@Injectable()
export class SignedUrlsInterceptor implements NestInterceptor {
  constructor(private readonly storage: StoragePort) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(map((body) => this.sign(body)))
  }

  private sign(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.startsWith('https://') ? this.storage.signUrl(value) : value
    }
    if (Array.isArray(value)) return value.map((item) => this.sign(item))
    if (value !== null && typeof value === 'object' && isPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.sign(item)]),
      )
    }
    // Date, Buffer, StreamableFile y demás se devuelven como están.
    return value
  }
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}
