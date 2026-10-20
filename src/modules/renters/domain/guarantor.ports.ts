import { GuaranteeType, Guarantor } from './guarantor'

export interface GuarantorData {
  firstName: string
  lastName: string
  nationalId: string
  phone: string | null
  email: string | null
  address: string | null
  guaranteeType: GuaranteeType
  guaranteeDetail: string
  notes: string | null
}

export interface GuarantorFilter {
  /** Parte del nombre, del apellido o del DNI/CUIT. */
  search?: string
}

export interface GuarantorRef {
  id: string
  fullName: string
}

/**
 * Puerto del repositorio. Todo corre dentro del tenant del contexto; los
 * borrados lógicos no aparecen nunca.
 */
export abstract class GuarantorRepository {
  abstract create(data: GuarantorData): Promise<Guarantor>

  abstract findById(id: string): Promise<Guarantor | null>

  abstract findByIds(ids: string[]): Promise<Guarantor[]>

  abstract findByNationalId(nationalId: string): Promise<Guarantor | null>

  /** Por apellido y nombre. */
  abstract list(
    filter: GuarantorFilter,
    page: { skip: number; take: number },
  ): Promise<[Guarantor[], number]>

  abstract update(id: string, data: Partial<GuarantorData>): Promise<Guarantor>

  abstract softDelete(id: string): Promise<void>
}
