import { EmailDeliveryError } from '../email.port'
import { RESEND_API_URL, ResendEmailAdapter } from './resend.email-adapter'
import { FlakyEmailAdapter } from './flaky.email-adapter'

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status })

describe('ResendEmailAdapter', () => {
  const message = {
    to: 'ana@ejemplo.com',
    subject: 'Hola',
    text: 'Texto',
    html: '<p>Texto</p>',
    replyTo: 'contacto@inmo.com',
    fromName: 'Oppido Propiedades',
    attachments: [
      {
        filename: 'liquidacion.pdf',
        content: Buffer.from('pdf'),
        contentType: 'application/pdf',
      },
    ],
  }

  it('manda el mail con la API key y devuelve el id del proveedor', async () => {
    const fetchFn = jest.fn().mockResolvedValue(reply(200, { id: 'msg_1' }))
    const adapter = new ResendEmailAdapter('re_key', 'n@dominio.com', fetchFn)

    const result = await adapter.send(message)

    expect(result).toEqual({ providerMessageId: 'msg_1' })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(RESEND_API_URL)
    expect(init.headers.Authorization).toBe('Bearer re_key')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      from: 'Oppido Propiedades <n@dominio.com>',
      to: ['ana@ejemplo.com'],
      reply_to: 'contacto@inmo.com',
    })
    expect(body.attachments).toEqual([
      {
        filename: 'liquidacion.pdf',
        content: Buffer.from('pdf').toString('base64'),
      },
    ])
  })

  it.each([429, 500, 503])(
    'trata el %s como un error temporal (se reintenta)',
    async (status) => {
      const fetchFn = jest
        .fn()
        .mockResolvedValue(reply(status, { message: 'x' }))
      const adapter = new ResendEmailAdapter('k', 'n@d.com', fetchFn)

      await expect(adapter.send(message)).rejects.toMatchObject({
        retryable: true,
      })
    },
  )

  it.each([400, 401, 403, 422])(
    'trata el %s como un error definitivo (no se reintenta)',
    async (status) => {
      const fetchFn = jest
        .fn()
        .mockResolvedValue(reply(status, { message: 'x' }))
      const adapter = new ResendEmailAdapter('k', 'n@d.com', fetchFn)

      const error = await adapter.send(message).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(EmailDeliveryError)
      expect((error as EmailDeliveryError).retryable).toBe(false)
    },
  )

  it('trata un corte de red como temporal', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNRESET'))
    const adapter = new ResendEmailAdapter('k', 'n@d.com', fetchFn)

    await expect(adapter.send(message)).rejects.toMatchObject({
      retryable: true,
      code: 'network_error',
    })
  })
})

describe('FlakyEmailAdapter', () => {
  it('falla N veces y después manda', async () => {
    const adapter = new FlakyEmailAdapter()
    adapter.failNext(2)
    const mail = { to: 'a@b.com', subject: 's', text: 't' }

    await expect(adapter.send(mail)).rejects.toMatchObject({ retryable: true })
    await expect(adapter.send(mail)).rejects.toMatchObject({ retryable: true })
    const ok = await adapter.send(mail)

    expect(ok.providerMessageId).toMatch(/^console_/)
    expect(adapter.attempts).toBe(3)
    expect(adapter.sent).toHaveLength(1)
  })

  it('puede fallar de forma definitiva', async () => {
    const adapter = new FlakyEmailAdapter()
    adapter.failNext(1, { retryable: false })

    await expect(
      adapter.send({ to: 'a@b.com', subject: 's', text: 't' }),
    ).rejects.toMatchObject({ retryable: false })
  })
})
