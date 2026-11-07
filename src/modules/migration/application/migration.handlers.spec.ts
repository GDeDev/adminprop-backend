import { RequestContext } from '@/shared/context/request-context'
import { BatchDiscarder } from './batch-discarder'
import { ImportBatchStatus, ImportRowStatus } from '../domain/migration.types'
import {
  StartExcelAnalysisHandler,
  StartTokkoAnalysisHandler,
  UpdateImportRowHandler,
} from './migration.handlers'
import {
  StartExcelAnalysisCommand,
  StartTokkoAnalysisCommand,
  UpdateImportRowCommand,
} from './migration.commands'

const inTenant = <T>(fn: () => Promise<T>) =>
  RequestContext.runInTenant('ten-1', fn)

// Qué fallaba: el lote se creaba (y el archivo se subía) antes de encolar el
// análisis. Si la cola fallaba, el lote quedaba ANALYZING para siempre —no se
// podía confirmar ni descartar— y el archivo quedaba huérfano en el storage.
describe('arranque del análisis: si no se puede encolar', () => {
  const queueDown = new Error('pg-boss caído')

  function build() {
    const batches = {
      create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
      update: jest.fn().mockResolvedValue(undefined),
    }
    const jobs = {
      start: jest.fn().mockResolvedValue('job-1'),
      fail: jest.fn().mockResolvedValue(undefined),
    }
    const storage = {
      upload: jest
        .fn()
        .mockResolvedValue({ key: 'migrations/batch-1.xlsx', url: 'u' }),
      delete: jest.fn().mockResolvedValue(undefined),
    }
    const queue = { publish: jest.fn().mockRejectedValue(queueDown) }
    const reader = { read: jest.fn().mockResolvedValue({}) }
    return { batches, jobs, storage, queue, reader }
  }

  it('Excel: cierra el lote como FAILED, falla el job y borra el archivo', async () => {
    const { batches, jobs, storage, queue, reader } = build()
    const handler = new StartExcelAnalysisHandler(
      batches as never,
      reader as never,
      storage as never,
      jobs as never,
      queue as never,
    )

    await expect(
      handler.execute(
        new StartExcelAnalysisCommand({
          buffer: Buffer.from('PK'),
          originalName: 'cartera.xlsx',
        }),
      ),
    ).rejects.toBe(queueDown)

    expect(batches.update).toHaveBeenLastCalledWith(
      'batch-1',
      expect.objectContaining({
        status: ImportBatchStatus.FAILED,
        fileKey: null,
      }),
    )
    expect(jobs.fail).toHaveBeenCalledWith('job-1', expect.any(String))
    expect(storage.delete).toHaveBeenCalledWith('migrations/batch-1.xlsx')
  })

  it('Tokko: cierra el lote como FAILED', async () => {
    const { batches, jobs, queue } = build()
    const handler = new StartTokkoAnalysisHandler(
      batches as never,
      jobs as never,
      queue as never,
      { isAvailableFor: () => true } as never,
    )

    await expect(
      handler.execute(new StartTokkoAnalysisCommand({ includeAssets: false })),
    ).rejects.toBe(queueDown)

    expect(batches.update).toHaveBeenLastCalledWith(
      'batch-1',
      expect.objectContaining({ status: ImportBatchStatus.FAILED }),
    )
    expect(jobs.fail).toHaveBeenCalledWith('job-1', expect.any(String))
  })

  it('si falla la limpieza, el error que sale es el original', async () => {
    const { batches, jobs, storage, queue, reader } = build()
    batches.update.mockRejectedValue(new Error('base caída'))
    const handler = new StartExcelAnalysisHandler(
      batches as never,
      reader as never,
      storage as never,
      jobs as never,
      queue as never,
    )

    await expect(
      handler.execute(
        new StartExcelAnalysisCommand({
          buffer: Buffer.from('PK'),
          originalName: 'cartera.xlsx',
        }),
      ),
    ).rejects.toMatchObject({ message: 'base caída' })
  })
})

describe('Fase 21: archivo del lote y fila revisada', () => {
  const excel = new StartExcelAnalysisCommand({
    buffer: Buffer.from('PK'),
    originalName: 'cartera.xlsx',
  })

  function excelHandler(storageDelete: jest.Mock) {
    const batches = {
      create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
      update: jest.fn().mockResolvedValue(undefined),
    }
    const storage = {
      upload: jest.fn().mockResolvedValue({ key: 'k-1', url: 'u' }),
      delete: storageDelete,
    }
    const jobs = {
      start: jest.fn().mockResolvedValue('job-1'),
      fail: jest.fn().mockResolvedValue(undefined),
    }
    const queue = { publish: jest.fn().mockRejectedValue(new Error('cola')) }
    const handler = new StartExcelAnalysisHandler(
      batches as never,
      { read: jest.fn().mockResolvedValue({}) } as never,
      storage as never,
      jobs as never,
      queue as never,
    )
    return { handler, batches, storage }
  }

  // Antes la ruta era `migrations/<lote>.xlsx`, sin el tenant.
  it('sube el .xlsx a una ruta con el tenant', async () => {
    const { handler, storage } = excelHandler(
      jest.fn().mockResolvedValue(undefined),
    )
    await inTenant(() => handler.execute(excel)).catch(() => undefined)
    expect(storage.upload.mock.calls[0][1]).toBe(
      'migrations/ten-1/batch-1.xlsx',
    )
  })

  // Antes la clave se ponía en null aunque el borrado fallara: el archivo
  // quedaba en el storage sin que nada lo referenciara.
  it('si no puede borrar el archivo al abandonar el lote, conserva la clave', async () => {
    const { handler, batches } = excelHandler(
      jest.fn().mockRejectedValue(new Error('storage caído')),
    )
    await inTenant(() => handler.execute(excel)).catch(() => undefined)
    expect(batches.update).toHaveBeenLastCalledWith(
      'batch-1',
      expect.objectContaining({
        status: ImportBatchStatus.FAILED,
        fileKey: 'k-1',
      }),
    )
  })

  it('al descartar, si no puede borrar el archivo, no pierde la clave', async () => {
    const batches = {
      transition: jest.fn().mockResolvedValue(true),
      update: jest.fn(),
    }
    const storage = { delete: jest.fn().mockRejectedValue(new Error('caído')) }
    const discarder = new BatchDiscarder(batches as never, storage as never)
    await discarder.discard({ id: 'batch-1', fileKey: 'k-1' } as never)
    expect(batches.update).not.toHaveBeenCalled()

    storage.delete.mockResolvedValue(undefined)
    await discarder.discard({ id: 'batch-1', fileKey: 'k-1' } as never)
    expect(batches.update).toHaveBeenCalledWith('batch-1', { fileKey: null })
  })

  // Antes excluir una fila no dejaba rastro en la auditoría.
  it('excluir una fila queda auditado con el antes y el después', async () => {
    const row = {
      id: 'row-1',
      label: 'Av. Siempreviva 742',
      status: ImportRowStatus.VALID,
      conflict: null,
      resolution: null,
      excluded: false,
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const handler = new UpdateImportRowHandler(
      {
        findById: jest.fn().mockResolvedValue({
          id: 'batch-1',
          status: ImportBatchStatus.READY,
        }),
      } as never,
      {
        findById: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({ ...row, excluded: true }),
      } as never,
      { row: jest.fn((r: unknown) => r) } as never,
      audit as never,
    )
    await handler.execute(
      new UpdateImportRowCommand('batch-1', 'row-1', { excluded: true }),
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'ImportBatch',
        entityId: 'batch-1',
        changes: {
          rowId: { after: 'row-1' },
          excluded: { before: false, after: true },
        },
      }),
    )
  })
})

describe('Tokko con la API real: sólo la inmobiliaria de la key (D-253)', () => {
  it('otra inmobiliaria recibe 403 y no se crea ningún lote', async () => {
    const batches = { create: jest.fn() }
    const handler = new StartTokkoAnalysisHandler(
      batches as never,
      {} as never,
      {} as never,
      { isAvailableFor: (id?: string) => id === 'ten-dueno' } as never,
    )
    await expect(
      inTenant(() =>
        handler.execute(
          new StartTokkoAnalysisCommand({ includeAssets: false }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'TOKKO_NOT_ENABLED' })
    expect(batches.create).not.toHaveBeenCalled()
  })
})
