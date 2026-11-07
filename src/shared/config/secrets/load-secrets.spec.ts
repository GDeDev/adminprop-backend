import { loadSecrets } from './load-secrets'

describe('loadSecrets', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
  })

  it('SECRETS_PROVIDER vacío usa el proveedor env (default)', async () => {
    process.env.SECRETS_PROVIDER = ''
    await expect(loadSecrets()).resolves.toBeUndefined()
  })

  it('SECRETS_PROVIDER sin definir usa el proveedor env', async () => {
    delete process.env.SECRETS_PROVIDER
    await expect(loadSecrets()).resolves.toBeUndefined()
  })

  it('un proveedor desconocido sigue fallando', async () => {
    process.env.SECRETS_PROVIDER = 'vault'
    await expect(loadSecrets()).rejects.toThrow(/desconocido/)
  })
})
