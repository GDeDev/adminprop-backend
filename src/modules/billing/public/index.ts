/**
 * API pública de cobros: lo único que otro módulo puede importar de acá.
 * Liquidaciones (Fase 12), el cron (Fase 13) y el portal (Fase 18) entran
 * por acá.
 */
export { BillingModule } from '../infrastructure/modules/billing.module'
export { BillingFacade } from './billing.facade'
export type {
  InstallmentCollection,
  InstallmentFeeTerms,
  OverdueInstallmentRef,
  RentDueRef,
  SettleablePayment,
} from './billing.facade'
export type {
  RebasedInstallment,
  RebaseResult,
} from '../application/installment-rebaser'
export {
  INSTALLMENT_PAID_QUEUE,
  PAYMENT_CONFIRMED_QUEUE,
  PAYMENT_VOIDED_QUEUE,
} from './billing-events'
export type {
  InstallmentPaidPayload,
  PaymentConfirmedPayload,
  PaymentVoidedPayload,
} from './billing-events'
export {
  ChargeConcept,
  CreditStatus,
  DepositDeductionConcept,
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
export type { DepositReturnView } from '../application/deposit-return.views'
export type { ChargesByConcept } from '../domain/installment.policy'
export {
  AccountMovementType,
  ArrearsStatus,
} from '../application/account-movement-type'
