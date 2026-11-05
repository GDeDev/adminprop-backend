import type { Request, Response } from 'express'

import { noStoreForPrivateApi } from './no-store.middleware'

function run(originalUrl: string) {
  const setHeader = jest.fn()
  const next = jest.fn()
  noStoreForPrivateApi(
    { originalUrl } as Request,
    { setHeader } as unknown as Response,
    next,
  )
  return { setHeader, next }
}

// Antes ninguna respuesta autenticada llevaba Cache-Control, así que un
// proxy o caché compartido podía guardarla.
describe('noStoreForPrivateApi', () => {
  it.each([
    '/api/v1/owners/123',
    '/api/v1/auth/me',
    '/api/v1/portal/owner/statements?page=2',
  ])('marca %s como no-store', (url) => {
    const { setHeader, next } = run(url)
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
    expect(next).toHaveBeenCalled()
  })

  it.each(['/api/v1/public/acme/properties', '/health/live', '/files/x.png'])(
    'no toca %s',
    (url) => {
      const { setHeader, next } = run(url)
      expect(setHeader).not.toHaveBeenCalled()
      expect(next).toHaveBeenCalled()
    },
  )
})
