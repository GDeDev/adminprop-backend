/**
 * API pública de cobros: lo único que otro módulo puede importar de acá.
 * Liquidaciones (Fase 12), el cron (Fase 13) y el portal (Fase 18) entran
 * por acá.
 */
export { BillingModule } from '../infrastructure/modules/billing.module'
export {
  ChargeConcept,
  CreditStatus,
  ExchangeRateSource,
  InstallmentStatus,
  LateFeeAdjustmentKind,
  PaymentKind,
  PaymentMethod,
  PaymentReceiver,
  PaymentStatus,
} from '../domain/billing'
export type {
  BillingSummaryView,
  InstallmentBreakdownView,
  InstallmentDetailView,
  InstallmentSummaryView,
  PaymentListItemView,
  PaymentView,
  RenterArrearsView,
  RenterCreditsView,
} from '../application/installment.views'
export type { ContractAccountView } from '../application/contract-account.views'
export {
  AccountMovementType,
  ArrearsStatus,
} from '../application/account-movement-type'
