import { Injectable } from '@nestjs/common'

import { ContractRef, ContractsFacade } from '@/modules/contracts/public'
import { OwnersFacade } from '@/modules/owners/public'
import { RequestContext } from '@/shared/context/request-context'
import { OwnerFeeRules, Settlement } from '../domain/settlement'
import {
  SettlementInvalidContractException,
  SettlementNotFoundException,
} from '../domain/settlement.exceptions'
import { SettlementRepository } from '../domain/settlement.ports'

/**
 * Lo que liquidaciones valida contra otros módulos, por sus facades. Un id
 * de otra inmobiliaria es un id que no existe.
 */
@Injectable()
export class SettlementReferences {
  constructor(
    private readonly contracts: ContractsFacade,
    private readonly owners: OwnersFacade,
    private readonly settlements: SettlementRepository,
  ) {}

  /** El contrato en cualquier estado: un rescindido se liquida igual. */
  async requireContract(contractId: string): Promise<ContractRef> {
    const contract = await this.contracts.find(contractId)
    if (!contract) throw new SettlementInvalidContractException(contractId)
    return contract
  }

  async requireSettlement(id: string): Promise<Settlement> {
    const settlement = await this.settlements.findById(id)
    if (!settlement) throw new SettlementNotFoundException(id)
    return settlement
  }

  /**
   * Qué conceptos entran en la base del honorario (Micaela #5). Si el
   * propietario se borró, la base es sólo el alquiler.
   */
  async feeRules(ownerId: string): Promise<OwnerFeeRules> {
    const settings = await this.owners.feeSettings(ownerId)
    return {
      feeIncludesLateFees: settings?.feeIncludesLateFees ?? false,
      feeIncludesCharges: settings?.feeIncludesCharges ?? false,
    }
  }

  requireUser(): string {
    const userId = RequestContext.userId
    if (!userId) {
      throw new Error('Operación de liquidaciones sin usuario en el contexto')
    }
    return userId
  }
}
