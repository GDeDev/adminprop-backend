import {
  ImportBatch,
  ImportBatchMode,
  ImportBatchStatus,
  ImportEntity,
  ImportRow,
  ImportRowStatus,
  ImportSource,
} from '../domain/migration.types'
import { ImportExecutor } from './import-executor'

const batch: ImportBatch = {
  id: 'batch-2',
  source: ImportSource.EXCEL,
  mode: ImportBatchMode.IMPORT,
  status: ImportBatchStatus.IMPORTING,
  fileName: 'cartera.xlsx',
  fileKey: null,
  analysisJobId: null,
  importJobId: 'job-2',
  summary: null,
  options: {},
  errorMessage: null,
  createdById: null,
  confirmedById: null,
  confirmedAt: null,
  createdAt: new Date('2026-11-04T10:00:00Z'),
  updatedAt: new Date('2026-11-04T10:00:00Z'),
}

const ownerRow: ImportRow = {
  id: 'row-1',
  batchId: 'batch-2',
  entity: ImportEntity.OWNER,
  rowNumber: 3,
  externalId: null,
  naturalKey: '20111111',
  label: 'Ana Pérez',
  status: ImportRowStatus.VALID,
  data: {
    firstName: 'Ana',
    lastName: 'Pérez',
    nationalId: '20111111',
    phone: null,
    email: null,
    address: null,
    notes: null,
    cbu: null,
    alias: null,
    bankName: null,
    holder: null,
  },
  errors: [],
  conflict: null,
  resolution: null,
  excluded: false,
  targetId: null,
  needsReview: false,
}

function build(linkedTargets: Map<string, string>) {
  const rows = {
    listAll: jest.fn().mockResolvedValue([ownerRow]),
    update: jest.fn().mockResolvedValue(ownerRow),
  }
  const links = {
    findTargets: jest.fn().mockResolvedValue(linkedTargets),
    link: jest.fn().mockResolvedValue(undefined),
  }
  const owners = {
    createFromImport: jest.fn().mockResolvedValue('owner-new'),
  }
  const batches = {
    findById: jest.fn().mockResolvedValue(batch),
    update: jest.fn().mockResolvedValue(batch),
  }
  const jobs = {
    markProcessing: jest.fn(),
    recordItem: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
  }
  const executor = new ImportExecutor(
    batches as never,
    rows as never,
    links as never,
    {} as never,
    owners as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    jobs as never,
    {} as never,
    { delete: jest.fn() } as never,
    { record: jest.fn() } as never,
  )
  return { executor, rows, links, owners }
}

describe('ImportExecutor: vínculos al confirmar', () => {
  // Qué fallaba: dos lotes del mismo Excel analizados antes de confirmar
  // salían con todo VALID; al confirmar el segundo se volvía a crear todo (y
  // el vínculo duplicado se ignoraba en silencio). Las propiedades no tienen
  // unicidad en base, así que se duplicaban.
  it('no vuelve a crear una fila que otro lote ya importó: la marca como ya importada', async () => {
    const { executor, rows, links, owners } = build(
      new Map([['20111111', 'owner-existing']]),
    )

    await executor.run({ batchId: 'batch-2', jobId: 'job-2' })

    expect(links.findTargets).toHaveBeenCalledWith(
      ImportSource.EXCEL,
      ImportEntity.OWNER,
      ['20111111'],
    )
    expect(owners.createFromImport).not.toHaveBeenCalled()
    expect(links.link).not.toHaveBeenCalled()
    expect(rows.update).toHaveBeenCalledWith('row-1', {
      status: ImportRowStatus.ALREADY_IMPORTED,
      targetId: 'owner-existing',
    })
  })

  it('crea la fila y la vincula cuando nadie la importó antes', async () => {
    const { executor, rows, links, owners } = build(new Map())

    await executor.run({ batchId: 'batch-2', jobId: 'job-2' })

    expect(owners.createFromImport).toHaveBeenCalledTimes(1)
    expect(links.link).toHaveBeenCalledWith(
      expect.objectContaining({
        externalKey: '20111111',
        targetId: 'owner-new',
      }),
    )
    expect(rows.update).toHaveBeenCalledWith('row-1', {
      status: ImportRowStatus.IMPORTED,
      targetId: 'owner-new',
    })
  })
})
