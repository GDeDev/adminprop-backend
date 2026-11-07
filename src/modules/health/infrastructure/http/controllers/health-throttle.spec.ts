import { ExecutionContext } from '@nestjs/common'
import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants'

import { configuration } from '@/shared/config/configuration'
import { HealthController } from './health.controller'
import { GLOBAL_THROTTLE_PROFILES } from '@/shared/infra/throttler/skip-all-throttles.decorator'
import { throttlerOptions } from '@/shared/infra/throttler/throttler.module'

function contextFor(url: string): ExecutionContext {
  const request = { originalUrl: url, url }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

function skipIfOf(enabled: boolean) {
  const options = throttlerOptions({ ...configuration().throttle, enabled })
  if (Array.isArray(options)) throw new Error('se esperaba un objeto')
  return options.skipIf
}

describe('topes globales y probes de salud (D-249)', () => {
  // Antes `skipIf` salteaba todo pedido cuya URL contuviera `/health`:
  // `POST /auth/login?x=/health` probaba contraseñas sin ningún tope.
  it('no saltea un pedido por tener /health en la URL', () => {
    const skipIf = skipIfOf(true)
    expect(skipIf?.(contextFor('/api/v1/auth/login?x=/health'))).toBe(false)
    expect(skipIf?.(contextFor('/health'))).toBe(false)
  })

  it('con THROTTLE_ENABLED=false saltea todo', () => {
    expect(skipIfOf(false)?.(contextFor('/api/v1/auth/login'))).toBe(true)
  })

  it('los perfiles que saltea el decorador son los de la configuración', () => {
    expect(configuration().throttle.profiles.map((p) => p.name)).toEqual([
      ...GLOBAL_THROTTLE_PROFILES,
    ])
  })

  function skipped(handler: keyof HealthController): boolean[] {
    const target = HealthController.prototype[handler]
    return GLOBAL_THROTTLE_PROFILES.map(
      (name) => Reflect.getMetadata(THROTTLER_SKIP + name, target) === true,
    )
  }

  it('/health y /health/live no cuentan contra los topes', () => {
    expect(skipped('checkHealth')).toEqual([true, true, true])
    expect(skipped('checkLiveness')).toEqual([true, true, true])
  })

  it('/health/ready, que consulta la base, sí cuenta', () => {
    expect(skipped('checkReadiness')).toEqual([false, false, false])
  })
})
