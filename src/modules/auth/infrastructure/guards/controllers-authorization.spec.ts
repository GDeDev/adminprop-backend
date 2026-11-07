import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { Reflector } from '@nestjs/core'

import { ANY_ROLE_KEY } from '../decorators/any-role.decorator'
import { IS_PUBLIC_KEY } from '../decorators/is-public.decorator'
import { ROLES_KEY } from '../decorators/roles.decorator'

// Test de arquitectura: recorre todos los controllers y falla si algún
// endpoint no declara explícitamente quién puede usarlo. El RolesGuard ya
// rechaza a OWNER/RENTER en endpoints sin decorador, pero este test hace que
// el olvido se note en el CI en vez de aparecer como un 403 inesperado.
const SRC = join(__dirname, '../../../..')

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return controllerFiles(full)
    return entry.endsWith('.controller.ts') ? [full] : []
  })
}

describe('Autorización declarada en todos los controllers', () => {
  const reflector = new Reflector()
  const files = controllerFiles(SRC)

  it('encuentra los controllers', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('cada endpoint declara @Roles, @AnyRole o @IsPublic', () => {
    const undeclared: string[] = []

    for (const file of files) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(file) as Record<string, unknown>
      for (const exported of Object.values(mod)) {
        if (typeof exported !== 'function') continue
        const proto = exported.prototype as Record<string, unknown>
        for (const name of Object.getOwnPropertyNames(proto)) {
          const handler = proto[name]
          // 'method' es la clave que Nest guarda con @Get/@Post/...
          if (
            typeof handler !== 'function' ||
            Reflect.getMetadata('method', handler) === undefined
          ) {
            continue
          }
          const targets = [handler, exported]
          const roles = reflector.getAllAndOverride<unknown[]>(
            ROLES_KEY,
            targets,
          )
          const declared =
            roles?.length ||
            reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
            reflector.getAllAndOverride<boolean>(ANY_ROLE_KEY, targets)
          if (!declared) undeclared.push(`${exported.name}.${name}`)
        }
      }
    }

    expect(undeclared).toEqual([])
  })
})
