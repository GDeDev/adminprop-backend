import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Qué fallaba: el .env.example traía los orígenes del template (3000 y 5173) y
// copiarlos tal cual dejaba al backoffice (3001) y al portal (3002) sin CORS.
describe('.env.example', () => {
  const text = readFileSync(join(__dirname, '..', '.env.example'), 'utf8')
  const line = text.split('\n').find((l) => l.startsWith('CORS_ORIGINS='))

  it('lista los orígenes del backoffice y del portal', () => {
    const origins = (line ?? '').replace('CORS_ORIGINS=', '').split(',')
    expect(origins).toEqual(['http://localhost:3001', 'http://localhost:3002'])
  })

  it('no trae secretos reales: los JWT son marcadores de posición', () => {
    expect(text).toMatch(/JWT_ACCESS_SECRET=REEMPLAZAME/)
    expect(text).toMatch(/JWT_REFRESH_SECRET=REEMPLAZAME/)
  })
})
