/**
 * API pública de liquidaciones: lo único que otro módulo puede importar de
 * acá. Hoy sólo `app.module` la usa; el portal (Fase 17), los PDFs (Fase
 * 15) y el dashboard (Fase 19) entran por la facade.
 */
export { SettlementsModule } from '../infrastructure/modules/settlements.module'
export { SettlementsFacade } from './settlements.facade'
export type {
  ReportFeePaymentRef,
  ReportSettlementRef,
  SettlementWorkload,
} from './settlements.facade'
export type {
  SettlementDetailView,
  SettlementSummaryView,
} from '../application/settlement.views'
export type {
  OwnerStatementDetailView,
  OwnerStatementSummaryView,
} from '../application/statement.views'
export type {
  FeePaymentView,
  FeeReceivableView,
  OwnerFeeAccountView,
} from '../application/fee.views'
export type { FeeAccountTotals, FeeMovement } from '../domain/fee.policy'
export { FeeMovementType } from '../domain/fee.policy'
export {
  FeePayer,
  FeeReceivableSource,
  FeeReceivableStatus,
  SettlementAdjustmentConcept,
  SettlementStatus,
  StatementStatus,
} from '../domain/settlement'
export {
  SETTLEMENT_CONFIRMED_DOCUMENTS_QUEUE,
  SETTLEMENT_CONFIRMED_QUEUE,
  STATEMENT_CLOSED_DOCUMENTS_QUEUE,
  STATEMENT_CLOSED_QUEUE,
} from './settlement-events'
export type {
  SettlementConfirmedPayload,
  StatementClosedPayload,
} from './settlement-events'
