import { ImportEntity } from './migration.types'

/**
 * Versión de la plantilla del Excel. Si cambian los encabezados, se sube: un
 * archivo con otra versión se rechaza (422 `TEMPLATE_VERSION_MISMATCH`).
 */
export const TEMPLATE_VERSION = '1'

/** Límites del archivo (A-78). */
export const MAX_ROWS_PER_FILE = 5000
export const MAX_FILE_BYTES = 10 * 1024 * 1024
/**
 * Tope del archivo ya descomprimido. Una plantilla con 5.000 filas completas
 * pesa muy por debajo; esto sólo frena a las zip bombs.
 */
export const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
/** Un .xlsx real trae decenas de partes, no cientos. */
export const MAX_ZIP_ENTRIES = 500

export const INSTRUCTIONS_SHEET = 'Instrucciones'
export const LISTS_SHEET = 'Listas'
/** Hoja (oculta) donde se guarda la versión de la plantilla. */
export const META_SHEET = 'Meta'

/** Valores desplegables de una columna. */
export type ListName =
  | 'propertyTypes'
  | 'locations'
  | 'currencies'
  | 'rentUpdateTypes'
  | 'rentUpdateFrequencies'
  | 'collectionModes'
  | 'guaranteeTypes'

export interface ColumnDef {
  /** Clave interna del campo. */
  key: string
  /** Encabezado en español, tal como lo ve quien completa el Excel. */
  header: string
  required?: boolean
  /** Valor de la fila de ejemplo (gris, el importador la ignora). */
  example: string | number
  list?: ListName
  width?: number
}

export interface SheetDef {
  entity: ImportEntity
  name: string
  columns: ColumnDef[]
  hint: string
}

const PERSON_COLUMNS: ColumnDef[] = [
  { key: 'firstName', header: 'Nombre', required: true, example: 'María' },
  { key: 'lastName', header: 'Apellido', required: true, example: 'Gómez' },
  {
    key: 'nationalId',
    header: 'DNI/CUIT',
    required: true,
    example: '27123456789',
  },
  { key: 'phone', header: 'Teléfono', example: '11 5555-1234' },
  { key: 'email', header: 'Email', example: 'maria@ejemplo.com' },
  { key: 'address', header: 'Domicilio', example: 'Av. Rivadavia 1234, CABA' },
]

const NOTES: ColumnDef = {
  key: 'notes',
  header: 'Notas',
  example: 'Dato de ejemplo',
  width: 30,
}

export const SHEETS: SheetDef[] = [
  {
    entity: ImportEntity.OWNER,
    name: 'Propietarios',
    hint: 'Una fila por propietario. El DNI/CUIT identifica a la persona.',
    columns: [
      ...PERSON_COLUMNS,
      { key: 'cbu', header: 'CBU', example: '0110599552000000123456' },
      { key: 'alias', header: 'Alias', example: 'maria.gomez.mp' },
      { key: 'bankName', header: 'Banco', example: 'Banco Nación' },
      { key: 'holder', header: 'Titular', example: 'María Gómez' },
      NOTES,
    ],
  },
  {
    entity: ImportEntity.GUARANTOR,
    name: 'Garantes',
    hint: 'Una fila por garante. Se enlazan con el inquilino por el DNI del garante.',
    columns: [
      ...PERSON_COLUMNS,
      {
        key: 'guaranteeType',
        header: 'Tipo de garantía',
        example: 'Recibos de sueldo',
        list: 'guaranteeTypes',
      },
      {
        key: 'guaranteeDetail',
        header: 'Detalle de la garantía',
        example: 'Empleado en relación de dependencia',
        width: 34,
      },
      NOTES,
    ],
  },
  {
    entity: ImportEntity.RENTER,
    name: 'Inquilinos',
    hint: 'Una fila por inquilino. El garante se enlaza por su DNI.',
    columns: [
      ...PERSON_COLUMNS,
      {
        key: 'guarantorNationalId',
        header: 'DNI del garante',
        example: '20111222333',
      },
      NOTES,
    ],
  },
  {
    entity: ImportEntity.PROPERTY,
    name: 'Propiedades',
    hint: 'Una fila por propiedad. El Código es la clave con la que la hoja de Contratos la encuentra.',
    columns: [
      { key: 'code', header: 'Código', example: 'P-001', width: 12 },
      {
        key: 'address',
        header: 'Dirección',
        required: true,
        example: 'Av. Santa Fe 1234 3° B',
        width: 30,
      },
      {
        key: 'location',
        header: 'Ubicación',
        required: true,
        example: 'Buenos Aires > CABA > Palermo',
        list: 'locations',
        width: 34,
      },
      {
        key: 'propertyType',
        header: 'Tipo',
        required: true,
        example: 'Departamento',
        list: 'propertyTypes',
      },
      {
        key: 'ownerNationalId',
        header: 'DNI del propietario',
        example: '27123456789',
      },
      {
        key: 'amenities',
        header: 'Amenities (separados por coma)',
        example: 'Balcón, Cochera',
        width: 30,
      },
      { key: 'listingPrice', header: 'Precio de publicación', example: 450000 },
      {
        key: 'listingCurrency',
        header: 'Moneda',
        example: 'ARS',
        list: 'currencies',
        width: 10,
      },
      {
        key: 'publicDescription',
        header: 'Descripción pública',
        example: 'Luminoso, a una cuadra del subte',
        width: 34,
      },
      NOTES,
    ],
  },
  {
    entity: ImportEntity.CONTRACT,
    name: 'Contratos',
    hint: 'Una fila por contrato. Se enlaza por el Código de la propiedad y el DNI del inquilino, que tienen que estar en este archivo o ya cargados.',
    columns: [
      {
        key: 'propertyCode',
        header: 'Código de propiedad',
        required: true,
        example: 'P-001',
      },
      {
        key: 'renterNationalId',
        header: 'DNI del inquilino',
        required: true,
        example: '30111222',
      },
      {
        key: 'startDate',
        header: 'Inicio',
        required: true,
        example: '01/03/2025',
      },
      { key: 'endDate', header: 'Fin', required: true, example: '28/02/2027' },
      {
        key: 'initialRent',
        header: 'Alquiler inicial',
        required: true,
        example: 450000,
      },
      {
        key: 'currency',
        header: 'Moneda',
        required: true,
        example: 'ARS',
        list: 'currencies',
        width: 10,
      },
      {
        key: 'rentUpdateType',
        header: 'Índice de aumento',
        example: 'ICL',
        list: 'rentUpdateTypes',
      },
      {
        key: 'rentUpdateFrequency',
        header: 'Frecuencia de aumento',
        example: 'Trimestral',
        list: 'rentUpdateFrequencies',
      },
      { key: 'fixedIncreasePercentage', header: '% fijo', example: '' },
      { key: 'deposit', header: 'Depósito', example: 450000 },
      {
        key: 'depositCurrency',
        header: 'Moneda del depósito',
        example: 'ARS',
        list: 'currencies',
      },
      {
        key: 'collectionMode',
        header: 'Modalidad de cobro',
        example: 'Inmobiliaria',
        list: 'collectionModes',
      },
      NOTES,
    ],
  },
]

export function sheetOf(entity: ImportEntity): SheetDef {
  return SHEETS.find((sheet) => sheet.entity === entity) as SheetDef
}

export const LIST_VALUES: Record<
  Exclude<ListName, 'propertyTypes' | 'locations'>,
  string[]
> = {
  currencies: ['ARS', 'USD'],
  rentUpdateTypes: ['ICL', 'IPC', 'Fijo', 'Otro'],
  rentUpdateFrequencies: [
    'Mensual',
    'Trimestral',
    'Cuatrimestral',
    'Semestral',
    'Anual',
  ],
  collectionModes: ['Inmobiliaria', 'Propietario'],
  guaranteeTypes: ['Inmueble', 'Recibos de sueldo'],
}
