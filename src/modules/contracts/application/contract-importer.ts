import { Injectable } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'

import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import { todayIso } from '@/shared/dates/calendar-date'
import {
  CollectionMode,
  ContractStatus,
  Currency,
  RentUpdateFrequency,
  RentUpdateType,
} from '../domain/contract'
import {
  InvalidPropertyReferenceException,
  InvalidRenterReferenceException,
  PropertyWithoutOwnerException,
} from '../domain/contract.exceptions'
import { ContractRepository, NewContract } from '../domain/contract.ports'
import { ContractParties } from './contract-parties'
import {
  ContractTerms,
  CreateContractCommand,
} from './commands/contract.commands'
import {
  normalizeBillingTerms,
  normalizeTerms,
} from './commands/contract.handlers'

/** Un contrato tal como lo trae una migración (Fase 21, A-74). */
export interface ContractImportData {
  propertyId: string
  renterId: string
  startDate: string
  endDate: string
  initialRent: string
  currency: Currency
  rentUpdateType: RentUpdateType
  rentUpdateFrequency: RentUpdateFrequency
  fixedIncreasePercentage: string | null
  deposit: string
  depositCurrency: Currency
  collectionMode: CollectionMode
  notes: string | null
}

/**
 * Alta de contratos que vienen de otro sistema. Con las mismas validaciones
 * que la carga manual, más estas diferencias:
 *
 * - acepta fechas de inicio pasadas;
 * - un contrato cuyo fin ya pasó nace `FINISHED` y no toca a la propiedad ni
 *   al inquilino (el contrato vigente de la misma propiedad sigue siendo el
 *   activo);
 * - no genera cuotas de períodos anteriores: las cuotas las crea el job de
 *   cobros por período, nunca al dar de alta el contrato.
 */
@Injectable()
export class ContractImporter {
  constructor(
    private readonly commands: CommandBus,
    private readonly contracts: ContractRepository,
    private readonly parties: ContractParties,
    private readonly properties: PropertiesFacade,
    private readonly renters: RentersFacade,
  ) {}

  async create(data: ContractImportData): Promise<string> {
    const terms: ContractTerms = {
      startDate: data.startDate,
      endDate: data.endDate,
      initialRent: data.initialRent,
      currency: data.currency,
      rentUpdateType: data.rentUpdateType,
      rentUpdateFrequency: data.rentUpdateFrequency,
      deposit: data.deposit,
      depositCurrency: data.depositCurrency,
      depositReturnMode: null,
      fixedIncreasePercentage: data.fixedIncreasePercentage,
      notes: data.notes,
      surety: {
        hasSurety: false,
        insurerName: null,
        insurerAlertEmail: null,
        policyNumber: null,
        policyExpiresAt: null,
      },
      billing: {
        collectionMode: data.collectionMode,
        feeMode: null,
        feeAmount: null,
        lateFeePercentage: null,
        lateFeeGraceDays: null,
      },
    }

    if (data.endDate >= todayIso()) {
      const created = await this.commands.execute(
        new CreateContractCommand(
          data.propertyId,
          data.renterId,
          undefined,
          terms,
        ),
      )
      return created.id
    }

    const normalized = normalizeTerms(terms)
    const property = await this.properties.find(data.propertyId)
    if (!property) throw new InvalidPropertyReferenceException()
    if (!property.ownerId) throw new PropertyWithoutOwnerException()
    const renter = await this.renters.find(data.renterId)
    if (!renter) throw new InvalidRenterReferenceException()

    const feePercentage = await this.parties.feePercentage(
      property.ownerId,
      true,
    )
    const { billing, ...contractTerms } = normalized
    const finished: NewContract = {
      ...contractTerms,
      propertyId: property.id,
      ownerId: property.ownerId,
      renterId: renter.id,
      guarantorId: renter.guarantorId,
      feePercentage,
      renewedFromId: null,
      status: ContractStatus.FINISHED,
      billingTerms: normalizeBillingTerms(billing, feePercentage),
    }
    return (await this.contracts.create(finished)).id
  }
}
