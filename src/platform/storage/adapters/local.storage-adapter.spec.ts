import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RequestContext } from '@/shared/context/request-context'
import { LocalStorageAdapter } from './local.storage-adapter'

const inTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
  RequestContext.run({ correlationId: 'test' }, () =>
    RequestContext.runInTenant(tenantId, fn),
  )

describe('LocalStorageAdapter', () => {
  let dir: string
  let storage: LocalStorageAdapter

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'adminprop-storage-'))
    storage = new LocalStorageAdapter(dir, 'http://localhost:3000')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('guarda el archivo bajo la carpeta del tenant y devuelve su URL', async () => {
    const stored = await inTenant('tenant-a', () =>
      storage.upload(Buffer.from('hola'), 'examples/1/doc.txt'),
    )

    expect(stored.key).toBe('tenants/tenant-a/examples/1/doc.txt')
    expect(stored.url).toBe(
      'http://localhost:3000/files/tenants/tenant-a/examples/1/doc.txt',
    )
    expect(readFileSync(join(dir, stored.key), 'utf8')).toBe('hola')
  })

  it('borra el archivo, y borrar de nuevo no falla', async () => {
    const stored = await inTenant('tenant-a', () =>
      storage.upload(Buffer.from('x'), 'a.txt'),
    )

    await inTenant('tenant-a', () => storage.delete(stored.key))
    await inTenant('tenant-a', () => storage.delete(stored.key))

    expect(existsSync(join(dir, stored.key))).toBe(false)
  })

  it('no deja borrar un archivo de otro tenant', async () => {
    const stored = await inTenant('tenant-a', () =>
      storage.upload(Buffer.from('x'), 'a.txt'),
    )

    await expect(
      inTenant('tenant-b', () => storage.delete(stored.key)),
    ).rejects.toThrow(/no pertenece al tenant/)
    expect(existsSync(join(dir, stored.key))).toBe(true)
  })

  it('rechaza un path que intenta salir de la carpeta del tenant', async () => {
    await expect(
      inTenant('tenant-a', () =>
        storage.upload(Buffer.from('x'), '../tenant-b/robado.txt'),
      ),
    ).rejects.toThrow(/Path de archivo inválido/)
  })

  it('sin tenant en el contexto no sube nada', async () => {
    await expect(storage.upload(Buffer.from('x'), 'a.txt')).rejects.toThrow(
      /sin tenant/,
    )
  })
})
