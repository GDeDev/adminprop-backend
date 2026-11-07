import { RequestContext } from '@/shared/context/request-context'
import {
  DocumentData,
  DocumentKind,
  DocumentStatus,
  GeneratedDocument,
  TerminationNoticeDocumentData,
} from '../domain/document'
import { GeneratedDocumentRepository } from '../domain/document.ports'
import { DocumentGenerator } from './document-generator'

const data: TerminationNoticeDocumentData = {
  property: 'Av. Siempreviva 742',
  owner: null,
  renter: null,
  currency: 'ARS',
  startDate: '2025-01-01',
  endDate: '2027-12-31',
  notifiedAt: '2026-10-15',
  terminatedAt: '2026-10-15',
  currentRent: '1000.00',
  remainingMonths: 1,
  remainingDays: 0,
  totalDays: 30,
  futureRent: '1000.00',
  penaltyPercent: '10.00',
  penalty: '100.00',
  deposit: '1000.00',
  depositCurrency: 'ARS',
  depositReturnMode: 'FIXED',
}

/** Repositorio en memoria: suficiente para las reglas de versionado. */
class FakeRepository extends GeneratedDocumentRepository {
  rows: GeneratedDocument[] = []
  create = jest.fn(
    (d: Parameters<GeneratedDocumentRepository['create']>[0]) => {
      const row: GeneratedDocument = {
        id: `doc-${this.rows.length + 1}`,
        kind: d.kind,
        entityId: d.entityId,
        version: d.version,
        status: DocumentStatus.PENDING,
        storageKey: null,
        url: null,
        sizeBytes: null,
        error: null,
        generatedAt: null,
        requestedById: d.requestedById,
        dataSnapshot: d.dataSnapshot,
        createdAt: new Date(),
      }
      this.rows.push(row)
      return Promise.resolve(row)
    },
  )
  findById = (id: string) =>
    Promise.resolve(this.rows.find((r) => r.id === id) ?? null)
  findLatest = (kind: DocumentKind, entityId: string) =>
    Promise.resolve(
      this.rows
        .filter((r) => r.kind === kind && r.entityId === entityId)
        .sort((a, b) => b.version - a.version)[0] ?? null,
    )
  findCurrent = () => Promise.resolve(null)
  reset = (id: string) => {
    const row = this.rows.find((r) => r.id === id)!
    row.status = DocumentStatus.PENDING
    row.error = null
    return Promise.resolve(row)
  }
  markReady = (
    id: string,
    file: Parameters<GeneratedDocumentRepository['markReady']>[1],
  ) => {
    const row = this.rows.find((r) => r.id === id)!
    Object.assign(row, {
      status: DocumentStatus.READY,
      storageKey: file.storageKey,
      url: file.url,
      sizeBytes: file.sizeBytes,
      generatedAt: file.generatedAt,
      dataSnapshot: file.dataSnapshot,
    })
    return Promise.resolve(row)
  }
  markFailed = (id: string, error: string) => {
    const row = this.rows.find((r) => r.id === id)!
    Object.assign(row, { status: DocumentStatus.FAILED, error })
    return Promise.resolve(row)
  }
  list = () => Promise.resolve<[GeneratedDocument[], number]>([[], 0])
}

function setup(built: DocumentData | null = data) {
  const repo = new FakeRepository()
  const builder = {
    build: jest.fn().mockResolvedValue(built),
    attach: jest.fn().mockResolvedValue(undefined),
  }
  const branding = {
    resolve: jest.fn().mockResolvedValue({
      brandName: 'Test',
      primaryColor: '#c2410c',
      detailLines: [],
      footerLines: [],
    }),
  }
  const renderer = {
    render: jest.fn().mockResolvedValue(Buffer.from('%PDF-x')),
  }
  const storage = {
    upload: jest
      .fn()
      .mockImplementation((_b: Buffer, path: string) =>
        Promise.resolve({ key: `tenants/t/${path}`, url: `http://x/${path}` }),
      ),
  }
  const notifications = { notifyStaff: jest.fn().mockResolvedValue('SENT') }
  const prisma = { transaction: <T>(fn: () => Promise<T>) => fn() }
  const generator = new DocumentGenerator(
    repo,
    builder as never,
    branding as never,
    renderer as never,
    storage as never,
    notifications as never,
    prisma as never,
  )
  return { repo, builder, renderer, storage, notifications, generator }
}

const run = <T>(fn: () => Promise<T>) =>
  RequestContext.runInTenant('tenant-1', fn)
const request = { kind: DocumentKind.TERMINATION_NOTICE, entityId: 'c-1' }

describe('DocumentGenerator', () => {
  it('genera la versión 1: renderiza, sube, avisa al dueño y queda READY', async () => {
    const { generator, builder, storage, repo } = setup()
    const doc = await run(() => generator.generate(request))
    expect(doc?.status).toBe(DocumentStatus.READY)
    expect(doc?.version).toBe(1)
    expect(storage.upload.mock.calls[0][1]).toBe(
      'documents/termination-notice/c-1-1.pdf',
    )
    expect(builder.attach).toHaveBeenCalledWith(
      DocumentKind.TERMINATION_NOTICE,
      'c-1',
      expect.objectContaining({
        url: 'http://x/documents/termination-notice/c-1-1.pdf',
      }),
    )
    expect(repo.rows[0].sizeBytes).toBe(6)
  })

  it('un evento repetido con los mismos datos no genera otra versión', async () => {
    const { generator, renderer, repo } = setup()
    await run(() => generator.generate(request))
    await run(() => generator.generate(request))
    expect(renderer.render).toHaveBeenCalledTimes(1)
    expect(repo.rows).toHaveLength(1)
  })

  it('datos distintos o force crean la versión siguiente sin pisar el archivo', async () => {
    const { generator, storage, repo, builder } = setup()
    await run(() => generator.generate(request))
    builder.build.mockResolvedValue({ ...data, penalty: '200.00' })
    await run(() => generator.generate(request))
    await run(() => generator.generate({ ...request, force: true }))
    expect(repo.rows.map((r) => r.version)).toEqual([1, 2, 3])
    expect(storage.upload.mock.calls.map((c) => c[1])).toEqual([
      'documents/termination-notice/c-1-1.pdf',
      'documents/termination-notice/c-1-2.pdf',
      'documents/termination-notice/c-1-3.pdf',
    ])
  })

  it('no genera nada si el documento no aplica (recibo sin número)', async () => {
    const { generator, repo, renderer } = setup(null)
    expect(await run(() => generator.generate(request))).toBeNull()
    expect(repo.rows).toHaveLength(0)
    expect(renderer.render).not.toHaveBeenCalled()
  })

  it('un fallo definitivo deja FAILED con el error y avisa al personal una vez', async () => {
    const { generator, repo, notifications } = setup()
    await run(() => generator.fail(request.kind, 'c-1', new Error('boom')))
    expect(repo.rows[0].status).toBe(DocumentStatus.FAILED)
    expect(repo.rows[0].error).toBe('boom')
    expect(notifications.notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DOCUMENT_FAILED',
        dedupeKey: 'DOCUMENT_FAILED:doc-1',
        tenantId: 'tenant-1',
      }),
    )
  })

  it('reintentar tras un fallo reusa la versión FAILED', async () => {
    const { generator, repo } = setup()
    await run(() => generator.fail(request.kind, 'c-1', new Error('boom')))
    const doc = await run(() => generator.generate(request))
    expect(repo.rows).toHaveLength(1)
    expect(doc?.status).toBe(DocumentStatus.READY)
    expect(doc?.error).toBeNull()
  })
})
