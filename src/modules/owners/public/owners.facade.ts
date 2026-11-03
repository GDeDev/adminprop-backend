import { Injectable } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'

import { fillEmptyFields } from '@/shared/core/fill-empty-fields'
import {
  CreateOwnerCommand,
  UpdateOwnerBankAccountCommand,
  UpdateOwnerCommand,
} from '../application/commands/owner.commands'
import { OwnerFeeResolver } from '../application/owner-fee-resolver'
import {
  BankAccount,
  fullNameOf,
  OwnerFeeSettings,
  StatementSendMode,
} from '../domain/owner'
import { OwnerPolicy } from '../domain/owner.policy'
import { OwnerRef, OwnerRepository } from '../domain/owner.ports'

export type { OwnerRef }

/** Un propietario tal como lo trae una migración (Fase 21). */
export interface OwnerImportData {
  firstName: string
  lastName: string
  nationalId: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  cbu: string | null
  alias: string | null
  bankName: string | null
  holder: string | null
}

export interface OwnerImportSnapshot extends OwnerImportData {
  id: string
}

/** Nombre y datos de contacto, para los avisos. */
export interface OwnerContact extends OwnerRef {
  /** DNI o CUIT, sólo dígitos. */
  nationalId: string
  email: string | null
  phone: string | null
}

/** Lo que el propietario ve de sí mismo en su portal (Fase 17). */
export interface OwnerPortalProfile extends OwnerRef {
  email: string | null
  bankAccount: BankAccount
  statementSendMode: StatementSendMode
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
    private readonly commands: CommandBus,
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

  /** Datos del propietario para su portal (Fase 17). Null si no existe. */
  async portalProfile(ownerId: string): Promise<OwnerPortalProfile | null> {
    const owner = await this.owners.findById(ownerId)
    return owner
      ? {
          id: owner.id,
          fullName: fullNameOf(owner),
          email: owner.email,
          bankAccount: owner.bankAccount,
          statementSendMode: owner.feeSettings.statementSendMode,
        }
      : null
  }

  // ---------------------------------------------------------- Migración (Fase 21)

  /** Los propietarios con esos DNI/CUIT, por documento. */
  async findForImport(
    nationalIds: string[],
  ): Promise<Map<string, OwnerImportSnapshot>> {
    const owners = await this.owners.findByNationalIds([
      ...new Set(nationalIds),
    ])
    return new Map(
      owners.map((owner) => [
        owner.nationalId,
        {
          id: owner.id,
          firstName: owner.firstName,
          lastName: owner.lastName,
          nationalId: owner.nationalId,
          phone: owner.phone,
          email: owner.email,
          address: owner.address,
          notes: owner.notes,
          cbu: owner.bankAccount.cbu,
          alias: owner.bankAccount.alias,
          bankName: owner.bankAccount.bankName,
          holder: owner.bankAccount.holder,
        },
      ]),
    )
  }

  /** Si el CBU es válido (22 dígitos y verificadores), como en el alta manual. */
  isValidCbu(cbu: string): boolean {
    return OwnerPolicy.isValidCbu(cbu)
  }

  /** Alta con las mismas validaciones y la misma auditoría que la manual. */
  async createFromImport(data: OwnerImportData): Promise<string> {
    const { cbu, alias, bankName, holder, ...personal } = data
    const created = await this.commands.execute(
      new CreateOwnerCommand(personal, { cbu, alias, bankName, holder }),
    )
    return created.id
  }

  /**
   * Completa sólo lo que el propietario tiene vacío (A-72) y devuelve los
   * campos que completó. Nunca pisa un valor cargado.
   */
  async fillEmptyFields(id: string, data: OwnerImportData): Promise<string[]> {
    const owner = await this.owners.findById(id)
    if (!owner) return []
    const personal = fillEmptyFields(owner, data, [
      'phone',
      'email',
      'address',
      'notes',
    ])
    const bank = fillEmptyFields(owner.bankAccount, data, [
      'cbu',
      'alias',
      'bankName',
      'holder',
    ])
    if (Object.keys(personal).length > 0) {
      await this.commands.execute(new UpdateOwnerCommand(id, personal))
    }
    if (Object.keys(bank).length > 0) {
      await this.commands.execute(
        new UpdateOwnerBankAccountCommand(id, {
          ...owner.bankAccount,
          ...bank,
        }),
      )
    }
    return [...Object.keys(personal), ...Object.keys(bank)]
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
