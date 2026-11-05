import {
  CollectionMode,
  Currency,
  DepositReturnMode,
  FeeMode,
  RentUpdateFrequency,
  RentUpdateType,
} from '@/modules/contracts/domain/contract'
import { GuaranteeType } from '@/modules/renters/domain/guarantor'
import { IsoDate } from '@/shared/dates/calendar-date'
import { InquirySource, InquiryStage } from '@/modules/crm/domain/inquiry'

/** Marca de demo: va en notas y nombres para distinguir estos datos de los reales. */
export const DEMO_MARK = 'DEMO'

export interface BankSeed {
  cbu: string
  alias: string
  bankName: string
  holder: string
}

export interface GuarantorSeed {
  code: string
  firstName: string
  lastName: string
  nationalId: string
  email: string | null
  phone: string | null
  address: string | null
  guaranteeType: GuaranteeType
  guaranteeDetail: string
}

export interface OwnerSeed {
  code: string
  firstName: string
  lastName: string
  nationalId: string
  email: string | null
  phone: string | null
  address: string | null
  bank: BankSeed | null
  /** Con acceso al portal de propietarios. */
  portal: boolean
  /** Honorario propio (%); sin él rige la regla por umbral de la inmobiliaria. */
  feePercentage?: string
  note: string
}

export interface RenterSeed {
  code: string
  firstName: string
  lastName: string
  nationalId: string
  email: string | null
  phone: string | null
  address: string | null
  guarantor: string | null
  /** Con acceso al portal de inquilinos. */
  portal: boolean
  note: string
}

export type PropertyStatusSeed = 'AUTO' | 'MAINTENANCE'

export interface PropertySeed {
  code: string
  address: string
  /** Nombre del barrio (maestro de ubicaciones). */
  neighborhood: string
  propertyType: string
  /** Código del propietario; null = propiedad sin propietario. */
  owner: string | null
  listingPrice: string | null
  listingCurrency: 'ARS' | 'USD'
  operation: 'RENT' | 'SALE'
  publicDescription: string | null
  bedrooms: number | null
  bathrooms: number | null
  totalAreaM2: number | null
  latitude: number | null
  longitude: number | null
  status: PropertyStatusSeed
  /** Cuántas fotos placeholder lleva (0 = ninguna). */
  photos: number
  note: string
}

/** Cómo se paga una cuota en el historial. */
export type PaymentHow =
  /** Todo lo adeudado a esa fecha (con punitorio si pasó la gracia). */
  | 'full'
  /** Una fracción del alquiler. */
  | 'partial'
  /** Lo adeudado más un excedente, que queda como saldo a favor. */
  | 'overpay'
  /** En otra moneda, con cotización (contratos en dólares). */
  | 'foreign'
  /** El propietario cobra directo: queda informado, pendiente de confirmar. */
  | 'informed'

export interface PaymentPlan {
  /** Día del mes del pago (1-based); se recorta al día de hoy. */
  day: number
  how: PaymentHow
  /** `partial`: fracción del alquiler, como string decimal ("0.5"). */
  fraction?: string
  /** `overpay`: excedente en la moneda del contrato. */
  extra?: string
  /** `foreign`: pesos por dólar. */
  rate?: string
  /** Confirma el pago informado (sólo `informed`). */
  confirm?: boolean
  method?: 'TRANSFER' | 'CASH'
}

export type SettleMode = 'close' | 'draft'

export interface ContractSeed {
  /** C-01..C-12 del plan de pruebas (o D-01.. en la segunda inmobiliaria). */
  code: string
  /** Qué prueba, tal como lo dice el plan. */
  covers: string
  property: string
  renter: string
  /** `undefined`: el garante del inquilino; `null`: ninguno. */
  guarantor?: string | null
  start: IsoDate
  end: IsoDate
  rent: string
  currency: Currency
  updateType: RentUpdateType
  updateFrequency: RentUpdateFrequency
  fixedIncreasePercentage?: string
  deposit: string
  depositCurrency?: Currency
  depositMode: DepositReturnMode
  surety?: {
    insurerName: string
    insurerAlertEmail: string
    policyNumber: string
    policyExpiresAt: IsoDate
  }
  collectionMode?: CollectionMode
  feeMode?: FeeMode
  feeAmount?: string
  lateFeePercentage?: string
  lateFeeGraceDays?: number
  /**
   * Pago por período, por offset de mes (-1 = mes pasado). Lo que no figura
   * se paga al día (`full`, día 3) en los meses cerrados; `null` = sin pagar.
   * El mes actual y el que viene no se pagan salvo que figuren acá.
   */
  payments?: Record<number, PaymentPlan | null>
  /** Liquidaciones, después de procesar el mes `after`. */
  settlements?: { after: number; mode: SettleMode }[]
  /** Rescisión, después de procesar el mes `after`. */
  terminate?: { after: number; notifiedAt: IsoDate }
  /**
   * Se crea recién cuando ese otro contrato (código) ya fue rescindido: un
   * inquilino no puede tener dos contratos activos a la vez (RN-05).
   */
  createAfterTerminationOf?: string
}

export interface ServiceSeed {
  /** Propiedad (código). */
  property: string
  /** Contrato (código) o null = servicio de la propiedad, heredado. */
  contract: string | null
  serviceType: string
  paidBy: 'RENTER' | 'OWNER'
  currency: Currency
  dueDate: IsoDate | null
  increaseFrequency: RentUpdateFrequency | null
  managedByAgency: boolean
  note: string
}

export interface AdvanceExpenseSeed {
  contract: string
  amount: string
  description: string
  expenseDate: IsoDate
}

export interface InquirySeed {
  name: string
  email: string | null
  phone: string | null
  message: string
  property: string | null
  source: InquirySource
  stage: InquiryStage
  lostReason?: string
}

export interface UserSeed {
  email: string
  firstName: string
  lastName: string
}

export interface TenantPlan {
  /** 1 o 2: serie de DNI y de datos. */
  series: 1 | 2
  slug: string
  name: string
  /** Punitorio diario de la inmobiliaria, en %. Explícito: no hay default del sistema. */
  dailyLateFeePercentage: string
  paymentGraceDays: number
  legal: {
    legalName: string
    taxId: string
    address: string
    phone: string
    email: string
    bank: BankSeed
  }
  admin: UserSeed
  employee: UserSeed
  guarantors: GuarantorSeed[]
  owners: OwnerSeed[]
  renters: RenterSeed[]
  properties: PropertySeed[]
  contracts: ContractSeed[]
  services: ServiceSeed[]
  advanceExpenses: AdvanceExpenseSeed[]
  inquiries: InquirySeed[]
  /** Suma Rosario / Pichincha y el tipo "Galpón" a los maestros. */
  extraMasterData: boolean
}

export interface DemoPlan {
  /** Contraseña de todos los usuarios de demo. SOLO DEMO. */
  password: string
  tenants: TenantPlan[]
}
