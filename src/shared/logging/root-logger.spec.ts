import { Writable } from 'node:stream'

import pino from 'pino'

import { REDACTED_PATHS } from './root-logger'

describe('REDACTED_PATHS', () => {
  function logged(object: Record<string, unknown>): string {
    const lines: string[] = []
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk))
        done()
      },
    })
    pino({ redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' } }, stream)
      .child({})
      .info(object, 'x')
    return lines.join('')
  }

  it('tapa DNI, CUIT, CBU y teléfono al nivel raíz y un nivel adentro', () => {
    const output = logged({
      dni: '30111222',
      owner: { cuit: '20-30111222-3', cbu: '0170099220000067797370' },
      phone: '+54911',
    })
    expect(output).not.toContain('30111222')
    expect(output).not.toContain('0170099220000067797370')
    expect(output).not.toContain('+54911')
  })

  it('no tapa campos comunes de depuración', () => {
    expect(logged({ userId: 'u-1' })).toContain('u-1')
  })
})
