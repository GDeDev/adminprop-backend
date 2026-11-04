import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'

import { ANY_ROLE_KEY } from '../decorators/any-role.decorator'
import { IS_PUBLIC_KEY } from '../decorators/is-public.decorator'
import { ROLES_KEY } from '../decorators/roles.decorator'

/**
 * Test de arquitectura (D-195): todo handler HTTP de todo controller declara
 * `@IsPublic`, `@Roles` o `@AnyRole`, en el handler o en la clase. Con el
 * `RolesGuard` cerrado por defecto, un olvido sería un 403 en producción; este
 * test lo convierte en un rojo en el CI antes de llegar.
 */
function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return controllerFiles(full)
    return name.endsWith('.controller.ts') ? [full] : []
  })
}

describe('controllers declaran su acceso', () => {
  const root = resolve(__dirname, '../../../..')
  const files = controllerFiles(root)

  it('encuentra los controllers', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('ningún handler queda sin @IsPublic, @Roles ni @AnyRole', () => {
    const offenders: string[] = []

    for (const file of files) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(file) as Record<string, unknown>
      for (const exported of Object.values(mod)) {
        if (typeof exported !== 'function') continue
        if (!Reflect.hasMetadata(PATH_METADATA, exported)) continue

        const proto = exported.prototype as Record<string, unknown>
        for (const name of Object.getOwnPropertyNames(proto)) {
          const handler = proto[name]
          if (typeof handler !== 'function') continue
          if (!Reflect.hasMetadata(METHOD_METADATA, handler)) continue

          const declared = [ROLES_KEY, ANY_ROLE_KEY, IS_PUBLIC_KEY].some(
            (key) =>
              Reflect.hasMetadata(key, handler) ||
              Reflect.hasMetadata(key, exported),
          )
          if (!declared) offenders.push(`${exported.name}.${name}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
