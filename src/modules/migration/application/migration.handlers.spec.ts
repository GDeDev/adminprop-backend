import { ImportBatchStatus } from '../domain/migration.types'
import {
  StartExcelAnalysisHandler,
  StartTokkoAnalysisHandler,
} from './migration.handlers'
import {
  StartExcelAnalysisCommand,
  StartTokkoAnalysisCommand,
} from './migration.commands'

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
