import {
  CollectionMode,
  Currency,
  DepositReturnMode,
  FeeMode,
  RentUpdateFrequency,
  RentUpdateType,
} from '@/modules/contracts/domain/contract'
import {
  ContractDocumentKind,
  SuretyData,
} from '@/modules/contracts/domain/contract.ports'

/** Las condiciones de un contrato tal como las manda el cliente. */
export interface ContractTerms {
  startDate: string
  endDate: string
  initialRent: string
  currency: Currency
  rentUpdateType: RentUpdateType
  rentUpdateFrequency: RentUpdateFrequency
  deposit: string
  /** Null: la del contrato. */
  depositCurrency: Currency | null
  /** Null: FIXED. */
  depositReturnMode: DepositReturnMode | null
  fixedIncreasePercentage: string | null
  notes: string | null
  surety: SuretyData
  /** Términos de cobro iniciales; lo que no venga toma el default (D-70). */
  billing: BillingTermsInput
}

/** Los términos de cobro tal como los manda el cliente. */
export interface BillingTermsInput {
  collectionMode: CollectionMode | null
  feeMode: FeeMode | null
  feeAmount: string | null
  lateFeePercentage: string | null
  lateFeeGraceDays: number | null
  /** Alternativa a la gracia: día del mes desde el que corre el punitorio (D-227). */
  lateFeeStartDay?: number | null
}

export class CreateContractCommand {
  constructor(
    public readonly propertyId: string,
    public readonly renterId: string,
    /** `undefined`: el garante actual del inquilino; `null`: ninguno. */
    public readonly guarantorId: string | null | undefined,
    public readonly terms: ContractTerms,
  ) {}
}

export class UpdateContractCommand {
  constructor(
    public readonly id: string,
    public readonly changes: {
      notes?: string | null
      guarantorId?: string | null
      surety?: Partial<SuretyData>
      depositReturnMode?: DepositReturnMode
    },
  ) {}
}

/** Una fila nueva de términos de cobro (D-70). Lo que no viene se copia de la vigente. */
export class ChangeBillingTermsCommand {
  constructor(
    public readonly id: string,
    public readonly changes: {
      /** Default: hoy. */
      effectiveFrom?: string
      collectionMode?: CollectionMode
      feeMode?: FeeMode
      feePercentage?: string
      /** `null` explícito vuelve al %. */
      feeAmount?: string | null
      /** `null` explícito vuelve al del tenant. */
      lateFeePercentage?: string | null
      lateFeeGraceDays?: number | null
      /** Alternativa a la gracia (D-227); no se combinan. */
      lateFeeStartDay?: number | null
      notes?: string | null
    },
  ) {}
}

export class UploadContractDocumentCommand {
  constructor(
    public readonly id: string,
    public readonly kind: ContractDocumentKind,
    public readonly file: Buffer,
    public readonly mimeType: string,
  ) {}
}

export class ApplyRentUpdateCommand {
  constructor(
    public readonly id: string,
    /**
     * El nuevo alquiler a mano. Obligatorio en FIXED sin % fijo y en OTHER;
     * opcional en FIXED con % fijo y en ICL/IPC (ajuste manual autorizado).
     */
    public readonly newRent: string | undefined,
  ) {}
}

export class TerminateContractCommand {
  constructor(
    public readonly id: string,
    public readonly notifiedAt: string,
  ) {}
}

export class RenewContractCommand {
  constructor(
    public readonly id: string,
    public readonly startDate: string,
    public readonly endDate: string,
    /** Lo que no venga se copia del contrato original. */
    public readonly overrides: Partial<
      Omit<ContractTerms, 'startDate' | 'endDate' | 'surety' | 'billing'>
    > & {
      renterId?: string
      guarantorId?: string | null
      surety?: Partial<SuretyData>
      billing?: Partial<BillingTermsInput>
    },
  ) {}
}
