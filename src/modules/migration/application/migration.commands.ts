import {
  ImportBatchStatus,
  ImportEntity,
  ImportResolution,
  ImportRowStatus,
  ImportSource,
} from '../domain/migration.types'

export class StartExcelAnalysisCommand {
  constructor(public readonly file: { buffer: Buffer; originalName: string }) {}
}

export class StartTokkoAnalysisCommand {
  constructor(
    public readonly options: {
      operationTypes?: string[]
      limit?: number
      includeAssets: boolean
    },
  ) {}
}

export class UpdateImportRowCommand {
  constructor(
    public readonly batchId: string,
    public readonly rowId: string,
    public readonly changes: {
      excluded?: boolean
      resolution?: ImportResolution
    },
  ) {}
}

export class ConfirmImportCommand {
  constructor(
    public readonly batchId: string,
    public readonly options: {
      excludeRowIds: string[]
      defaultConflictResolution: ImportResolution
      migrateAssets?: boolean
    },
  ) {}
}

export class DiscardImportCommand {
  constructor(public readonly batchId: string) {}
}

export class RetryImportAssetsCommand {
  constructor(public readonly batchId: string) {}
}

export class ListImportBatchesQuery {
  constructor(
    public readonly filter: {
      source?: ImportSource
      status?: ImportBatchStatus
    },
    public readonly page: { page?: number; limit?: number },
  ) {}
}

export class GetImportBatchQuery {
  constructor(public readonly batchId: string) {}
}

export class ListImportRowsQuery {
  constructor(
    public readonly batchId: string,
    public readonly filter: {
      entity?: ImportEntity
      status?: ImportRowStatus
      needsReview?: boolean
    },
    public readonly page: { page?: number; limit?: number },
  ) {}
}

export class GetExcelTemplateQuery {}

export class GetImportReportQuery {
  constructor(public readonly batchId: string) {}
}
