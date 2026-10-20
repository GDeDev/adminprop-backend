/**
 * API pública de contratos: lo único que otro módulo puede importar de acá.
 * Cobros (Fase 11), servicios (Fase 10) y el cron (Fase 13) entran por acá.
 */
export { ContractsModule } from '../infrastructure/modules/contracts.module'
export { ContractsFacade } from './contracts.facade'
export type { ActiveContractRef } from './contracts.facade'
export {
  ContractStatus,
  Currency,
  RentUpdateFrequency,
  RentUpdateSource,
  RentUpdateType,
} from '../domain/contract'
export type {
  ContractDetailView,
  ContractRentUpdateView,
  ContractSummaryView,
  ContractSuretyView,
  ContractTerminationView,
} from '../application/contract.views'
