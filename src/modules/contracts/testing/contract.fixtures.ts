// Fixtures de los tests unitarios de contratos. No se importan desde código de
// producción (jest.config las deja afuera de la cobertura).
import {
  BillingTerms,
  CollectionMode,
  Contract,
  ContractStatus,
  Currency,
  DepositReturnMode,
  FeeMode,
  RentUpdate,
  RentUpdateFrequency,
  RentUpdateSource,
  RentUpdateType,
} from '../domain/contract'

const at = (iso: string) => new Date(`${iso}T15:00:00.000Z`)

export function makeRentUpdate(
  overrides: Partial<RentUpdate> = {},
): RentUpdate {
  return {
    id: 'ru-1',
    effectiveFrom: '2026-01-01',
    previousRent: null,
    newRent: '100000.00',
    source: RentUpdateSource.INITIAL,
    indexType: null,
    indexFromPeriod: null,
    indexToPeriod: null,
    indexFromValue: null,
    indexToValue: null,
    fixedPercentage: null,
    appliedById: null,
    createdAt: at('2026-01-01'),
    ...overrides,
  }
}

export function makeBillingTerms(
  overrides: Partial<BillingTerms> = {},
): BillingTerms {
  return {
    id: 'bt-1',
    effectiveFrom: '2026-01-01',
    collectionMode: CollectionMode.AGENCY,
    feeMode: FeeMode.DEDUCTED,
    feePercentage: '5.00',
    feeAmount: null,
    lateFeePercentage: null,
    lateFeeGraceDays: null,
    notes: null,
    changedById: null,
    createdAt: at('2026-01-01'),
    ...overrides,
  }
}

/** Contrato activo de 2026-01-01 a 2027-12-31, alquiler inicial 100.000, ajuste cada 3 meses. */
export function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'contract-1',
    propertyId: 'property-1',
    ownerId: 'owner-1',
    renterId: 'renter-1',
    guarantorId: null,
    startDate: '2026-01-01',
    endDate: '2027-12-31',
    initialRent: '100000.00',
    currency: Currency.ARS,
    rentUpdateType: RentUpdateType.ICL,
    rentUpdateFrequency: RentUpdateFrequency.QUARTERLY,
    deposit: '100000.00',
    depositCurrency: Currency.ARS,
    depositReturnMode: DepositReturnMode.FIXED,
    fixedIncreasePercentage: null,
    feePercentage: '5.00',
    status: ContractStatus.ACTIVE,
    contractPdfKey: null,
    contractPdfUrl: null,
    notes: null,
    surety: {
      hasSurety: false,
      insurerName: null,
      insurerAlertEmail: null,
      policyNumber: null,
      policyExpiresAt: null,
      policyPdfKey: null,
      policyPdfUrl: null,
    },
    termination: null,
    terminationPdfKey: null,
    terminationPdfUrl: null,
    renewedFromId: null,
    rentUpdates: [makeRentUpdate()],
    billingTerms: [makeBillingTerms()],
    createdAt: at('2026-01-01'),
    updatedAt: at('2026-01-01'),
    ...overrides,
  }
}
