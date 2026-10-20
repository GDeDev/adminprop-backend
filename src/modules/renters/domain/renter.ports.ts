import { PaymentStatus, Renter } from './renter'

export interface RenterPersonalData {
  firstName: string
  lastName: string
  nationalId: string
  phone: string | null
  email: string | null
  address: string | null
  /** `AAAA-MM-DD` o null. */
  moveInDate: string | null
  notes: string | null
  guarantorId: string | null
}

export interface RenterFilter {
  /** Parte del nombre, del apellido o del DNI/CUIT. */
  search?: string
  /** Se acepta desde ya; filtra recién con el motor de cobros (Fase 11). */
  paymentStatus?: PaymentStatus
  /** Se acepta desde ya; filtra recién con los contratos (Fase 9). */
  propertyId?: string
}

export interface RenterRef {
  id: string
  fullName: string
}

/**
 * Puerto del repositorio. Todo corre dentro del tenant del contexto; los
 * borrados lógicos no aparecen nunca.
 */
export abstract class RenterRepository {
  abstract create(data: RenterPersonalData): Promise<Renter>

  abstract findById(id: string): Promise<Renter | null>

  abstract findByIds(ids: string[]): Promise<Renter[]>

  abstract findByNationalId(nationalId: string): Promise<Renter | null>

  /** Por apellido y nombre. */
  abstract list(
    filter: RenterFilter,
    page: { skip: number; take: number },
  ): Promise<[Renter[], number]>

  /** Los inquilinos de un garante, por apellido y nombre. */
  abstract listByGuarantor(guarantorId: string): Promise<Renter[]>

  /** Cuántos inquilinos (no borrados) tiene cada garante. */
  abstract countByGuarantors(
    guarantorIds: string[],
  ): Promise<Map<string, number>>

  abstract update(
    id: string,
    data: Partial<RenterPersonalData>,
  ): Promise<Renter>

  abstract setPortalUser(id: string, portalUserId: string): Promise<void>

  abstract softDelete(id: string): Promise<void>
}

/**
 * Lo que las reglas de inquilinos necesitan saber de los contratos (Fase 9).
 * Hasta que existan, la implementación responde que no hay ninguno; la Fase
 * 9 la reemplaza por una que le pregunta al módulo de contratos, sin tocar
 * las reglas (mismo patrón que `PropertyContracts`).
 */
export abstract class RenterContracts {
  abstract hasActiveContract(renterId: string): Promise<boolean>
}
