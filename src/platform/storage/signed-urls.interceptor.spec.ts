import { CallHandler } from '@nestjs/common'
import { firstValueFrom, of } from 'rxjs'

import { SignedUrlsInterceptor } from './signed-urls.interceptor'
import { StoragePort } from './storage.port'

describe('SignedUrlsInterceptor', () => {
  const storage = {
    signUrl: (url: string) => `${url}?signed`,
  } as unknown as StoragePort
  const interceptor = new SignedUrlsInterceptor(storage)

  const run = (body: unknown) =>
    firstValueFrom(
      interceptor.intercept(
        {} as never,
        { handle: () => of(body) } as CallHandler,
      ),
    )

  it('firma las URLs https anidadas en objetos y listas', async () => {
    const result = await run({
      success: true,
      data: [{ receiptUrl: 'https://res.cloudinary.com/x', count: 2 }],
    })

    expect(result).toEqual({
      success: true,
      data: [{ receiptUrl: 'https://res.cloudinary.com/x?signed', count: 2 }],
    })
  })

  it('no toca strings que no son URLs, fechas ni buffers', async () => {
    const date = new Date()
    const buffer = Buffer.from('x')
    const result = (await run({ note: 'hola', date, buffer })) as Record<
      string,
      unknown
    >

    expect(result.note).toBe('hola')
    expect(result.date).toBe(date)
    expect(result.buffer).toBe(buffer)
  })
})
