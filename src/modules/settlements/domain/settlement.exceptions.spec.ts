import { DomainErrorKind, DomainException } from '@/shared/errors'
import * as exceptions from './settlement.exceptions'

// El `code` y el `kind` son el contrato con el front y con el filtro HTTP
// (404/409/422/400): si alguien los cambia sin querer, esto avisa.
const cases: [string, () => DomainException, string, DomainErrorKind][] = [
  [
    'SettlementNotFound',
    () => new exceptions.SettlementNotFoundException('s'),
    'SETTLEMENT_NOT_FOUND',
    DomainErrorKind.NotFound,
  ],
  [
    'SettlementAdjustmentNotFound',
    () => new exceptions.SettlementAdjustmentNotFoundException('a'),
    'SETTLEMENT_ADJUSTMENT_NOT_FOUND',
    DomainErrorKind.NotFound,
  ],
  [
    'SettlementTransferNotFound',
    () => new exceptions.SettlementTransferNotFoundException('t'),
    'SETTLEMENT_TRANSFER_NOT_FOUND',
    DomainErrorKind.NotFound,
  ],
  [
    'SettlementInvalidContract',
    () => new exceptions.SettlementInvalidContractException('c'),
    'SETTLEMENT_INVALID_CONTRACT',
    DomainErrorKind.BusinessRule,
  ],
  [
    'SettlementDraftExists',
    () => new exceptions.SettlementDraftExistsException('s'),
    'SETTLEMENT_DRAFT_EXISTS',
    DomainErrorKind.Conflict,
  ],
  [
    'SettlementNothingToSettle',
    () => new exceptions.SettlementNothingToSettleException('c'),
    'SETTLEMENT_NOTHING_TO_SETTLE',
    DomainErrorKind.Conflict,
  ],
  [
    'SettlementAlreadyInStatement',
    () => new exceptions.SettlementAlreadyInStatementException('s', 'st'),
    'SETTLEMENT_ALREADY_IN_STATEMENT',
    DomainErrorKind.Conflict,
  ],
  [
    'SettlementOwnerMismatch',
    () => new exceptions.SettlementOwnerMismatchException('s'),
    'SETTLEMENT_OWNER_MISMATCH',
    DomainErrorKind.BusinessRule,
  ],
  [
    'SettlementAdjustmentAlreadyVoided',
    () => new exceptions.SettlementAdjustmentAlreadyVoidedException('a'),
    'SETTLEMENT_ADJUSTMENT_ALREADY_VOIDED',
    DomainErrorKind.Conflict,
  ],
  [
    'SettlementTransferAlreadyVoided',
    () => new exceptions.SettlementTransferAlreadyVoidedException('t'),
    'SETTLEMENT_TRANSFER_ALREADY_VOIDED',
    DomainErrorKind.Conflict,
  ],
  [
    'StatementNotFound',
    () => new exceptions.StatementNotFoundException('s'),
    'STATEMENT_NOT_FOUND',
    DomainErrorKind.NotFound,
  ],
  [
    'FeeReceivableNotFound',
    () => new exceptions.FeeReceivableNotFoundException('f'),
    'FEE_RECEIVABLE_NOT_FOUND',
    DomainErrorKind.NotFound,
  ],
  [
    'FeePaymentNotFound',
    () => new exceptions.FeePaymentNotFoundException('f'),
    'FEE_PAYMENT_NOT_FOUND',
    DomainErrorKind.NotFound,
  ],
  [
    'FeePaymentAlreadyVoided',
    () => new exceptions.FeePaymentAlreadyVoidedException('f'),
    'FEE_PAYMENT_ALREADY_VOIDED',
    DomainErrorKind.Conflict,
  ],
  [
    'InvalidFeePaymentAmount',
    () => new exceptions.InvalidFeePaymentAmountException(),
    'FEE_PAYMENT_INVALID_AMOUNT',
    DomainErrorKind.InvalidInput,
  ],
  [
    'FeePaymentInvalidOwner',
    () => new exceptions.FeePaymentInvalidOwnerException('o'),
    'FEE_PAYMENT_INVALID_OWNER',
    DomainErrorKind.BusinessRule,
  ],
  [
    'FeePaymentInvalidContract',
    () => new exceptions.FeePaymentInvalidContractException('c'),
    'FEE_PAYMENT_INVALID_CONTRACT',
    DomainErrorKind.BusinessRule,
  ],
  [
    'SettlementNothingToAcknowledge',
    () => new exceptions.SettlementNothingToAcknowledgeException('s'),
    'SETTLEMENT_NOTHING_TO_ACKNOWLEDGE',
    DomainErrorKind.BusinessRule,
  ],
]

describe('excepciones de settlements', () => {
  it.each(cases)('%s: código y tipo estables', (_name, build, code, kind) => {
    const error = build()
    expect(error.code).toBe(code)
    expect(error.kind).toBe(kind)
    expect(error.message).not.toBe('')
  })

  it('los consolidados con estado incorrecto son conflictos', () => {
    expect(new exceptions.StatementNotOpenException('x').kind).toBe(
      DomainErrorKind.Conflict,
    )
    expect(new exceptions.StatementNotClosedException('x').kind).toBe(
      DomainErrorKind.Conflict,
    )
    expect(new exceptions.StatementPeriodTakenException('x').kind).toBe(
      DomainErrorKind.Conflict,
    )
    expect(new exceptions.StatementInvalidOwnerException('x').kind).toBe(
      DomainErrorKind.BusinessRule,
    )
  })

  it('el monto inválido usa el motivo y el campo que le pasan', () => {
    const error = new exceptions.InvalidSettlementAmountException(
      'demasiado grande',
      'monto',
    )
    expect(error.message).toBe('El monto no sirve: demasiado grande')
    expect(error.metadata).toEqual({ field: 'monto' })
  })
})
