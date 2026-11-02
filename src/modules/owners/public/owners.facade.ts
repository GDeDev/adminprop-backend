import { Injectable } from '@nestjs/common'

import { OwnerFeeResolver } from '../application/owner-fee-resolver'
import { fullNameOf, OwnerFeeSettings } from '../domain/owner'
import { OwnerRef, OwnerRepository } from '../domain/owner.ports'

export type { OwnerRef }

/** Nombre y datos de contacto, para los avisos. */
export interface OwnerContact extends OwnerRef {
  /** DNI o CUIT, sólo dígitos. */
  nationalId: string
  email: string | null
  phone: string | null
}

/**
 * Lo que otros módulos pueden preguntarle a propietarios. Dentro del tenant
 * del contexto: un id de otra inmobiliaria es un id que no existe.
 */
@Injectable()
export class OwnersFacade {
  constructor(
    private readonly owners: OwnerRepository,
    private readonly fees: OwnerFeeResolver,
  ) {}

  /**
   * El % de honorarios que le corresponde al propietario hoy (Fase 12, 2.1):
   * su override si lo tiene, si no la regla por umbral de la inmobiliaria
   * (RN-06/RN-07). `extraActive` suma propiedades que todavía no cuentan
   * como activas (el contrato que se está creando, D-57). Null si el
   * propietario no existe.
   */
  async feePercentageFor(
    ownerId: string,
    extraActive = 0,
  ): Promise<string | null> {
    const owner = await this.owners.findById(ownerId)
    if (!owner) return null
    return this.fees.feePercentageFor(owner, extraActive)
  }

  /** Honorarios y envíos del propietario, para liquidar. Null si no existe. */
  async feeSettings(ownerId: string): Promise<OwnerFeeSettings | null> {
    const owner = await this.owners.findById(ownerId)
    return owner?.feeSettings ?? null
  }

  /** Si tiene CBU o alias cargados (A-17: se avisa, no se bloquea). */
  async hasBankAccount(ownerId: string): Promise<boolean> {
    const owner = await this.owners.findById(ownerId)
    return (
      owner !== null &&
      (owner.bankAccount.cbu !== null || owner.bankAccount.alias !== null)
    )
  }

  /** El propietario del usuario de portal, o null (Fase 15: autorizar descargas). */
  async idForPortalUser(userId: string): Promise<string | null> {
    return (await this.owners.findByPortalUser(userId))?.id ?? null
  }

  async exists(id: string): Promise<boolean> {
    return (await this.owners.findById(id)) !== null
  }

  /** Nombre y datos de contacto, para los avisos (Fase 13). Los borrados no aparecen. */
  async contacts(ids: string[]): Promise<Map<string, OwnerContact>> {
    const owners = await this.owners.findByIds([...new Set(ids)])
    return new Map(
      owners.map((owner) => [
        owner.id,
        {
          id: owner.id,
          fullName: fullNameOf(owner),
          nationalId: owner.nationalId,
          email: owner.email,
          phone: owner.phone,
        },
      ]),
    )
  }

  /** Nombre de cada uno, en una sola consulta. Los borrados no aparecen. */
  async describe(ids: string[]): Promise<Map<string, OwnerRef>> {
    const owners = await this.owners.findByIds([...new Set(ids)])
    return new Map(
      owners.map((owner) => [
        owner.id,
        { id: owner.id, fullName: fullNameOf(owner) },
      ]),
    )
  }
}
