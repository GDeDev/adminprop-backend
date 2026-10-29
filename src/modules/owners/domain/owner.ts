/** Cuenta donde se le transfiere la liquidación. Todo opcional: se carga después. */
export interface BankAccount {
  /** 22 dígitos, con los dígitos verificadores válidos. */
  cbu: string | null
  alias: string | null
  bankName: string | null
  holder: string | null
}

/** Coincide con el enum de Prisma. */
export enum StatementSendMode {
  SUMMARY = 'SUMMARY',
  RECEIPTS = 'RECEIPTS',
  BOTH = 'BOTH',
}

/**
 * Honorarios y envíos del propietario (Fase 12, 2.1; Micaela #5 y #7).
 * `feePercentage` null = la regla por umbral del tenant (D-57).
 */
export interface OwnerFeeSettings {
  feePercentage: string | null
  /** Los punitorios cobrados entran en la base del honorario. */
  feeIncludesLateFees: boolean
  /** Los cargos del propietario (multa, otros) entran en la base. */
  feeIncludesCharges: boolean
  statementSendMode: StatementSendMode
}

/** Propietario (PRD 5.2). */
export interface Owner {
  id: string
  firstName: string
  lastName: string
  /** DNI o CUIT, sólo dígitos. */
  nationalId: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  bankAccount: BankAccount
  feeSettings: OwnerFeeSettings
  /** Usuario de portal (módulo de auth), si alguna vez se le generó acceso. */
  portalUserId: string | null
  createdAt: Date
  updatedAt: Date
}

export { fullNameOf } from '@/shared/people/person-policy'
