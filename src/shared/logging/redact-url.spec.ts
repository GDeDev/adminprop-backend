import { Writable } from 'node:stream'

import pino from 'pino'

import { redactUrlQuery, serializeRequest } from './redact-url'

describe('redactUrlQuery', () => {
  it('tapa el token de vista previa y conserva el resto de la query', () => {
    expect(
      redactUrlQuery('/api/v1/public/s/site?preview=eyJ.abc.def&x=1'),
    ).toBe('/api/v1/public/s/site?preview=[REDACTED]&x=1')
  })

  it('no distingue mayúsculas ni nombres codificados', () => {
    expect(redactUrlQuery('/a?Token=abc&%70review=zzz')).toBe(
      '/a?Token=[REDACTED]&%70review=[REDACTED]',
    )
  })

  it('deja igual lo que no tiene query o no es sensible', () => {
    expect(redactUrlQuery('/a/b')).toBe('/a/b')
    expect(redactUrlQuery('/a?page=2&sort=name')).toBe('/a?page=2&sort=name')
  })

  // Antes el callback OAuth de Mercado Libre dejaba `code` (canjeable por
  // tokens) y `state` en cada línea de log.
  it('tapa el code y el state del callback OAuth', () => {
    expect(
      redactUrlQuery(
        '/api/v1/listings/oauth/mercadolibre/callback?code=TG-1&state=abc.def',
      ),
    ).toBe(
      '/api/v1/listings/oauth/mercadolibre/callback?code=[REDACTED]&state=[REDACTED]',
    )
  })

  it('respeta el fragmento', () => {
    expect(redactUrlQuery('/a?preview=x#top')).toBe('/a?preview=[REDACTED]#top')
  })
})

describe('serializeRequest', () => {
  const token = 'eyJ.SECRETO-DE-PREVIA.firma'
  const req = {
    method: 'GET',
    url: `/api/v1/public/s/site?preview=${token}&page=1`,
    originalUrl: `/api/v1/public/s/site?preview=${token}&page=1`,
    query: { preview: token, page: '1' },
    headers: {},
    socket: {},
  }

  it('tapa url y query', () => {
    const out = serializeRequest(req as never) as {
      url: string
      query: Record<string, string>
    }
    expect(out.url).toBe('/api/v1/public/s/site?preview=[REDACTED]&page=1')
    expect(out.query).toEqual({ preview: '[REDACTED]', page: '1' })
  })

  it('la línea de log que escribe pino no contiene el token', () => {
    const lines: string[] = []
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk))
        done()
      },
    })
    // Misma configuración que usa pino-http en logger.module.ts.
    const logger = pino({ serializers: { req: serializeRequest } }, stream)
    logger.info({ req }, 'request completed')

    const output = lines.join('')
    expect(output).toContain('preview=[REDACTED]')
    expect(output).not.toContain('SECRETO-DE-PREVIA')
  })
})
