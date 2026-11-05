import { readAtMost } from './document-branding'

function responseOf(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Response(stream, { headers })
}

describe('readAtMost', () => {
  it('devuelve el cuerpo si entra en el límite', async () => {
    const result = await readAtMost(
      responseOf([Buffer.from('ab'), Buffer.from('cd')]),
      10,
    )
    expect(result?.toString()).toBe('abcd')
  })

  // Antes el cuerpo se bajaba entero con arrayBuffer() y el tope se comprobaba
  // después, con el logo ya en memoria.
  it('corta la lectura al pasar el límite aunque no haya content-length', async () => {
    const result = await readAtMost(
      responseOf([Buffer.alloc(6), Buffer.alloc(6)]),
      10,
    )
    expect(result).toBeNull()
  })

  it('rechaza de entrada si el content-length declarado excede el límite', async () => {
    const result = await readAtMost(
      responseOf([Buffer.from('a')], { 'content-length': '999' }),
      10,
    )
    expect(result).toBeNull()
  })
})
