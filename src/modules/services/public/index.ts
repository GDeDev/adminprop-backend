/**
 * API pública de servicios y gastos adelantados: lo único que otro módulo
 * puede importar de acá. Cobros (Fase 11), liquidaciones (Fase 12) y el cron
 * (Fase 13) entran por acá.
 */
export { ServicesModule } from '../infrastructure/modules/services.module'
export { ServicesFacade } from './services.facade'
export type { OverdueServiceRef, PendingExpenseRef } from './services.facade'
export {
  IncreaseFrequency,
  ServicePayer,
  ServiceScope,
  ServiceStatus,
} from '../domain/property-service'
export type {
  ContractServiceView,
  OverdueServiceView,
  PropertyServiceView,
} from '../application/service.views'
export type {
  AdvanceExpenseListView,
  AdvanceExpenseView,
} from '../application/advance-expense.views'
