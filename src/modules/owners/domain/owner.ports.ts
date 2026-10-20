import { BankAccount, Owner } from './owner'

/** Datos personales: los bancarios tienen su propio camino (spec 3.5). */
export interface OwnerPersonalData {
  firstName: string
  lastName: string
  nationalId: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
}

export interface OwnerFilter {
  /** Parte del nombre, del apellido o del DNI/CUIT. */
  search?: string
}

export interface OwnerRef {
  id: string
  fullName: string
}

/**
 * Puerto del repositorio. Todo corre dentro del tenant del contexto; los
 * borrados lógicos no aparecen nunca.
 */
export abstract class OwnerRepository {
  abstract create(
    data: OwnerPersonalData & { bankAccount: BankAccount },
  ): Promise<Owner>

  abstract findById(id: string): Promise<Owner | null>

  abstract findByIds(ids: string[]): Promise<Owner[]>

  abstract findByNationalId(nationalId: string): Promise<Owner | null>

  /** Los que ya tienen ese CBU (puede haber más de uno: no se bloquea). */
  abstract findByCbu(cbu: string): Promise<Owner[]>

  /** Por apellido y nombre. */
  abstract list(
    filter: OwnerFilter,
    page: { skip: number; take: number },
  ): Promise<[Owner[], number]>

  abstract update(id: string, data: Partial<OwnerPersonalData>): Promise<Owner>

  abstract updateBankAccount(id: string, account: BankAccount): Promise<Owner>

  abstract setPortalUser(id: string, portalUserId: string): Promise<void>

  abstract softDelete(id: string): Promise<void>
}
