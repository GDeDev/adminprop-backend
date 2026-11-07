import { Injectable } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'

import { fillEmptyFields } from '@/shared/core/fill-empty-fields'
import { fullNameOf } from '@/shared/people/person-policy'
import {
  CreateGuarantorCommand,
  UpdateGuarantorCommand,
} from '../application/commands/guarantor.commands'
import {
  CreateRenterCommand,
  UpdateRenterCommand,
} from '../application/commands/renter.commands'
import { GuaranteeType } from '../domain/guarantor'
import { GuarantorRef, GuarantorRepository } from '../domain/guarantor.ports'
import { RenterRef, RenterRepository } from '../domain/renter.ports'

export type { GuarantorRef, RenterRef }

/** Datos de una persona tal como los trae una migración (Fase 21). */
export interface PersonImportData {
  firstName: string
  lastName: string
  nationalId: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
}

export interface RenterImportData extends PersonImportData {
  guarantorId: string | null
}

export interface RenterImportSnapshot extends RenterImportData {
  id: string
  activeContractId: string | null
}

export interface GuarantorImportData extends PersonImportData {
  guaranteeType: 'PROPERTY' | 'PAYSLIPS'
  guaranteeDetail: string
}

export interface GuarantorImportSnapshot extends GuarantorImportData {
  id: string
}

/** Nombre, DNI y datos de contacto, para los avisos. */
export interface RenterContact extends RenterRef {
  nationalId: string
  email: string | null
  phone: string | null
}

/** Lo que el inquilino ve de sí mismo en su portal (Fase 18). */
export interface RenterPortalProfile extends RenterRef {
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
    private readonly commands: CommandBus,
  ) {}

  /** El inquilino del usuario de portal, o null (Fase 15: autorizar descargas). */
  async idForPortalUser(userId: string): Promise<string | null> {
    return (await this.renters.findByPortalUser(userId))?.id ?? null
  }

  /** Datos del inquilino para su portal (Fase 18). Null si no existe. */
  async portalProfile(renterId: string): Promise<RenterPortalProfile | null> {
    const renter = await this.renters.findById(renterId)
    return renter
      ? {
          id: renter.id,
          fullName: fullNameOf(renter),
          email: renter.email,
          phone: renter.phone,
        }
      : null
  }

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

  // ---------------------------------------------------------- Migración (Fase 21)

  /** Los inquilinos con esos DNI/CUIT, por documento. */
  async findRentersForImport(
    nationalIds: string[],
  ): Promise<Map<string, RenterImportSnapshot>> {
    const renters = await this.renters.findByNationalIds([
      ...new Set(nationalIds),
    ])
    return new Map(
      renters.map((renter) => [
        renter.nationalId,
        {
          id: renter.id,
          firstName: renter.firstName,
          lastName: renter.lastName,
          nationalId: renter.nationalId,
          phone: renter.phone,
          email: renter.email,
          address: renter.address,
          notes: renter.notes,
          guarantorId: renter.guarantorId,
          activeContractId: renter.activeContractId,
        },
      ]),
    )
  }

  /** Alta con las mismas validaciones y la misma auditoría que la manual. */
  async createRenterFromImport(data: RenterImportData): Promise<string> {
    const created = await this.commands.execute(
      new CreateRenterCommand({ ...data, moveInDate: null }),
    )
    return created.id
  }

  /** Completa sólo lo vacío (A-72); devuelve los campos que completó. */
  async fillEmptyRenterFields(
    id: string,
    data: RenterImportData,
  ): Promise<string[]> {
    const renter = await this.renters.findById(id)
    if (!renter) return []
    const patch = fillEmptyFields(renter, data, [
      'phone',
      'email',
      'address',
      'notes',
      'guarantorId',
    ])
    if (Object.keys(patch).length > 0) {
      await this.commands.execute(new UpdateRenterCommand(id, patch))
    }
    return Object.keys(patch)
  }

  /** Los garantes con esos DNI/CUIT, por documento. */
  async findGuarantorsForImport(
    nationalIds: string[],
  ): Promise<Map<string, GuarantorImportSnapshot>> {
    const guarantors = await this.guarantors.findByNationalIds([
      ...new Set(nationalIds),
    ])
    return new Map(
      guarantors.map((guarantor) => [
        guarantor.nationalId,
        {
          id: guarantor.id,
          firstName: guarantor.firstName,
          lastName: guarantor.lastName,
          nationalId: guarantor.nationalId,
          phone: guarantor.phone,
          email: guarantor.email,
          address: guarantor.address,
          notes: guarantor.notes,
          guaranteeType: guarantor.guaranteeType as 'PROPERTY' | 'PAYSLIPS',
          guaranteeDetail: guarantor.guaranteeDetail,
        },
      ]),
    )
  }

  async createGuarantorFromImport(data: GuarantorImportData): Promise<string> {
    const created = await this.commands.execute(
      new CreateGuarantorCommand({
        ...data,
        guaranteeType: data.guaranteeType as GuaranteeType,
      }),
    )
    return created.id
  }

  async fillEmptyGuarantorFields(
    id: string,
    data: GuarantorImportData,
  ): Promise<string[]> {
    const guarantor = await this.guarantors.findById(id)
    if (!guarantor) return []
    const patch = fillEmptyFields(guarantor, data, [
      'phone',
      'email',
      'address',
      'notes',
    ])
    if (Object.keys(patch).length > 0) {
      await this.commands.execute(new UpdateGuarantorCommand(id, patch))
    }
    return Object.keys(patch)
  }

  async attachContract(renterId: string, contractId: string): Promise<void> {
    await this.renters.setActiveContract(renterId, contractId)
  }

  async detachContract(renterId: string): Promise<void> {
    await this.renters.setActiveContract(renterId, null)
  }
}
