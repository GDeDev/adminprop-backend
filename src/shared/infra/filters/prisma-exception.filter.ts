import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common'
import { Request, Response } from 'express'
import {
  PrismaClientInitializationError,
  PrismaClientKnownRequestError,
  PrismaClientValidationError,
} from '@prisma/client/runtime/library'

import { ApiErrorDto } from '../../dtos/api-response.dto'
import { ErrorCode, ErrorDetail } from '../../errors/error-codes'
import { CustomLoggerService } from '../../core/logger.service'
import { getCorrelationId } from '../middleware/correlation-id.middleware'

interface MappedPrismaError {
  status: HttpStatus
  code: ErrorCode
  message: string
  details?: ErrorDetail[]
}

/**
 * Traduce los errores de Prisma a respuestas HTTP con sentido.
 *
 * Importante: los mensajes de Prisma incluyen nombres de tablas y columnas, o
 * sea, información del esquema. En producción devolvemos mensajes genéricos y
 * el detalle real queda sólo en el log.
 *
 * Códigos: https://www.prisma.io/docs/orm/reference/error-reference
 */
@Catch(
  PrismaClientKnownRequestError,
  PrismaClientValidationError,
  PrismaClientInitializationError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new CustomLoggerService('PrismaExceptionFilter')

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()
    const correlationId = getCorrelationId(request)

    const mapped = this.map(exception)
    const isServerError = mapped.status >= 500

    const logContext = {
      correlationId,
      operation: 'database_error',
      method: request.method,
      url: request.originalUrl ?? request.url,
      statusCode: mapped.status,
      errorCode: mapped.code,
      prismaCode:
        exception instanceof PrismaClientKnownRequestError
          ? exception.code
          : undefined,
      meta:
        exception instanceof PrismaClientKnownRequestError
          ? exception.meta
          : undefined,
    }

    if (isServerError) {
      this.logger.error(
        `Error de base de datos: ${mapped.code}`,
        exception instanceof Error ? exception.stack : undefined,
        logContext,
      )
    } else {
      this.logger.warn(`Error de base de datos: ${mapped.code}`, logContext)
    }

    if (response.headersSent) {
      response.end()
      return
    }

    const body: ApiErrorDto = {
      success: false,
      code: mapped.code,
      message:
        isServerError && this.isProduction
          ? 'Error al acceder a la base de datos'
          : mapped.message,
      errors: mapped.details ?? [],
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl ?? request.url,
    }

    response.status(mapped.status).json(body)
  }

  private map(exception: unknown): MappedPrismaError {
    if (exception instanceof PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.DATABASE_ERROR,
        message: this.isProduction
          ? 'Los datos enviados no son válidos para esta operación'
          : exception.message,
      }
    }

    if (exception instanceof PrismaClientInitializationError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'La base de datos no está disponible en este momento',
      }
    }

    if (!(exception instanceof PrismaClientKnownRequestError)) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.DATABASE_ERROR,
        message: 'Error al acceder a la base de datos',
      }
    }

    switch (exception.code) {
      // Violación de restricción única
      case 'P2002': {
        const fields = this.targetFields(exception)
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
          message: fields.length
            ? `Ya existe un registro con ese valor en: ${fields.join(', ')}`
            : 'Ya existe un registro con esos datos',
          details: fields.map((field) => ({
            field,
            code: ErrorCode.UNIQUE_CONSTRAINT_VIOLATION,
            message: `El valor de "${field}" ya está en uso`,
          })),
        }
      }

      // Violación de clave foránea
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: ErrorCode.FOREIGN_KEY_CONSTRAINT_VIOLATION,
          message: 'Alguna de las referencias enviadas no existe',
        }

      // Borrado bloqueado por registros relacionados
      case 'P2014':
      case 'P2017':
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.RELATED_RECORDS_EXIST,
          message:
            'No se puede completar la operación porque hay registros relacionados',
        }

      // Registro inexistente
      case 'P2001':
      case 'P2015':
      case 'P2018':
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: ErrorCode.RECORD_NOT_FOUND,
          message: 'El registro solicitado no existe',
        }

      // Valor demasiado largo para la columna
      case 'P2000':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Alguno de los valores enviados excede el largo permitido',
        }

      // Valor fuera de rango para el tipo de la columna
      case 'P2020':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Alguno de los valores enviados está fuera de rango',
        }

      // Restricción NOT NULL
      case 'P2011':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Falta un campo obligatorio',
        }

      // Falta un argumento requerido
      case 'P2012':
      case 'P2013':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Falta un argumento obligatorio para esta operación',
        }

      // Timeout esperando una conexión del pool
      case 'P2024':
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message:
            'La base de datos está saturada. Intentá de nuevo en unos segundos.',
        }

      // Se perdió la conexión con la base
      case 'P1001':
      case 'P1002':
      case 'P1017':
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: 'La base de datos no está disponible en este momento',
        }

      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ErrorCode.DATABASE_ERROR,
          message: this.isProduction
            ? 'Error al acceder a la base de datos'
            : `${exception.code}: ${exception.message}`,
        }
    }
  }

  /** Extrae los campos involucrados en un P2002 desde `meta.target`. */
  private targetFields(exception: PrismaClientKnownRequestError): string[] {
    const target = exception.meta?.target

    if (Array.isArray(target)) return target.map(String)
    if (typeof target === 'string') return [target]
    return []
  }
}
