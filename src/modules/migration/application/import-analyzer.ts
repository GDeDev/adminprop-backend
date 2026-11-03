import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'

import { ContractsFacade } from '@/modules/contracts/public'
import { OwnersFacade } from '@/modules/owners/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import {
  TokkoOperation,
  TokkoProperty,
  TokkoSourcePort,
} from '@/platform/tokko/tokko-source.port'
import { todayIso } from '@/shared/dates/calendar-date'
import { toMoneyString } from '@/shared/money'
import {
  normalizeAddressKey,
  normalizePathKey,
  normalizeText,
} from '../domain/import-normalizers'
import { SELECTABLE_LEVELS } from '../domain/location-index'
import { ImportLinkRepository } from '../domain/migration.ports'
import {
  BatchOptions,
  BatchSummary,
  ContractRowData,
  GuarantorRowData,
  IMPORT_ORDER,
  ImportEntity,
  ImportRowStatus,
  ImportSource,
  NewImportRow,
  OwnerRowData,
  PropertyRowData,
  RenterRowData,
  RowConflict,
  RowData,
  RowError,
} from '../domain/migration.types'
import {
  SheetRow,
  Validated,
  validateContract,
  validateGuarantor,
  validateOwner,
  validateProperty,
  validateRenter,
} from '../domain/row-validators'
import { ParsedWorkbook } from './excel-reader'
import { ReferenceData, ReferenceDataLoader } from './reference-data'

export interface AnalysisResult {
  rows: NewImportRow[]
  summary: BatchSummary
}

/** Una fila ya validada, todavía sin estado. */
interface Candidate {
  id: string
  entity: ImportEntity
  rowNumber: number | null
  externalId: string | null
  label: string
  data: RowData
  errors: RowError[]
  naturalKey: string
  needsReview: boolean
}

/** Lo que ya está cargado y colisiona con una fila. */
interface Existing {
  id: string
  /** El motivo del conflicto, en español. */
  reason: string
  differing: string[]
}

/** Lo que se va decidiendo fila por fila. */
interface Outcome {
  statuses: Map<string, ImportRowStatus>
  targets: Map<string, string>
  conflicts: Map<string, RowConflict>
}

const error = (field: string, code: string, message: string): RowError => ({
  field,
  code,
  message,
})

const norm = (value: unknown): string | null =>
  value === null || value === undefined || String(value).trim() === ''
    ? null
    : normalizeText(String(value))

/** Campos que el archivo trae con valor y que difieren del registro existente. */
function differingFields(
  incoming: object,
  current: object,
  fields: string[],
): string[] {
  const a = incoming as Record<string, unknown>
  const b = current as Record<string, unknown>
  return fields.filter((field) => {
    const left = norm(a[field])
    const right = norm(b[field])
    return left !== null && right !== null && left !== right
  })
}

const PERSON_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'email',
  'address',
  'notes',
]

const OPERATION_SYNONYMS: Record<string, string> = {
  alquiler: 'rent',
  venta: 'sale',
  'alquiler temporario': 'temporary rent',
}

const operationKey = (name: string): string => {
  const key = normalizeText(name)
  return OPERATION_SYNONYMS[key] ?? key
}

const propertyKey = (data: PropertyRowData): string =>
  `${normalizeAddressKey(data.address)}|${normalizePathKey(data.locationPath)}`

/**
 * El análisis (dry-run) de un lote: arma las filas normalizadas, valida,
 * detecta duplicados, vínculos previos y conflictos con lo ya cargado. No crea
 * ninguna entidad ni maestro (A-70, A-71): sólo lee.
 */
@Injectable()
export class ImportAnalyzer {
  constructor(
    private readonly references: ReferenceDataLoader,
    private readonly links: ImportLinkRepository,
    private readonly owners: OwnersFacade,
    private readonly renters: RentersFacade,
    private readonly properties: PropertiesFacade,
    private readonly contracts: ContractsFacade,
    private readonly tokko: TokkoSourcePort,
  ) {}

  // ------------------------------------------------------------------ Excel

  async analyzeExcel(parsed: ParsedWorkbook): Promise<AnalysisResult> {
    const refs = await this.references.load()
    const sheet = (entity: ImportEntity): SheetRow[] =>
      parsed.sheets.get(entity) ?? []

    const candidates: Candidate[] = []
    const add = (
      entity: ImportEntity,
      row: SheetRow,
      validated: Validated<RowData>,
      naturalKey: string,
      externalId: string | null = null,
    ): Candidate => {
      const candidate: Candidate = {
        id: randomUUID(),
        entity,
        rowNumber: row.rowNumber,
        externalId,
        label: validated.label,
        data: validated.data,
        errors: validated.errors,
        // Un documento inválido no puede chocar con nada.
        naturalKey: validated.errors.some((e) => e.field === 'nationalId')
          ? `invalid:${entity}:${row.rowNumber}`
          : naturalKey,
        needsReview: false,
      }
      candidates.push(candidate)
      return candidate
    }

    for (const row of sheet(ImportEntity.OWNER)) {
      const v = validateOwner(row)
      add(ImportEntity.OWNER, row, v, v.data.nationalId)
    }
    for (const row of sheet(ImportEntity.GUARANTOR)) {
      const v = validateGuarantor(row)
      add(ImportEntity.GUARANTOR, row, v, v.data.nationalId)
    }
    for (const row of sheet(ImportEntity.RENTER)) {
      const v = validateRenter(row)
      add(ImportEntity.RENTER, row, v, v.data.nationalId)
    }

    const propertyByCode = new Map<string, Candidate>()
    for (const row of sheet(ImportEntity.PROPERTY)) {
      const v = validateProperty(row, refs.context)
      const candidate = add(
        ImportEntity.PROPERTY,
        row,
        v,
        propertyKey(v.data),
        v.data.code,
      )
      const code = v.data.code
      if (!code) continue
      if (propertyByCode.has(normalizeText(code))) {
        candidate.errors.push(
          error('code', 'DUPLICATE_CODE', `El código «${code}» está repetido`),
        )
      } else {
        propertyByCode.set(normalizeText(code), candidate)
      }
    }

    const addressOf = (code: string): string | null =>
      (
        propertyByCode.get(normalizeText(code))?.data as
          PropertyRowData | undefined
      )?.address ?? null
    for (const row of sheet(ImportEntity.CONTRACT)) {
      add(ImportEntity.CONTRACT, row, validateContract(row, addressOf), '')
    }

    return this.finalize(ImportSource.EXCEL, candidates, refs, propertyByCode, {
      missingSheets: parsed.missingSheets,
    })
  }

  // ------------------------------------------------------------------ Tokko

  async analyzeTokko(options: BatchOptions): Promise<AnalysisResult> {
    // La primera llamada: con una key inválida falla acá, sin filas parciales.
    await this.tokko.dictionaries()
    const refs = await this.references.load()

    const wanted = new Set(
      (options.operationTypes?.length ? options.operationTypes : ['Rent']).map(
        operationKey,
      ),
    )
    const limit = options.limit && options.limit > 0 ? options.limit : Infinity

    const candidates: Candidate[] = []
    collect: for await (const page of this.tokko.properties()) {
      for (const property of page) {
        const operation = property.operations.find((op) =>
          wanted.has(operationKey(op.type)),
        )
        if (!operation) continue
        candidates.push(this.tokkoCandidate(property, operation, refs, options))
        if (candidates.length >= limit) break collect
      }
    }
    return this.finalize(ImportSource.TOKKO, candidates, refs, new Map(), {
      missingSheets: [],
    })
  }

  private tokkoCandidate(
    property: TokkoProperty,
    operation: TokkoOperation,
    refs: ReferenceData,
    options: BatchOptions,
  ): Candidate {
    const errors: RowError[] = []
    const address = property.address ?? property.fakeAddress
    if (!address) {
      errors.push(
        error('address', 'REQUIRED', 'La propiedad no tiene dirección'),
      )
    }
    if (!property.typeName) {
      errors.push(
        error('propertyType', 'REQUIRED', 'La propiedad no tiene tipo'),
      )
    }

    // "Argentina | Capital Federal | Palermo" → provincia, ciudad, barrio.
    const segments = (property.fullLocation ?? '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
    if (segments.length > 1 && normalizeText(segments[0]) === 'argentina') {
      segments.shift()
    }
    let locationPath: string[] = []
    let locationId: string | null = null
    let needsReview = false
    if (segments.length === 0) {
      needsReview = true
    } else {
      const resolution = refs.context.locations.resolve(segments.slice(0, 3))
      if (resolution.kind === 'FOUND') {
        if (SELECTABLE_LEVELS.includes(resolution.level)) {
          locationPath = resolution.path
          locationId = resolution.id
        } else {
          // Una provincia no sirve de ubicación: se revisa a mano.
          needsReview = true
        }
      } else if (resolution.kind === 'NEW') {
        locationPath = resolution.path
      } else if (resolution.kind === 'UNKNOWN_NAME') {
        locationPath = [resolution.name]
      } else {
        // Ambigua: se carga con el comodín y se revisa a mano.
        needsReview = true
      }
    }

    const price = operation.prices.find(
      (p) => p.currency === 'ARS' || p.currency === 'USD',
    )
    const description = [property.title, property.description]
      .filter(Boolean)
      .join('\n\n')

    const data: PropertyRowData = {
      code: null,
      address: address ?? '',
      locationPath,
      locationId,
      propertyTypeName: property.typeName ?? '',
      propertyTypeId: property.typeName
        ? (refs.context.propertyTypes.get(normalizeText(property.typeName)) ??
          null)
        : null,
      ownerNationalId: null,
      amenityNames: [...new Set(property.tags)],
      listingPrice: price ? toMoneyString(price.price) : null,
      listingCurrency: price ? (price.currency as 'ARS' | 'USD') : null,
      publicDescription: description || null,
      notes: null,
      photos: options.includeAssets
        ? property.photos.map((photo, position) => ({
            url: photo.url,
            position,
          }))
        : [],
    }
    return {
      id: randomUUID(),
      entity: ImportEntity.PROPERTY,
      rowNumber: null,
      externalId: property.id,
      label: address ?? `Tokko ${property.id}`,
      data,
      errors,
      naturalKey: propertyKey(data),
      needsReview,
    }
  }

  // ----------------------------------------------------------- Clasificación

  private async finalize(
    source: ImportSource,
    candidates: Candidate[],
    refs: ReferenceData,
    propertyByCode: Map<string, Candidate>,
    meta: { missingSheets: string[] },
  ): Promise<AnalysisResult> {
    const of = (entity: ImportEntity) =>
      candidates.filter((c) => c.entity === entity)
    const owners = of(ImportEntity.OWNER)
    const guarantors = of(ImportEntity.GUARANTOR)
    const renters = of(ImportEntity.RENTER)
    const properties = of(ImportEntity.PROPERTY)
    const contracts = of(ImportEntity.CONTRACT)
    const data = <T extends RowData>(c: Candidate) => c.data as T

    // Lo que ya está cargado, por documento: una consulta por entidad.
    const [ownersSys, guarantorsSys, rentersSys] = await Promise.all([
      this.owners.findForImport([
        ...owners.map((c) => data<OwnerRowData>(c).nationalId),
        ...properties.flatMap(
          (c) => data<PropertyRowData>(c).ownerNationalId ?? [],
        ),
      ]),
      this.renters.findGuarantorsForImport([
        ...guarantors.map((c) => data<GuarantorRowData>(c).nationalId),
        ...renters.flatMap(
          (c) => data<RenterRowData>(c).guarantorNationalId ?? [],
        ),
      ]),
      this.renters.findRentersForImport([
        ...renters.map((c) => data<RenterRowData>(c).nationalId),
        ...contracts.map((c) => data<ContractRowData>(c).renterNationalId),
      ]),
    ])

    const inFile = (list: Candidate[], dni: string): Candidate | undefined =>
      list.find((c) => (c.data as { nationalId?: string }).nationalId === dni)

    // Referencias entre hojas: un DNI tiene que estar en el archivo o ya cargado.
    for (const property of properties) {
      const dni = data<PropertyRowData>(property).ownerNationalId
      if (!dni) continue
      const row = inFile(owners, dni)
      if (row && row.errors.length > 0) {
        property.errors.push(
          error(
            'ownerNationalId',
            'OWNER_ROW_INVALID',
            `El propietario con DNI ${dni} tiene errores en su fila: corregilo primero`,
          ),
        )
      } else if (!row && !ownersSys.has(dni)) {
        property.errors.push(
          error(
            'ownerNationalId',
            'OWNER_NOT_FOUND',
            `No hay un propietario con DNI ${dni} en el archivo ni cargado`,
          ),
        )
      }
    }
    for (const renter of renters) {
      const dni = data<RenterRowData>(renter).guarantorNationalId
      if (!dni) continue
      const row = inFile(guarantors, dni)
      if (row && row.errors.length > 0) {
        renter.errors.push(
          error(
            'guarantorNationalId',
            'GUARANTOR_ROW_INVALID',
            `El garante con DNI ${dni} tiene errores en su fila: corregilo primero`,
          ),
        )
      } else if (!row && !guarantorsSys.has(dni)) {
        renter.errors.push(
          error(
            'guarantorNationalId',
            'GUARANTOR_NOT_FOUND',
            `No hay un garante con DNI ${dni} en el archivo ni cargado`,
          ),
        )
      }
    }

    // Propiedades existentes por (dirección, ubicación).
    const propertySnapshots = await this.properties.listForImport(
      properties.flatMap((c) => data<PropertyRowData>(c).locationId ?? []),
    )
    const propertyIndex = new Map(
      propertySnapshots.map((p) => [
        `${normalizeAddressKey(p.address)}|${p.locationId}`,
        p,
      ]),
    )
    const ownerIdByDni = new Map(
      [...ownersSys.entries()].map(([dni, o]) => [dni, o.id]),
    )

    const outcome: Outcome = {
      statuses: new Map(),
      targets: new Map(),
      conflicts: new Map(),
    }
    const classify = (
      entity: ImportEntity,
      list: Candidate[],
      find: (c: Candidate) => Existing | null,
    ) => this.classify(source, entity, list, find, outcome)

    await classify(ImportEntity.OWNER, owners, (c) => {
      const row = data<OwnerRowData>(c)
      const found = ownersSys.get(row.nationalId)
      return found
        ? {
            id: found.id,
            reason: `Ya existe un propietario con ese DNI/CUIT: ${found.firstName} ${found.lastName}`,
            differing: differingFields(row, found, [
              ...PERSON_FIELDS,
              'cbu',
              'alias',
              'bankName',
              'holder',
            ]),
          }
        : null
    })
    await classify(ImportEntity.GUARANTOR, guarantors, (c) => {
      const row = data<GuarantorRowData>(c)
      const found = guarantorsSys.get(row.nationalId)
      return found
        ? {
            id: found.id,
            reason: `Ya existe un garante con ese DNI/CUIT: ${found.firstName} ${found.lastName}`,
            differing: differingFields(row, found, PERSON_FIELDS),
          }
        : null
    })
    await classify(ImportEntity.RENTER, renters, (c) => {
      const row = data<RenterRowData>(c)
      const found = rentersSys.get(row.nationalId)
      return found
        ? {
            id: found.id,
            reason: `Ya existe un inquilino con ese DNI/CUIT: ${found.firstName} ${found.lastName}`,
            differing: differingFields(row, found, PERSON_FIELDS),
          }
        : null
    })
    await classify(ImportEntity.PROPERTY, properties, (c) => {
      const row = data<PropertyRowData>(c)
      if (!row.locationId) return null
      const found = propertyIndex.get(
        `${normalizeAddressKey(row.address)}|${row.locationId}`,
      )
      if (!found) return null
      const differing = differingFields(row, found, [
        'listingPrice',
        'publicDescription',
        'notes',
      ])
      const ownerId = row.ownerNationalId
        ? ownerIdByDni.get(row.ownerNationalId)
        : undefined
      if (ownerId && found.ownerId && ownerId !== found.ownerId) {
        differing.push('ownerId')
      }
      return {
        id: found.id,
        reason: `Ya existe una propiedad con esa dirección en la misma ubicación: ${found.address}`,
        differing,
      }
    })

    await this.classifyContracts(source, contracts, {
      propertyByCode,
      renters,
      rentersSys,
      propertySnapshots,
      outcome,
      classify,
    })

    const summary = this.summarize(properties, outcome.statuses, refs)
    summary.missingSheets = meta.missingSheets

    const rows: NewImportRow[] = IMPORT_ORDER.flatMap((entity) =>
      candidates
        .filter((c) => c.entity === entity)
        .map((c) => ({
          id: c.id,
          entity: c.entity,
          rowNumber: c.rowNumber,
          externalId: c.externalId,
          naturalKey: c.naturalKey.slice(0, 300),
          label: c.label.slice(0, 200),
          status: outcome.statuses.get(c.id) ?? ImportRowStatus.ERROR,
          data: c.data,
          errors: c.errors,
          conflict: outcome.conflicts.get(c.id) ?? null,
          resolution: null,
          excluded: false,
          targetId: outcome.targets.get(c.id) ?? null,
          needsReview: c.needsReview,
        })),
    )
    return { rows, summary }
  }

  private linkKey(source: ImportSource, candidate: Candidate): string {
    return source === ImportSource.TOKKO
      ? (candidate.externalId as string)
      : candidate.naturalKey
  }

  /**
   * Estado de cada fila de una entidad: con errores, repetida en el archivo,
   * ya importada antes (vínculo), en conflicto con lo cargado, o válida.
   */
  private async classify(
    source: ImportSource,
    entity: ImportEntity,
    list: Candidate[],
    find: (c: Candidate) => Existing | null,
    outcome: Outcome,
  ): Promise<void> {
    const linked = await this.links.findTargets(
      source,
      entity,
      list
        .filter((c) => c.errors.length === 0)
        .map((c) => this.linkKey(source, c)),
    )
    const firstSeen = new Map<string, Candidate>()

    for (const c of list) {
      if (c.errors.length > 0) {
        outcome.statuses.set(c.id, ImportRowStatus.ERROR)
        continue
      }
      const first = firstSeen.get(c.naturalKey)
      if (first) {
        outcome.statuses.set(c.id, ImportRowStatus.CONFLICT)
        outcome.conflicts.set(c.id, {
          entityId: first.id,
          reason: first.rowNumber
            ? `Está repetida en el archivo (ya figura en la fila ${first.rowNumber})`
            : 'Está repetida en el archivo',
          differingFields: [],
          kind: 'DUPLICATE_IN_FILE',
        })
        continue
      }
      firstSeen.set(c.naturalKey, c)

      const previous = linked.get(this.linkKey(source, c))
      if (previous) {
        outcome.statuses.set(c.id, ImportRowStatus.ALREADY_IMPORTED)
        outcome.targets.set(c.id, previous)
        continue
      }
      const match = find(c)
      if (match) {
        outcome.statuses.set(c.id, ImportRowStatus.CONFLICT)
        outcome.targets.set(c.id, match.id)
        outcome.conflicts.set(c.id, {
          entityId: match.id,
          reason: match.reason,
          differingFields: match.differing,
          kind: 'EXISTING',
        })
        continue
      }
      outcome.statuses.set(c.id, ImportRowStatus.VALID)
    }
  }

  /** Contratos: dependen de propiedades e inquilinos ya clasificados. */
  private async classifyContracts(
    source: ImportSource,
    contracts: Candidate[],
    state: {
      propertyByCode: Map<string, Candidate>
      renters: Candidate[]
      rentersSys: Map<string, { id: string; activeContractId: string | null }>
      propertySnapshots: {
        id: string
        ownerId: string | null
        activeContractId: string | null
      }[]
      outcome: Outcome
      classify: (
        entity: ImportEntity,
        list: Candidate[],
        find: (c: Candidate) => Existing | null,
      ) => Promise<void>
    },
  ): Promise<void> {
    if (contracts.length === 0) return
    const { outcome } = state
    const today = todayIso()
    const snapshotById = new Map(state.propertySnapshots.map((p) => [p.id, p]))

    const refsOf = (c: Candidate) => {
      const row = c.data as ContractRowData
      const property = state.propertyByCode.get(normalizeText(row.propertyCode))
      return {
        row,
        property,
        propertyTarget: property ? outcome.targets.get(property.id) : undefined,
        renterRow: state.renters.find(
          (r) => (r.data as RenterRowData).nationalId === row.renterNationalId,
        ),
        renterSys: state.rentersSys.get(row.renterNationalId),
      }
    }

    for (const c of contracts) {
      if (c.errors.length > 0) continue
      const { row, property, renterRow, renterSys } = refsOf(c)
      if (!property) {
        c.errors.push(
          error(
            'propertyCode',
            'PROPERTY_CODE_UNKNOWN',
            `El código de propiedad «${row.propertyCode}» no está en la hoja Propiedades del archivo`,
          ),
        )
      } else if (outcome.statuses.get(property.id) === ImportRowStatus.ERROR) {
        c.errors.push(
          error(
            'propertyCode',
            'PROPERTY_ROW_INVALID',
            `La propiedad «${row.propertyCode}» tiene errores en su fila: corregila primero`,
          ),
        )
      }
      if (
        renterRow &&
        outcome.statuses.get(renterRow.id) === ImportRowStatus.ERROR
      ) {
        c.errors.push(
          error(
            'renterNationalId',
            'RENTER_ROW_INVALID',
            `El inquilino con DNI ${row.renterNationalId} tiene errores en su fila: corregilo primero`,
          ),
        )
      } else if (!renterRow && !renterSys) {
        c.errors.push(
          error(
            'renterNationalId',
            'RENTER_NOT_FOUND',
            `No hay un inquilino con DNI ${row.renterNationalId} en el archivo ni cargado`,
          ),
        )
      }
      if (property && c.errors.length === 0) {
        // Un contrato necesita propietario: sale de la propiedad.
        const target = outcome.targets.get(property.id)
        const snapshot = target ? snapshotById.get(target) : undefined
        if (
          !(property.data as PropertyRowData).ownerNationalId &&
          !snapshot?.ownerId
        ) {
          c.errors.push(
            error(
              'propertyCode',
              'PROPERTY_WITHOUT_OWNER',
              `La propiedad «${row.propertyCode}» no tiene propietario: indicá el DNI del propietario en la hoja Propiedades`,
            ),
          )
        }
        c.naturalKey = `${property.naturalKey}|${row.renterNationalId}|${row.startDate}`
      } else if (c.naturalKey === '') {
        c.naturalKey = `invalid:${c.entity}:${c.rowNumber}`
      }
    }
    for (const c of contracts) {
      if (c.naturalKey === '')
        c.naturalKey = `invalid:${c.entity}:${c.rowNumber}`
    }

    // Contratos ya cargados de las propiedades que ya existen.
    const knownPropertyIds = [
      ...new Set(contracts.flatMap((c) => refsOf(c).propertyTarget ?? [])),
    ]
    const existingContracts =
      await this.contracts.listForImport(knownPropertyIds)

    await state.classify(ImportEntity.CONTRACT, contracts, (c) => {
      const { row, propertyTarget, renterSys } = refsOf(c)
      if (!propertyTarget || !renterSys) return null
      const found = existingContracts.find(
        (e) =>
          e.propertyId === propertyTarget &&
          e.renterId === renterSys.id &&
          e.startDate === row.startDate,
      )
      return found
        ? {
            id: found.id,
            reason:
              'Ya existe un contrato igual (misma propiedad, inquilino y fecha de inicio)',
            differing: [],
          }
        : null
    })

    // Una propiedad o un inquilino no pueden tener dos contratos vigentes a
    // la vez (RN-04, RN-05): el segundo es un error de superposición.
    const activeProperties = new Set<string>()
    const activeRenters = new Set<string>()
    for (const c of contracts) {
      if (outcome.statuses.get(c.id) !== ImportRowStatus.VALID) continue
      const { row, property, propertyTarget, renterSys } = refsOf(c)
      if (row.endDate < today || !property) continue

      const snapshot = propertyTarget
        ? snapshotById.get(propertyTarget)
        : undefined
      if (snapshot?.activeContractId || activeProperties.has(property.id)) {
        c.errors.push(
          error(
            'propertyCode',
            'CONTRACT_OVERLAP',
            `La propiedad «${row.propertyCode}» ya tiene un contrato vigente que se superpone`,
          ),
        )
      }
      if (
        renterSys?.activeContractId ||
        activeRenters.has(row.renterNationalId)
      ) {
        c.errors.push(
          error(
            'renterNationalId',
            'RENTER_ALREADY_ACTIVE',
            `El inquilino con DNI ${row.renterNationalId} ya tiene otro contrato vigente`,
          ),
        )
      }
      if (c.errors.length > 0) {
        outcome.statuses.set(c.id, ImportRowStatus.ERROR)
      } else {
        activeProperties.add(property.id)
        activeRenters.add(row.renterNationalId)
      }
    }
    // El `source` no cambia la lógica de contratos: sólo Excel los trae.
    void source
  }

  // ----------------------------------------------------------------- Resumen

  /** Maestros que la confirmación va a crear: sólo de las propiedades que se importarían. */
  private summarize(
    properties: Candidate[],
    statuses: Map<string, ImportRowStatus>,
    refs: ReferenceData,
  ): BatchSummary {
    const types = new Set<string>()
    const amenities = new Set<string>()
    const locations = new Set<string>()

    for (const c of properties) {
      if (statuses.get(c.id) !== ImportRowStatus.VALID) continue
      const row = c.data as PropertyRowData
      if (!row.propertyTypeId && row.propertyTypeName) {
        types.add(normalizeText(row.propertyTypeName))
      }
      for (const name of row.amenityNames) {
        if (!refs.amenities.has(normalizeText(name))) {
          amenities.add(normalizeText(name))
        }
      }
      if (!row.locationId) {
        if (row.locationPath.length === 0) locations.add('unknown-location')
        for (const key of refs.context.locations.missingNodeKeys(
          row.locationPath,
        )) {
          locations.add(key)
        }
      }
    }

    return {
      missingSheets: [],
      mastersToCreate: {
        locations: locations.size,
        propertyTypes: types.size,
        amenities: amenities.size,
      },
      mastersCreated: { locations: 0, propertyTypes: 0, amenities: 0 },
    }
  }
}
