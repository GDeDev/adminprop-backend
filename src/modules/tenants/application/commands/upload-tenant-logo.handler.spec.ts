import { StoragePort } from '@/platform/storage/storage.port'
import { TenantRepository } from '../../domain/tenant.repository'
import { UploadTenantLogoCommand } from './tenant-settings.commands'
import { UploadTenantLogoHandler } from './tenant-settings.handlers'

describe('UploadTenantLogoHandler: SVG', () => {
  const tenants = {
    findById: jest.fn(),
    setLogo: jest.fn(),
  } as unknown as jest.Mocked<TenantRepository>
  const storage = {
    upload: jest.fn(),
  } as unknown as jest.Mocked<StoragePort>
  const handler = new UploadTenantLogoHandler(tenants, storage)

  beforeEach(() => jest.clearAllMocks())

  it('rechaza un SVG con script y no sube nada', async () => {
    const svg = Buffer.from('<svg xmlns="x"><script>alert(1)</script></svg>')
    await expect(
      handler.execute(new UploadTenantLogoCommand('t1', svg)),
    ).rejects.toThrow(/SVG/)
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('rechaza un SVG con una imagen externa', async () => {
    const svg = Buffer.from('<svg><image href="http://evil.test/a.png"/></svg>')
    await expect(
      handler.execute(new UploadTenantLogoCommand('t1', svg)),
    ).rejects.toThrow(/SVG/)
    expect(storage.upload).not.toHaveBeenCalled()
  })
})
