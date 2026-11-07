import { ArgumentsHost, HttpStatus } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
} from '@prisma/client/runtime/library'
import { PinoLogger } from 'nestjs-pino'

import { ErrorCode } from '../../errors/error-codes'
import { PrismaExceptionFilter } from './prisma-exception.filter'

const POSTGRES_MESSAGE =
  'ERROR: new row for relation "contracts" violates check constraint "contracts_fee_percentage_check"\n' +
  'DETAIL: Failing row contains (222d07a8, 150.00)'

function run(exception: unknown, isProduction = true) {
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
    method: 'PATCH',
    originalUrl: '/api/v1/contracts/1',
    headers: { 'x-correlation-id': 'corr-1' },
  }
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost
  new PrismaExceptionFilter(logger, config).catch(exception, host)
  return {
    status: response.status.mock.calls[0][0] as number,
    body: json.mock.calls[0][0] as Record<string, any>,
    warn: (logger as unknown as { warn: jest.Mock }).warn,
  }
}

describe('PrismaExceptionFilter: violación de CHECK (23514)', () => {
  const variants: [string, unknown][] = [
    [
      'SQL crudo (P2010 con el SQLSTATE en meta.code)',
      new PrismaClientKnownRequestError('Raw query failed', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code: '23514', message: POSTGRES_MESSAGE },
      }),
    ],
    [
      'P2004 con la violación en meta',
      new PrismaClientKnownRequestError('A constraint failed', {
        code: 'P2004',
        clientVersion: 'test',
        meta: { database_error: POSTGRES_MESSAGE },
      }),
    ],
    [
      'error desconocido del ORM con el SQLSTATE en el mensaje',
      new PrismaClientUnknownRequestError(
        `Error occurred during query execution: ConnectorError(QueryError(PostgresError { code: "23514", message: "${POSTGRES_MESSAGE.replace(/\n/g, ' ')}" }))`,
        { clientVersion: 'test' },
      ),
    ],
  ]

  it.each(variants)('%s responde 422 con un code estable', (_name, error) => {
    const { status, body } = run(error)
    expect(status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    expect(body.code).toBe(ErrorCode.CHECK_CONSTRAINT_VIOLATION)
    expect(body.code).toBe('CHECK_CONSTRAINT_VIOLATION')
  })

  it.each(variants)(
    '%s no filtra el nombre de la constraint, de la tabla ni la fila',
    (_name, error) => {
      for (const isProduction of [true, false]) {
        const { body } = run(error, isProduction)
        const text = JSON.stringify({ ...body, path: undefined })
        expect(text).not.toContain('contracts_fee_percentage_check')
        expect(text).not.toContain('contracts')
        expect(text).not.toContain('222d07a8')
        expect(body.message).toMatch(/regla de validez/)
      }
    },
  )

  it('lo registra en el log como aviso, no como error de servidor', () => {
    const { warn } = run(variants[0][1])
    expect(warn).toHaveBeenCalled()
  })

  it('un error desconocido que no es un CHECK sigue siendo DATABASE_ERROR 500', () => {
    const { status, body } = run(
      new PrismaClientUnknownRequestError('algo raro pasó', {
        clientVersion: 'test',
      }),
    )
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
    expect(body.code).toBe(ErrorCode.DATABASE_ERROR)
  })

  it('el P2002 sigue siendo 409 UNIQUE_CONSTRAINT_VIOLATION', () => {
    const { status, body } = run(
      new PrismaClientKnownRequestError('Unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['email'] },
      }),
    )
    expect(status).toBe(HttpStatus.CONFLICT)
    expect(body.code).toBe(ErrorCode.UNIQUE_CONSTRAINT_VIOLATION)
  })
})
