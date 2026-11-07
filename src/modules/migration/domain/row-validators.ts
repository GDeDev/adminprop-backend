import { isEmail } from 'class-validator'

import { PersonPolicy } from '@/shared/people/person-policy'
import {
  CellValue,
  cellNotes,
  cellText,
  COLLECTION_MODES,
  CURRENCIES,
  GUARANTEE_TYPES,
  lookup,
  normalizeText,
  parseDate,
  parseMoney,
  parsePercentage,
  splitPath,
  UPDATE_FREQUENCIES,
  UPDATE_TYPES,
} from './import-normalizers'
import {
  LocationIndex,
  LocationResolution,
  MAX_PATH_LENGTH,
  SELECTABLE_LEVELS,
} from './location-index'
import {
  ContractRowData,
  GuarantorRowData,
  OwnerRowData,
  PersonRowData,
  PropertyRowData,
  RenterRowData,
  RowError,
} from './migration.types'

/** Una fila de una hoja: las celdas por clave de columna. */
export interface SheetRow {
  rowNumber: number
  cells: Record<string, CellValue>
}

/** Lo que los validadores necesitan saber del tenant. */
export interface ValidationContext {
  locations: LocationIndex
  /** Nombre normalizado → id, de los tipos de propiedad existentes. */
  propertyTypes: Map<string, string>
}

export interface Validated<T> {
  data: T
  errors: RowError[]
  /** Texto que identifica la fila en pantalla. */
  label: string
}

const error = (field: string, code: string, message: string): RowError => ({
  field,
  code,
  message,
})

function required(
  errors: RowError[],
  field: string,
  label: string,
  value: string | null,
): string {
  if (value === null) errors.push(error(field, 'REQUIRED', `Falta ${label}`))
  return value ?? ''
}

function maxLength(
  errors: RowError[],
  field: string,
  label: string,
  value: string | null,
  max: number,
): void {
  if (value !== null && value.length > max) {
    errors.push(
      error(
        field,
        'TOO_LONG',
        `${label} es demasiado largo (máximo ${max} caracteres)`,
      ),
    )
  }
}

function person(
  cells: Record<string, CellValue>,
  errors: RowError[],
): PersonRowData {
  const firstName = required(
    errors,
    'firstName',
    'el nombre',
    cellText(cells.firstName),
  )
  const lastName = required(
    errors,
    'lastName',
    'el apellido',
    cellText(cells.lastName),
  )
  maxLength(errors, 'firstName', 'El nombre', firstName, 100)
  maxLength(errors, 'lastName', 'El apellido', lastName, 100)

  const rawId = cellText(cells.nationalId)
  let nationalId = ''
  if (rawId === null) {
    errors.push(error('nationalId', 'REQUIRED', 'Falta el DNI/CUIT'))
  } else {
    const parsed = PersonPolicy.parseNationalId(rawId)
    if (parsed) nationalId = parsed
    else
      errors.push(
        error(
          'nationalId',
          'INVALID_NATIONAL_ID',
          `El DNI/CUIT «${rawId}» tiene que tener entre 7 y 11 dígitos`,
        ),
      )
  }

  const rawEmail = cellText(cells.email)
  if (rawEmail !== null && !isEmail(rawEmail)) {
    errors.push(
      error('email', 'INVALID_EMAIL', `El email «${rawEmail}» no es válido`),
    )
  }
  const phone = cellText(cells.phone)
  const address = cellText(cells.address)
  maxLength(errors, 'phone', 'El teléfono', phone, 50)
  maxLength(errors, 'address', 'El domicilio', address, 200)

  return {
    firstName,
    lastName,
    nationalId,
    phone,
    email: rawEmail?.toLowerCase() ?? null,
    address,
    notes: cellNotes(cells.notes),
  }
}

const personLabel = (data: PersonRowData): string =>
  [data.firstName, data.lastName].filter(Boolean).join(' ') ||
  data.nationalId ||
  '(sin nombre)'

/**
 * `isValidCbu` es la regla del módulo de propietarios (los dígitos
 * verificadores, `OwnersFacade.isValidCbu`): la migración no la copia, la
 * recibe. Sin ella, una fila con un CBU mal tipeado salía `VALID` en el
 * preview y recién fallaba al confirmar.
 */
export function validateOwner(
  row: SheetRow,
  isValidCbu: (cbu: string) => boolean = () => true,
): Validated<OwnerRowData> {
  const errors: RowError[] = []
  const base = person(row.cells, errors)
  const cbu = cellText(row.cells.cbu)?.replace(/[\s-]/g, '') ?? null
  if (cbu !== null && !/^\d{22}$/.test(cbu)) {
    errors.push(
      error('cbu', 'INVALID_CBU', 'El CBU tiene que tener 22 dígitos'),
    )
  } else if (cbu !== null && !isValidCbu(cbu)) {
    errors.push(
      error(
        'cbu',
        'INVALID_CBU',
        'El CBU no es válido: revisá que no tenga un dígito mal tipeado',
      ),
    )
  }
  const data: OwnerRowData = {
    ...base,
    cbu,
    alias: cellText(row.cells.alias)?.toLowerCase() ?? null,
    bankName: cellText(row.cells.bankName),
    holder: cellText(row.cells.holder),
  }
  return { data, errors, label: personLabel(data) }
}

export function validateGuarantor(row: SheetRow): Validated<GuarantorRowData> {
  const errors: RowError[] = []
  const base = person(row.cells, errors)
  const type = lookup(row.cells.guaranteeType, GUARANTEE_TYPES)
  if (type === undefined) {
    errors.push(
      error(
        'guaranteeType',
        'INVALID_GUARANTEE_TYPE',
        `El tipo de garantía «${cellText(row.cells.guaranteeType)}» no existe (usá Inmueble o Recibos de sueldo)`,
      ),
    )
  }
  const detail = cellText(row.cells.guaranteeDetail)
  const data: GuarantorRowData = {
    ...base,
    guaranteeType: type ?? 'PAYSLIPS',
    // El detalle es obligatorio en el alta manual; una migración sin él lo
    // deja marcado para completar.
    guaranteeDetail: detail ?? 'Importado sin detalle: completar',
  }
  maxLength(errors, 'guaranteeDetail', 'El detalle de la garantía', detail, 500)
  return { data, errors, label: personLabel(data) }
}

export function validateRenter(row: SheetRow): Validated<RenterRowData> {
  const errors: RowError[] = []
  const base = person(row.cells, errors)
  const rawGuarantor = cellText(row.cells.guarantorNationalId)
  let guarantorNationalId: string | null = null
  if (rawGuarantor !== null) {
    guarantorNationalId = PersonPolicy.parseNationalId(rawGuarantor)
    if (!guarantorNationalId) {
      errors.push(
        error(
          'guarantorNationalId',
          'INVALID_NATIONAL_ID',
          `El DNI del garante «${rawGuarantor}» tiene que tener entre 7 y 11 dígitos`,
        ),
      )
    }
  }
  const data: RenterRowData = { ...base, guarantorNationalId }
  return { data, errors, label: personLabel(data) }
}

function describeResolution(
  resolution: LocationResolution,
  errors: RowError[],
): void {
  switch (resolution.kind) {
    case 'AMBIGUOUS':
      errors.push(
        error(
          'location',
          'AMBIGUOUS_LOCATION',
          `«${resolution.name}» existe en más de un lugar: indicá la ruta Provincia > Ciudad > Barrio`,
        ),
      )
      break
    case 'UNKNOWN_NAME':
      errors.push(
        error(
          'location',
          'UNKNOWN_LOCATION',
          `La ubicación «${resolution.name}» no existe: para crearla indicá la ruta Provincia > Ciudad > Barrio`,
        ),
      )
      break
    case 'FOUND':
      if (!SELECTABLE_LEVELS.includes(resolution.level)) {
        errors.push(
          error(
            'location',
            'LOCATION_TOO_GENERAL',
            `La ubicación «${resolution.path.join(' > ')}» es demasiado general: elegí una localidad o un barrio`,
          ),
        )
      }
      break
    case 'TOO_DEEP':
      errors.push(
        error(
          'location',
          'LOCATION_TOO_DEEP',
          `La ubicación admite hasta ${MAX_PATH_LENGTH} niveles: Provincia > Ciudad > Barrio`,
        ),
      )
      break
    default:
  }
}

export function validateProperty(
  row: SheetRow,
  context: ValidationContext,
): Validated<PropertyRowData> {
  const errors: RowError[] = []
  const address = required(
    errors,
    'address',
    'la dirección',
    cellText(row.cells.address),
  )
  maxLength(errors, 'address', 'La dirección', address, 200)

  const locationText = cellText(row.cells.location)
  let locationPath: string[] = []
  let locationId: string | null = null
  if (locationText === null) {
    errors.push(error('location', 'REQUIRED', 'Falta la ubicación'))
  } else {
    const resolution = context.locations.resolve(splitPath(locationText))
    describeResolution(resolution, errors)
    if (resolution.kind === 'FOUND') {
      locationPath = resolution.path
      locationId = resolution.id
    } else if (resolution.kind === 'NEW') {
      locationPath = resolution.path
    }
  }

  const typeName = required(
    errors,
    'propertyType',
    'el tipo de propiedad',
    cellText(row.cells.propertyType),
  )
  const propertyTypeId = typeName
    ? (context.propertyTypes.get(normalizeText(typeName)) ?? null)
    : null

  const rawOwner = cellText(row.cells.ownerNationalId)
  let ownerNationalId: string | null = null
  if (rawOwner !== null) {
    ownerNationalId = PersonPolicy.parseNationalId(rawOwner)
    if (!ownerNationalId) {
      errors.push(
        error(
          'ownerNationalId',
          'INVALID_NATIONAL_ID',
          `El DNI del propietario «${rawOwner}» tiene que tener entre 7 y 11 dígitos`,
        ),
      )
    }
  }

  const price = parseMoney(row.cells.listingPrice)
  if (price === undefined) {
    errors.push(
      error(
        'listingPrice',
        'INVALID_MONEY',
        `El precio «${cellText(row.cells.listingPrice)}» no es un monto válido`,
      ),
    )
  }
  const currency = lookup(row.cells.listingCurrency, CURRENCIES)
  if (currency === undefined) {
    errors.push(
      error(
        'listingCurrency',
        'INVALID_CURRENCY',
        `La moneda «${cellText(row.cells.listingCurrency)}» no existe (ARS o USD)`,
      ),
    )
  }

  const amenityNames = [
    ...new Set(
      (cellText(row.cells.amenities) ?? '')
        .split(/[,;]/)
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ]

  const data: PropertyRowData = {
    code: cellText(row.cells.code),
    address,
    locationPath,
    locationId,
    propertyTypeName: typeName,
    propertyTypeId,
    ownerNationalId,
    amenityNames,
    listingPrice: price ?? null,
    listingCurrency: currency ?? null,
    publicDescription: cellNotes(row.cells.publicDescription),
    notes: cellNotes(row.cells.notes),
    photos: [],
  }
  return { data, errors, label: address || '(sin dirección)' }
}

export function validateContract(
  row: SheetRow,
  propertyLabelOf: (code: string) => string | null,
): Validated<ContractRowData> {
  const errors: RowError[] = []
  const propertyCode = required(
    errors,
    'propertyCode',
    'el código de la propiedad',
    cellText(row.cells.propertyCode),
  )
  const rawRenter = cellText(row.cells.renterNationalId)
  let renterNationalId = ''
  if (rawRenter === null) {
    errors.push(
      error('renterNationalId', 'REQUIRED', 'Falta el DNI del inquilino'),
    )
  } else {
    const parsed = PersonPolicy.parseNationalId(rawRenter)
    if (parsed) renterNationalId = parsed
    else
      errors.push(
        error(
          'renterNationalId',
          'INVALID_NATIONAL_ID',
          `El DNI del inquilino «${rawRenter}» tiene que tener entre 7 y 11 dígitos`,
        ),
      )
  }

  const date = (field: string, label: string, value: CellValue): string => {
    const parsed = parseDate(value)
    if (parsed === null) {
      errors.push(error(field, 'REQUIRED', `Falta la fecha de ${label}`))
      return ''
    }
    if (parsed === undefined) {
      errors.push(
        error(
          field,
          'INVALID_DATE',
          `La fecha de ${label} «${cellText(value)}» no es válida (usá dd/mm/aaaa)`,
        ),
      )
      return ''
    }
    return parsed
  }
  const startDate = date('startDate', 'inicio', row.cells.startDate)
  const endDate = date('endDate', 'fin', row.cells.endDate)
  if (startDate && endDate && endDate <= startDate) {
    errors.push(
      error(
        'endDate',
        'DATES_INVALID',
        'La fecha de fin tiene que ser posterior a la de inicio',
      ),
    )
  }

  const rent = parseMoney(row.cells.initialRent)
  let initialRent = ''
  if (rent === null) {
    errors.push(error('initialRent', 'REQUIRED', 'Falta el alquiler inicial'))
  } else if (rent === undefined || Number(rent) <= 0) {
    errors.push(
      error(
        'initialRent',
        'INVALID_MONEY',
        `El alquiler «${cellText(row.cells.initialRent)}» no es un monto válido`,
      ),
    )
  } else {
    initialRent = rent
  }

  const currency = lookup(row.cells.currency, CURRENCIES)
  if (!currency) {
    errors.push(
      error(
        'currency',
        currency === null ? 'REQUIRED' : 'INVALID_CURRENCY',
        currency === null
          ? 'Falta la moneda'
          : `La moneda «${cellText(row.cells.currency)}» no existe (ARS o USD)`,
      ),
    )
  }

  const updateType = lookup(row.cells.rentUpdateType, UPDATE_TYPES)
  if (updateType === undefined) {
    errors.push(
      error(
        'rentUpdateType',
        'INVALID_UPDATE_TYPE',
        `El índice de aumento «${cellText(row.cells.rentUpdateType)}» no existe (ICL, IPC, Fijo u Otro)`,
      ),
    )
  }
  const frequency = lookup(row.cells.rentUpdateFrequency, UPDATE_FREQUENCIES)
  if (frequency === undefined) {
    errors.push(
      error(
        'rentUpdateFrequency',
        'INVALID_UPDATE_FREQUENCY',
        `La frecuencia «${cellText(row.cells.rentUpdateFrequency)}» no existe`,
      ),
    )
  }
  const percentage = parsePercentage(row.cells.fixedIncreasePercentage)
  if (percentage === undefined) {
    errors.push(
      error(
        'fixedIncreasePercentage',
        'INVALID_PERCENTAGE',
        'El % fijo tiene que ser un número entre 0 y 100',
      ),
    )
  }
  if (updateType === 'FIXED' && !percentage) {
    errors.push(
      error(
        'fixedIncreasePercentage',
        'FIXED_PERCENTAGE_REQUIRED',
        'Con aumento Fijo hay que indicar el % fijo',
      ),
    )
  }

  const deposit = parseMoney(row.cells.deposit)
  if (deposit === undefined) {
    errors.push(
      error(
        'deposit',
        'INVALID_MONEY',
        `El depósito «${cellText(row.cells.deposit)}» no es un monto válido`,
      ),
    )
  }
  const depositCurrency = lookup(row.cells.depositCurrency, CURRENCIES)
  if (depositCurrency === undefined) {
    errors.push(
      error(
        'depositCurrency',
        'INVALID_CURRENCY',
        `La moneda del depósito «${cellText(row.cells.depositCurrency)}» no existe (ARS o USD)`,
      ),
    )
  }
  const collection = lookup(row.cells.collectionMode, COLLECTION_MODES)
  if (collection === undefined) {
    errors.push(
      error(
        'collectionMode',
        'INVALID_COLLECTION_MODE',
        `La modalidad de cobro «${cellText(row.cells.collectionMode)}» no existe (Inmobiliaria o Propietario)`,
      ),
    )
  }

  const data: ContractRowData = {
    propertyCode,
    propertyLabel: propertyLabelOf(propertyCode) ?? propertyCode,
    renterNationalId,
    startDate,
    endDate,
    initialRent,
    currency: currency || 'ARS',
    // Sin dato, el aumento queda manual y anual: la app avisa en vez de
    // aplicar un índice que nadie eligió.
    rentUpdateType: updateType ?? 'OTHER',
    rentUpdateFrequency: frequency ?? 'ANNUAL',
    fixedIncreasePercentage:
      updateType === 'FIXED' ? (percentage ?? null) : null,
    deposit: deposit ?? '0.00',
    depositCurrency: depositCurrency ?? (currency || 'ARS'),
    collectionMode: collection ?? 'AGENCY',
    notes: cellNotes(row.cells.notes),
  }
  return {
    data,
    errors,
    label: `${data.propertyLabel} · DNI ${renterNationalId || '?'}`,
  }
}
