/** Cuenta donde se le transfiere la liquidación. Todo opcional: se carga después. */
export interface BankAccount {
  /** 22 dígitos, con los dígitos verificadores válidos. */
  cbu: string | null
  alias: string | null
  bankName: string | null
  holder: string | null
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
  /** Usuario de portal (módulo de auth), si alguna vez se le generó acceso. */
  portalUserId: string | null
  createdAt: Date
  updatedAt: Date
}

export { fullNameOf } from '@/shared/people/person-policy'
