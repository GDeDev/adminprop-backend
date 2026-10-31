import { Injectable } from '@nestjs/common'

import { fullNameOf } from '@/shared/people/person-policy'
import { GuarantorRef, GuarantorRepository } from '../domain/guarantor.ports'
import { RenterRef, RenterRepository } from '../domain/renter.ports'

export type { GuarantorRef, RenterRef }

/** Nombre, DNI y datos de contacto, para los avisos. */
export interface RenterContact extends RenterRef {
  nationalId: string
  email: string | null
  phone: string | null
}

/** Lo que un contrato necesita saber del inquilino al armarse. */
export interface RenterContractInfo extends RenterRef {
  /** Su garante actual, que el contrato toma por defecto. */
  guarantorId: string | null
  activeContractId: string | null
}

/**
 * Lo que otros módulos pueden preguntarle a inquilinos (el módulo de
 * contratos la usa al armar contratos). Dentro del tenant del contexto: un
 * id de otra inmobiliaria es un id que no existe.
 *
 * `attachContract` y `detachContract` son el único camino por el que un
 * inquilino se entera de sus contratos (D-51, como en propiedades).
 */
@Injectable()
export class RentersFacade {
  constructor(
    private readonly renters: RenterRepository,
    private readonly guarantors: GuarantorRepository,
  ) {}

  async exists(id: string): Promise<boolean> {
    return (await this.renters.findById(id)) !== null
  }

  async find(id: string): Promise<RenterContractInfo | null> {
    const renter = await this.renters.findById(id)
    return renter
      ? {
          id: renter.id,
          fullName: fullNameOf(renter),
          guarantorId: renter.guarantorId,
          activeContractId: renter.activeContractId,
        }
      : null
  }

  /** Nombre de cada uno, en una sola consulta. Los borrados no aparecen. */
  async describe(ids: string[]): Promise<Map<string, RenterRef>> {
    const renters = await this.renters.findByIds([...new Set(ids)])
    return new Map(
      renters.map((renter) => [
        renter.id,
        { id: renter.id, fullName: fullNameOf(renter) },
      ]),
    )
  }

  /**
   * Cómo contactar a cada uno y cómo identificarlo (avisos de la Fase 13).
   * Los borrados no aparecen.
   */
  async contacts(ids: string[]): Promise<Map<string, RenterContact>> {
    const renters = await this.renters.findByIds([...new Set(ids)])
    return new Map(
      renters.map((renter) => [
        renter.id,
        {
          id: renter.id,
          fullName: fullNameOf(renter),
          nationalId: renter.nationalId,
          email: renter.email,
          phone: renter.phone,
        },
      ]),
    )
  }

  async guarantorExists(id: string): Promise<boolean> {
    return (await this.guarantors.findById(id)) !== null
  }

  /** Nombre de cada garante, en una sola consulta. */
  async describeGuarantors(ids: string[]): Promise<Map<string, GuarantorRef>> {
    const guarantors = await this.guarantors.findByIds([...new Set(ids)])
    return new Map(
      guarantors.map((guarantor) => [
        guarantor.id,
        { id: guarantor.id, fullName: fullNameOf(guarantor) },
      ]),
    )
  }

  async attachContract(renterId: string, contractId: string): Promise<void> {
    await this.renters.setActiveContract(renterId, contractId)
  }

  async detachContract(renterId: string): Promise<void> {
    await this.renters.setActiveContract(renterId, null)
  }
}
