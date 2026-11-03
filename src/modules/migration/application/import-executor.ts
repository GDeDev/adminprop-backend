import { Injectable } from '@nestjs/common'

import { AuditFacade } from '@/modules/audit/public'
import {
  CollectionMode,
  ContractsFacade,
  Currency,
  RentUpdateFrequency,
  RentUpdateType,
} from '@/modules/contracts/public'
import { AsyncJobsFacade } from '@/modules/jobs/public'
import { Catalog, MasterDataFacade } from '@/modules/master-data/public'
import { OwnersFacade } from '@/modules/owners/public'
import { ListingCurrency, PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import { QueuePort } from '@/platform/queue/queue.port'
import { StoragePort } from '@/platform/storage/storage.port'
import { createLogger } from '@/shared/logging/root-logger'
import { normalizePathKey, normalizeText } from '../domain/import-normalizers'
import { DependencyNotImportedException } from '../domain/migration.exceptions'
import {
  ImportAssetRepository,
  ImportBatchRepository,
  ImportLinkRepository,
  ImportRowRepository,
  NewImportAsset,
} from '../domain/migration.ports'
import {
  ContractRowData,
  GuarantorRowData,
  IMPORT_ORDER,
  ImportBatch,
  ImportBatchStatus,
  ImportEntity,
  ImportResolution,
  ImportRow,
  ImportRowStatus,
  ImportSource,
  MastersCount,
  OwnerRowData,
  PropertyRowData,
  RenterRowData,
} from '../domain/migration.types'
import {
  ASSETS_JOB_TYPE,
  MIGRATION_ASSETS_QUEUE,
  MigrationJobPayload,
} from './migration-queues'
import { userMessage } from './user-message'

/** Lo que cada corrida lleva en memoria: ids ya resueltos y maestros ya vistos. */
interface RunState {
  batch: ImportBatch
  defaultResolution: ImportResolution
  /** Ids de lo existente o recién importado, por clave de enlace. */
  ownerByDni: Map<string, string>
  guarantorByDni: Map<string, string>
  renterByDni: Map<string, string>
  propertyByCode: Map<string, string>
  types: Map<string, string>
  amenities: Map<string, string>
  locations: Map<string, string>
  created: MastersCount
  photos: NewImportAsset[]
}

/**
 * La confirmación: importa exactamente las filas que se revisaron, en el
 * orden de dependencia, una por una (una que falla no tumba al lote). Todo
 * pasa por las facades de cada módulo, con sus validaciones y su auditoría.
 * Nunca pisa lo cargado a mano (A-72).
 */
@Injectable()
export class ImportExecutor {
  private readonly logger = createLogger('ImportExecutor')

  constructor(
    private readonly batches: ImportBatchRepository,
    private readonly rows: ImportRowRepository,
    private readonly links: ImportLinkRepository,
    private readonly assets: ImportAssetRepository,
    private readonly owners: OwnersFacade,
    private readonly renters: RentersFacade,
    private readonly properties: PropertiesFacade,
    private readonly contracts: ContractsFacade,
    private readonly masters: MasterDataFacade,
    private readonly jobs: AsyncJobsFacade,
    private readonly queue: QueuePort,
    private readonly storage: StoragePort,
    private readonly audit: AuditFacade,
  ) {}

  async run({ batchId, jobId }: MigrationJobPayload): Promise<void> {
    const batch = await this.batches.findById(batchId)
    if (!batch || batch.status !== ImportBatchStatus.IMPORTING) {
      await this.jobs.fail(jobId, 'El lote no está en importación')
      return
    }
    await this.jobs.markProcessing(jobId)
    try {
      await this.importRows(batch, jobId)
    } catch (error) {
      // Algo más grave que una fila: el lote queda FAILED con el motivo.
      this.logger.error(
        { err: error, batchId },
        'Falló la importación del lote',
      )
      const reason = userMessage(error).message
      await this.batches.update(batchId, {
        status: ImportBatchStatus.FAILED,
        errorMessage: reason,
      })
      await this.jobs.fail(jobId, reason)
    }
  }

  /** Arranca la migración de fotos como un trabajo aparte (rediseño 4.4). */
  async startAssets(batchId: string, total: number): Promise<string> {
    const jobId = await this.jobs.start(ASSETS_JOB_TYPE, { totalItems: total })
    await this.queue.publish(MIGRATION_ASSETS_QUEUE, { batchId, jobId })
    return jobId
  }

  private async importRows(batch: ImportBatch, jobId: string): Promise<void> {
    const rows = await this.rows.listAll(batch.id)
    const state: RunState = {
      batch,
      defaultResolution:
        batch.options.defaultConflictResolution ?? ImportResolution.SKIP,
      ownerByDni: new Map(),
      guarantorByDni: new Map(),
      renterByDni: new Map(),
      propertyByCode: new Map(),
      types: new Map(),
      amenities: new Map(),
      locations: new Map(),
      created: { locations: 0, propertyTypes: 0, amenities: 0 },
      photos: [],
    }
    // Lo existente o ya importado que las filas siguientes pueden necesitar.
    for (const row of rows) this.remember(state, row, row.targetId)

    let incomplete = false
    for (const entity of IMPORT_ORDER) {
      for (const row of rows.filter((r) => r.entity === entity)) {
        if (row.status === ImportRowStatus.ERROR) {
          incomplete = true
          continue
        }
        try {
          if (await this.importRow(state, row)) {
            await this.jobs.recordItem(jobId, 'succeeded')
          }
        } catch (error) {
          incomplete = true
          const { code, message } = userMessage(error)
          if (code === 'UNEXPECTED_ERROR') {
            this.logger.error(
              { err: error, rowId: row.id },
              'Falló una fila de la importación',
            )
          }
          await this.rows.update(row.id, {
            status: ImportRowStatus.FAILED,
            errors: [{ field: '_', code, message }],
          })
          await this.jobs.recordItem(jobId, 'failed')
        }
      }
    }

    const migrateAssets = batch.options.migrateAssets ?? false
    const photos = migrateAssets ? state.photos : []
    if (photos.length > 0) await this.assets.insertMany(batch.id, photos)

    const summary = batch.summary ?? {
      missingSheets: [],
      mastersToCreate: { locations: 0, propertyTypes: 0, amenities: 0 },
      mastersCreated: { locations: 0, propertyTypes: 0, amenities: 0 },
    }
    const status = incomplete
      ? ImportBatchStatus.PARTIAL
      : ImportBatchStatus.COMPLETED
    await this.batches.update(batch.id, {
      // Con fotos por bajar el lote sigue importando hasta que terminen.
      status: photos.length > 0 ? ImportBatchStatus.IMPORTING : status,
      summary: {
        ...summary,
        mastersCreated: state.created,
        finalStatus: status,
      },
    })
    await this.deleteFile(batch)
    await this.jobs.complete(jobId, { batchId: batch.id })
    await this.audit.record({
      action: 'JOB_RUN',
      entity: 'ImportBatch',
      entityId: batch.id,
      summary: 'Terminó la importación de un lote de migración',
      changes: { status: { after: status } },
    })
    if (photos.length > 0) await this.startAssets(batch.id, photos.length)
  }

  /**
   * Importa una fila. Devuelve false si no había nada que hacer (ya estaba
   * hecha o no se podía), true si la procesó (importada u omitida a propósito).
   */
  private async importRow(state: RunState, row: ImportRow): Promise<boolean> {
    if (
      row.status !== ImportRowStatus.VALID &&
      row.status !== ImportRowStatus.CONFLICT
    ) {
      return false
    }
    if (row.excluded) {
      await this.rows.update(row.id, { status: ImportRowStatus.SKIPPED })
      return true
    }

    if (row.status === ImportRowStatus.CONFLICT) {
      const resolution = row.resolution ?? state.defaultResolution
      // Un duplicado del archivo no se fusiona con nada: se omite siempre.
      if (
        row.conflict?.kind !== 'EXISTING' ||
        resolution !== ImportResolution.MERGE_EMPTY_FIELDS
      ) {
        await this.rows.update(row.id, { status: ImportRowStatus.SKIPPED })
        return true
      }
      const targetId = row.targetId as string
      await this.merge(state, row, targetId)
      await this.complete(state, row, targetId)
      return true
    }

    const id = await this.create(state, row)
    await this.complete(state, row, id)
    return true
  }

  /** Deja el vínculo (idempotencia), marca la fila y la deja a mano de las siguientes. */
  private async complete(
    state: RunState,
    row: ImportRow,
    targetId: string,
  ): Promise<void> {
    await this.links.link({
      source: state.batch.source,
      entity: row.entity,
      externalKey:
        state.batch.source === ImportSource.TOKKO
          ? (row.externalId as string)
          : row.naturalKey,
      targetId,
      batchId: state.batch.id,
    })
    await this.rows.update(row.id, {
      status: ImportRowStatus.IMPORTED,
      targetId,
    })
    this.remember(state, row, targetId)
  }

  private remember(state: RunState, row: ImportRow, id: string | null): void {
    if (!id) return
    switch (row.entity) {
      case ImportEntity.OWNER:
        state.ownerByDni.set((row.data as OwnerRowData).nationalId, id)
        break
      case ImportEntity.GUARANTOR:
        state.guarantorByDni.set((row.data as GuarantorRowData).nationalId, id)
        break
      case ImportEntity.RENTER:
        state.renterByDni.set((row.data as RenterRowData).nationalId, id)
        break
      case ImportEntity.PROPERTY: {
        const code = (row.data as PropertyRowData).code
        if (code) state.propertyByCode.set(normalizeText(code), id)
        break
      }
      default:
    }
  }

  // ------------------------------------------------------------------ Alta

  private async create(state: RunState, row: ImportRow): Promise<string> {
    switch (row.entity) {
      case ImportEntity.OWNER:
        return this.owners.createFromImport(row.data as OwnerRowData)
      case ImportEntity.GUARANTOR:
        return this.renters.createGuarantorFromImport(
          row.data as GuarantorRowData,
        )
      case ImportEntity.RENTER: {
        const data = row.data as RenterRowData
        return this.renters.createRenterFromImport({
          ...data,
          guarantorId: await this.guarantorId(state, data),
        })
      }
      case ImportEntity.PROPERTY:
        return this.createProperty(state, row)
      case ImportEntity.CONTRACT:
        return this.createContract(state, row.data as ContractRowData)
    }
  }

  private async guarantorId(
    state: RunState,
    data: RenterRowData,
  ): Promise<string | null> {
    if (!data.guarantorNationalId) return null
    const known = state.guarantorByDni.get(data.guarantorNationalId)
    if (known) return known
    const found = (
      await this.renters.findGuarantorsForImport([data.guarantorNationalId])
    ).get(data.guarantorNationalId)
    if (!found) throw new DependencyNotImportedException('el garante')
    return found.id
  }

  private async ownerId(
    state: RunState,
    dni: string | null,
  ): Promise<string | null> {
    if (!dni) return null
    const known = state.ownerByDni.get(dni)
    if (known) return known
    const found = (await this.owners.findForImport([dni])).get(dni)
    if (!found) throw new DependencyNotImportedException('el propietario')
    return found.id
  }

  private async createProperty(
    state: RunState,
    row: ImportRow,
  ): Promise<string> {
    const data = row.data as PropertyRowData
    const ownerId = await this.ownerId(state, data.ownerNationalId)
    const propertyTypeId =
      data.propertyTypeId ??
      (await this.ensureMaster(
        state,
        state.types,
        Catalog.PROPERTY_TYPES,
        data.propertyTypeName,
      ))
    const amenityIds: string[] = []
    for (const name of data.amenityNames) {
      amenityIds.push(
        await this.ensureMaster(
          state,
          state.amenities,
          Catalog.AMENITIES,
          name,
        ),
      )
    }

    let locationId = data.locationId
    let needsReview = row.needsReview
    if (!locationId) {
      if (data.locationPath.length === 0) {
        locationId = await this.ensureLocation(state, [], true)
        needsReview = true
      } else {
        locationId = await this.ensureLocation(state, data.locationPath, false)
      }
    }

    const id = await this.properties.createFromImport({
      address: data.address,
      locationId,
      propertyTypeId,
      ownerId,
      amenityIds,
      listingPrice: data.listingPrice,
      listingCurrency: data.listingCurrency as ListingCurrency | null,
      publicDescription: data.publicDescription,
      notes: data.notes,
      needsReview,
    })
    for (const photo of data.photos) {
      state.photos.push({
        propertyId: id,
        sourceUrl: photo.url,
        position: photo.position,
      })
    }
    return id
  }

  private async createContract(
    state: RunState,
    data: ContractRowData,
  ): Promise<string> {
    const propertyId = state.propertyByCode.get(
      normalizeText(data.propertyCode),
    )
    if (!propertyId) throw new DependencyNotImportedException('la propiedad')
    let renterId = state.renterByDni.get(data.renterNationalId)
    if (!renterId) {
      renterId = (
        await this.renters.findRentersForImport([data.renterNationalId])
      ).get(data.renterNationalId)?.id
    }
    if (!renterId) throw new DependencyNotImportedException('el inquilino')

    return this.contracts.createFromImport({
      propertyId,
      renterId,
      startDate: data.startDate,
      endDate: data.endDate,
      initialRent: data.initialRent,
      currency: data.currency as Currency,
      rentUpdateType: data.rentUpdateType as RentUpdateType,
      rentUpdateFrequency: data.rentUpdateFrequency as RentUpdateFrequency,
      fixedIncreasePercentage: data.fixedIncreasePercentage,
      deposit: data.deposit,
      depositCurrency: data.depositCurrency as Currency,
      collectionMode: data.collectionMode as CollectionMode,
      notes: data.notes,
    })
  }

  // ---------------------------------------------------------------- Fusión

  /** Completa sólo lo vacío del registro existente; nunca pisa un valor (A-72). */
  private async merge(
    state: RunState,
    row: ImportRow,
    targetId: string,
  ): Promise<void> {
    switch (row.entity) {
      case ImportEntity.OWNER:
        await this.owners.fillEmptyFields(targetId, row.data as OwnerRowData)
        return
      case ImportEntity.GUARANTOR:
        await this.renters.fillEmptyGuarantorFields(
          targetId,
          row.data as GuarantorRowData,
        )
        return
      case ImportEntity.RENTER: {
        const data = row.data as RenterRowData
        await this.renters.fillEmptyRenterFields(targetId, {
          ...data,
          guarantorId: await this.guarantorId(state, data),
        })
        return
      }
      case ImportEntity.PROPERTY: {
        const data = row.data as PropertyRowData
        await this.properties.fillEmptyFields(targetId, {
          address: data.address,
          locationId: data.locationId ?? '',
          propertyTypeId: data.propertyTypeId ?? '',
          ownerId: await this.ownerId(state, data.ownerNationalId),
          // En una fusión no se crean maestros ni se suman amenities.
          amenityIds: [],
          listingPrice: data.listingPrice,
          listingCurrency: null,
          publicDescription: data.publicDescription,
          notes: data.notes,
          needsReview: false,
        })
        return
      }
      case ImportEntity.CONTRACT:
        await this.contracts.fillEmptyFields(targetId, {
          notes: (row.data as ContractRowData).notes,
        })
    }
  }

  // -------------------------------------------------------------- Maestros

  /** Tipo o amenity por nombre normalizado: se crea una sola vez (A-73). */
  private async ensureMaster(
    state: RunState,
    cache: Map<string, string>,
    catalog: Catalog,
    name: string,
  ): Promise<string> {
    const key = normalizeText(name)
    const cached = cache.get(key)
    if (cached) return cached
    const { id, created } = await this.masters.ensureCatalogItem(catalog, name)
    if (created) {
      if (catalog === Catalog.PROPERTY_TYPES) state.created.propertyTypes += 1
      else state.created.amenities += 1
    }
    cache.set(key, id)
    return id
  }

  private async ensureLocation(
    state: RunState,
    path: string[],
    unknown: boolean,
  ): Promise<string> {
    const key = unknown ? 'unknown-location' : normalizePathKey(path)
    const cached = state.locations.get(key)
    if (cached) return cached
    const { id, created } = unknown
      ? await this.masters.ensureUnknownLocation()
      : await this.masters.ensureLocationPath(path)
    state.created.locations += created
    state.locations.set(key, id)
    return id
  }

  /** El .xlsx subido ya no hace falta (A-79). */
  private async deleteFile(batch: ImportBatch): Promise<void> {
    if (!batch.fileKey) return
    try {
      await this.storage.delete(batch.fileKey)
    } catch (error) {
      this.logger.warn({ err: error }, 'No se pudo borrar el archivo del lote')
    }
    await this.batches.update(batch.id, { fileKey: null })
  }
}
