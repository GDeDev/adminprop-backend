/**
 * API pública de contratos: lo único que otro módulo puede importar de acá.
 * Cobros (Fase 11), servicios (Fase 10) y el cron (Fase 13) entran por acá.
 */
export { ContractsModule } from '../infrastructure/modules/contracts.module'
export { ContractsFacade } from './contracts.facade'
export type {
  ActiveContractRef,
  ContractRef,
  ExpiringContract,
  RentUpdateOutcome,
  SuretyContract,
} from './contracts.facade'
export { CONTRACT_RENT_UPDATED_QUEUE } from './contract-events'
export type { ContractRentUpdatedPayload } from './contract-events'
export {
  CollectionMode,
  ContractStatus,
  Currency,
  DepositReturnMode,
  FeeMode,
  RentUpdateFrequency,
  RentUpdateSource,
  RentUpdateType,
} from '../domain/contract'
export type { ResolvedBillingTerms } from '../domain/contract'
export type {
  ContractBillingTermsView,
  ContractCurrentBillingTermsView,
  ContractDetailView,
  ContractRentUpdateView,
  ContractSummaryView,
  ContractSuretyView,
  ContractTerminationView,
} from '../application/contract.views'
