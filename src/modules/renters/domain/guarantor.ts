/** Con qué responde el garante (PRD 5.4). */
export enum GuaranteeType {
  /** Un inmueble propio: el detalle lleva dirección y datos registrales. */
  PROPERTY = 'PROPERTY',
  /** Recibos de sueldo: el detalle lleva empleador y sueldo aproximado. */
  PAYSLIPS = 'PAYSLIPS',
}

/** Garante (PRD 5.4). Puede garantizar a más de un inquilino. */
export interface Guarantor {
  id: string
  firstName: string
  lastName: string
  /** DNI o CUIT, sólo dígitos. */
  nationalId: string
  phone: string | null
  email: string | null
  address: string | null
  guaranteeType: GuaranteeType
  /** Texto libre, nunca vacío (spec 4). */
  guaranteeDetail: string
  notes: string | null
  createdAt: Date
  updatedAt: Date
}
