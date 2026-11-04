import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Regresión: `ImportCountsDto.byEntity` apuntaba a un schema que nunca entraba
 * a `components.schemas`, y `openapi-typescript` abortaba con "Can't resolve
 * $ref". Un $ref huérfano deja inservible el contrato para el frontend.
 *
 * Se valida el `openapi.json` versionado; que coincida con el código lo
 * verifica el CI (`openapi:export` + `git diff --exit-code`).
 */
describe('openapi.json', () => {
  const document: unknown = JSON.parse(
    readFileSync(resolve(__dirname, '..', 'openapi.json'), 'utf8'),
  )

  function collectRefs(node: unknown, out: string[] = []): string[] {
    if (Array.isArray(node)) {
      node.forEach((item) => collectRefs(item, out))
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') out.push(value)
        else collectRefs(value, out)
      }
    }
    return out
  }

  function resolves(ref: string): boolean {
    if (!ref.startsWith('#/')) return false
    let current: unknown = document
    for (const part of ref.slice(2).split('/')) {
      if (!current || typeof current !== 'object' || !(part in current)) {
        return false
      }
      current = (current as Record<string, unknown>)[part]
    }
    return true
  }

  it('todos los $ref apuntan a algo que existe', () => {
    const refs = collectRefs(document)
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.filter((ref) => !resolves(ref))).toEqual([])
  })
})
