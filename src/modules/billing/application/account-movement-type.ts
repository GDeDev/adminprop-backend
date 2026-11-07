/** Tipos de movimiento de la cuenta corriente y estado de mora, compartidos por vistas y DTOs. */
export enum AccountMovementType {
  INSTALLMENT = 'INSTALLMENT',
  CHARGE = 'CHARGE',
  /**
   * Punitorio devengado de una cuota. No estaba en el diseño: hace falta para
   * que el saldo acumulado de los movimientos cierre con `totals.balance`.
   */
  LATE_FEE_ACCRUED = 'LATE_FEE_ACCRUED',
  PAYMENT = 'PAYMENT',
  CREDIT_APPLIED = 'CREDIT_APPLIED',
  CREDIT_GENERATED = 'CREDIT_GENERATED',
  CREDIT_REFUNDED = 'CREDIT_REFUNDED',
  LATE_FEE_ADJUSTMENT = 'LATE_FEE_ADJUSTMENT',
  PAYMENT_VOIDED = 'PAYMENT_VOIDED',
  DEPOSIT_RECEIVED = 'DEPOSIT_RECEIVED',
  /** Devolución del depósito (Fase 12): informativos, como DEPOSIT_RECEIVED. */
  DEPOSIT_RETURNED = 'DEPOSIT_RETURNED',
  DEPOSIT_DEDUCTION = 'DEPOSIT_DEDUCTION',
}

export enum ArrearsStatus {
  UP_TO_DATE = 'UP_TO_DATE',
  PENDING = 'PENDING',
  OVERDUE = 'OVERDUE',
}
