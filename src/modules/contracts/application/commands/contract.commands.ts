import {
  Currency,
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
  notes: string | null
  surety: SuretyData
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
    /** Sólo para contratos "Fijo" u "Otro": el nuevo alquiler. */
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
      Omit<ContractTerms, 'startDate' | 'endDate' | 'surety'>
    > & {
      renterId?: string
      guarantorId?: string | null
      surety?: Partial<SuretyData>
    },
  ) {}
}
