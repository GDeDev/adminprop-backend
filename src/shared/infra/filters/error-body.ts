import { STATUS_CODES } from 'node:http'
import { Request } from 'express'

import { ApiErrorDto } from '../../dtos/api-response.dto'
import { ErrorCode, ErrorDetail } from '../../errors/error-codes'

export interface ErrorBodyInput {
  status: number
  code: ErrorCode | string
  message: string
  details?: ErrorDetail[]
}

/**
 * Arma el cuerpo de error que sale por la API. Lo usan todos los filtros, así
 * el formato se define en un solo lugar:
 *
 * - `statusCode`, `error`, `message`, `timestamp`, `path`: los de la spec
 *   (Fase 1, sección 8). `error` es el nombre del status HTTP ("Not Found").
 * - `success`, `code`, `errors`, `correlationId`: los que ya consumía el front.
 *   `code` es estable; `message` es para mostrar y puede cambiar.
 */
export function buildErrorBody(
  input: ErrorBodyInput,
  request: Request,
  correlationId: string,
): ApiErrorDto {
  return {
    success: false,
    statusCode: input.status,
    error: STATUS_CODES[input.status] ?? 'Error',
    code: input.code,
    message: input.message,
    errors: input.details ?? [],
    correlationId,
    timestamp: new Date().toISOString(),
    path: request.originalUrl ?? request.url,
  }
}
