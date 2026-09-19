import { ArgumentsHost, HttpStatus } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PinoLogger } from 'nestjs-pino'

import { AppException } from '../../errors/app.exception'
import { DomainErrorKind, DomainException } from '../../errors/domain.exception'
import { ErrorCode } from '../../errors/error-codes'
import { GlobalExceptionFilter } from './global-exception.filter'

class PaymentTooLowException extends DomainException {
  constructor() {
    super(
      'PAYMENT_TOO_LOW',
      'El pago no cubre la cuota',
      DomainErrorKind.BusinessRule,
      { internal: 'no se serializa' },
    )
  }
}

class ContractNotFoundException extends DomainException {
  constructor() {
    super(
      'CONTRACT_NOT_FOUND',
      'El contrato no existe',
      DomainErrorKind.NotFound,
    )
  }
}

function setup(isProduction = false) {
  const logger = {
    setContext: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger
  const config = {
    get: () => ({ isProduction }),
  } as unknown as ConfigService<any, true>

  const json = jest.fn()
  const response = {
    headersSent: false,
    status: jest.fn().mockReturnValue({ json }),
  }
  const request = {
    method: 'POST',
    originalUrl: '/api/v1/payments',
    headers: { 'x-correlation-id': 'corr-1' },
  }
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost

  return {
    filter: new GlobalExceptionFilter(logger, config),
    host,
    response,
    json,
  }
}

describe('GlobalExceptionFilter', () => {
  it('traduce una regla de negocio violada a 422 con el formato de la spec', () => {
    const { filter, host, response, json } = setup()

    filter.catch(new PaymentTooLowException(), host)

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.UNPROCESSABLE_ENTITY,
    )
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: 'PAYMENT_TOO_LOW',
        message: 'El pago no cubre la cuota',
        errors: [],
        correlationId: 'corr-1',
        path: '/api/v1/payments',
      }),
    )
  })

  it('la metadata de una excepción de dominio nunca llega al cliente', () => {
    const { filter, host, json } = setup()

    filter.catch(new PaymentTooLowException(), host)

    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain(
      'no se serializa',
    )
  })

  it.each([
    [DomainErrorKind.NotFound, 404],
    [DomainErrorKind.Conflict, 409],
    [DomainErrorKind.BusinessRule, 422],
    [DomainErrorKind.Forbidden, 403],
  ])('mapea %s a %i', (kind, status) => {
    class AnyDomainError extends DomainException {
      constructor() {
        super('ANY', 'x', kind)
      }
    }
    const { filter, host, response } = setup()

    filter.catch(new AnyDomainError(), host)

    expect(response.status).toHaveBeenCalledWith(status)
  })

  it('una excepción de dominio conserva el nombre de su clase', () => {
    // Sirve en los logs: "ContractNotFoundException" dice más que "Error".
    expect(new ContractNotFoundException().name).toBe(
      'ContractNotFoundException',
    )
  })

  it('las AppException también salen con statusCode y error', () => {
    const { filter, host, json } = setup()

    filter.catch(AppException.notFound('No existe', ErrorCode.NOT_FOUND), host)

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        error: 'Not Found',
        code: ErrorCode.NOT_FOUND,
      }),
    )
  })

  it('en producción un error inesperado no filtra su mensaje', () => {
    const { filter, host, json } = setup(true)

    filter.catch(new Error('password=hunter2 en la query'), host)

    const body = json.mock.calls[0][0]
    expect(body.statusCode).toBe(500)
    expect(body.error).toBe('Internal Server Error')
    expect(body.message).not.toContain('hunter2')
  })
})
