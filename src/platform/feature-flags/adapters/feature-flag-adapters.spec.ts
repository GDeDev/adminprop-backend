import { Flagsmith } from 'flagsmith-nodejs'

import { RequestContext } from '@/shared/context/request-context'
import {
  FlagsmithFeatureFlagAdapter,
  TENANT_TRAIT,
} from './flagsmith.feature-flag-adapter'
import { InMemoryFeatureFlagAdapter } from './in-memory.feature-flag-adapter'

jest.mock('flagsmith-nodejs', () => ({
  Flagsmith: jest.fn(),
  DefaultFlag: jest.fn(),
}))

const inTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
  RequestContext.run({ correlationId: 'test' }, () =>
    RequestContext.runInTenant(tenantId, fn),
  )

describe('FlagsmithFeatureFlagAdapter', () => {
  const client = {
    getIdentityFlags: jest.fn(),
    getEnvironmentFlags: jest.fn(),
    close: jest.fn(),
  }

  beforeEach(() => {
    ;(Flagsmith as unknown as jest.Mock).mockImplementation(() => client)
  })

  it('evalúa el flag con el tenant como identity, para poder segmentar por inmobiliaria', async () => {
    client.getIdentityFlags.mockResolvedValue({
      isFeatureEnabled: (key: string) => key === 'automatic-appraisal',
    })
    const flags = new FlagsmithFeatureFlagAdapter('ser.key')

    const enabled = await inTenant('tenant-a', () =>
      flags.isEnabled('automatic-appraisal'),
    )

    expect(enabled).toBe(true)
    expect(client.getIdentityFlags).toHaveBeenCalledWith('tenant_tenant-a', {
      [TENANT_TRAIT]: 'tenant-a',
    })
  })

  it('un tenant explícito gana sobre el del contexto', async () => {
    client.getIdentityFlags.mockResolvedValue({ isFeatureEnabled: () => true })
    const flags = new FlagsmithFeatureFlagAdapter('ser.key')

    await inTenant('tenant-a', () =>
      flags.isEnabled('x', { tenantId: 'tenant-b' }),
    )

    expect(client.getIdentityFlags).toHaveBeenCalledWith(
      'tenant_tenant-b',
      expect.anything(),
    )
  })

  it('sin tenant evalúa a nivel entorno', async () => {
    client.getEnvironmentFlags.mockResolvedValue({
      isFeatureEnabled: () => true,
    })
    const flags = new FlagsmithFeatureFlagAdapter('ser.key')

    await expect(flags.isEnabled('x')).resolves.toBe(true)
    expect(client.getIdentityFlags).not.toHaveBeenCalled()
  })

  it('si Flagsmith falla, el flag se considera apagado y el request sigue', async () => {
    client.getIdentityFlags.mockRejectedValue(new Error('timeout'))
    const flags = new FlagsmithFeatureFlagAdapter('ser.key')

    await expect(
      inTenant('tenant-a', () => flags.isEnabled('x')),
    ).resolves.toBe(false)
  })
})

describe('InMemoryFeatureFlagAdapter', () => {
  it('los flags de arranque están prendidos para todos', async () => {
    const flags = new InMemoryFeatureFlagAdapter(['a'])

    await expect(flags.isEnabled('a', { tenantId: 't1' })).resolves.toBe(true)
    await expect(flags.isEnabled('b', { tenantId: 't1' })).resolves.toBe(false)
  })

  it('un flag prendido para un tenant no se prende para otro', async () => {
    const flags = new InMemoryFeatureFlagAdapter()
    flags.enable('beta', 'tenant-a')

    await expect(
      inTenant('tenant-a', () => flags.isEnabled('beta')),
    ).resolves.toBe(true)
    await expect(
      inTenant('tenant-b', () => flags.isEnabled('beta')),
    ).resolves.toBe(false)
  })
})
