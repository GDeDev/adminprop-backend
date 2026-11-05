import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')

// Qué fallaba: el build con SWC (nest-cli.json, sourceRoot "src") deja el
// resultado en `dist/main.js`, pero los scripts de producción y el CMD del
// Dockerfile apuntaban a `dist/src/main`, que no existe: la imagen no arrancaba.
describe('punto de entrada compilado', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }

  it.each(['start:prod', 'start:qa', 'start:production'])(
    'el script %s arranca dist/main',
    (name) => {
      expect(pkg.scripts[name]).toMatch(/node dist\/main$/)
    },
  )

  it('el CMD del Dockerfile arranca dist/main', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
    expect(dockerfile).toMatch(/CMD \["node", "dist\/main"\]/)
    expect(dockerfile).not.toContain('dist/src')
  })
})
