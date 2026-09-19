import { ConsoleEmailAdapter } from './console.email-adapter'

describe('ConsoleEmailAdapter', () => {
  it('no envía nada pero deja registro de lo que se habría enviado', async () => {
    const email = new ConsoleEmailAdapter()

    await email.send({
      to: 'ana@ejemplo.com',
      subject: 'Recordatorio de pago',
      text: 'Tu cuota vence el 10.',
    })

    expect(email.sent).toEqual([
      expect.objectContaining({
        to: 'ana@ejemplo.com',
        subject: 'Recordatorio de pago',
      }),
    ])
  })
})
