import { IsoDate, isValidIsoDate } from '@/shared/dates/calendar-date'
import { roundMoney, toMoneyString } from '@/shared/money'
import { AdvanceExpense, isSettled } from './advance-expense'
import {
  ExpenseAlreadySettledException,
  ExpenseReceiptRequiredException,
  InvalidExpenseAmountException,
  InvalidExpenseDateException,
  InvalidExpenseReceiptException,
} from './service.exceptions'

/** 10 MB: una foto de celular o un PDF escaneado entran, y frena abusos. */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024

export interface ReceiptKind {
  extension: 'pdf' | 'jpg' | 'png' | 'webp'
  contentType: string
}

/**
 * Firmas de los formatos aceptados (los primeros bytes). Se valida por
 * contenido y no por el mimetype que mandó el cliente, como los PDFs de los
 * contratos (D-62).
 */
const SIGNATURES: { kind: ReceiptKind; matches: (file: Buffer) => boolean }[] =
  [
    {
      kind: { extension: 'pdf', contentType: 'application/pdf' },
      matches: (file) => file.subarray(0, 4).toString('latin1') === '%PDF',
    },
    {
      kind: { extension: 'jpg', contentType: 'image/jpeg' },
      matches: (file) =>
        file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff,
    },
    {
      kind: { extension: 'png', contentType: 'image/png' },
      matches: (file) =>
        file
          .subarray(0, 8)
          .equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          ),
    },
    {
      kind: { extension: 'webp', contentType: 'image/webp' },
      matches: (file) =>
        file.subarray(0, 4).toString('latin1') === 'RIFF' &&
        file.subarray(8, 12).toString('latin1') === 'WEBP',
    },
  ]

/** Reglas de negocio de los gastos adelantados. Puras: sin NestJS ni Prisma. */
export const AdvanceExpensePolicy = {
  /** Un gasto es plata que se descuenta: tiene que ser mayor que cero. */
  normalizeAmount(value: string): string {
    let amount
    try {
      amount = roundMoney(value)
    } catch {
      throw new InvalidExpenseAmountException()
    }
    if (amount.lessThanOrEqualTo(0)) throw new InvalidExpenseAmountException()
    return toMoneyString(amount)
  },

  normalizeDate(value: string): IsoDate {
    const trimmed = value.trim()
    if (!isValidIsoDate(trimmed)) throw new InvalidExpenseDateException()
    return trimmed
  },

  normalizeDescription(value: string): string {
    return value.trim().replace(/\s+/g, ' ')
  },

  /**
   * Spec 6: sin comprobante no hay gasto (400). Se acepta una foto (JPG,
   * PNG, WebP) o un PDF de hasta 10 MB, reconocidos por sus primeros bytes.
   */
  receiptKind(file: Buffer | null | undefined): ReceiptKind {
    if (!file || file.length === 0) throw new ExpenseReceiptRequiredException()
    if (file.length > MAX_RECEIPT_BYTES) {
      throw new InvalidExpenseReceiptException('tiene que pesar hasta 10 MB')
    }
    const signature = SIGNATURES.find((s) => s.matches(file))
    if (!signature) {
      throw new InvalidExpenseReceiptException(
        'tiene que ser una imagen (JPG, PNG o WebP) o un PDF',
      )
    }
    return signature.kind
  },

  /** Spec 4: descontado en una liquidación, no se edita ni se elimina (409). */
  assertMutable(expense: Pick<AdvanceExpense, 'settlementId'>): void {
    if (isSettled(expense) && expense.settlementId) {
      throw new ExpenseAlreadySettledException(expense.settlementId)
    }
  },
}
