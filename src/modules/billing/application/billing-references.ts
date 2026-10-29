import { Injectable } from '@nestjs/common'

import { ContractRef, ContractsFacade } from '@/modules/contracts/public'
import { RentersFacade } from '@/modules/renters/public'
import { Installment } from '../domain/billing'
import { InstallmentRepository } from '../domain/billing.ports'
import {
  CreditRenterNotFoundException,
  InstallmentInvalidContractException,
  InstallmentNotFoundException,
} from '../domain/billing.exceptions'

/**
 * Lo que los casos de uso de cobros validan contra otros módulos, por sus
 * facades: el contrato de una cuenta corriente y el inquilino de un saldo a
 * favor. Un id de otra inmobiliaria es un id que no existe.
 */
@Injectable()
export class BillingReferences {
  constructor(
    private readonly contracts: ContractsFacade,
    private readonly renters: RentersFacade,
    private readonly installments: InstallmentRepository,
  ) {}

  /** El contrato, en cualquier estado: la cuenta corriente sigue tras cerrar. */
  async requireContract(contractId: string): Promise<ContractRef> {
    const contract = await this.contracts.find(contractId)
    if (!contract) throw new InstallmentInvalidContractException(contractId)
    return contract
  }

  async requireRenter(renterId: string): Promise<void> {
    if (!(await this.renters.exists(renterId))) {
      throw new CreditRenterNotFoundException(renterId)
    }
  }

  async requireInstallment(id: string): Promise<Installment> {
    const installment = await this.installments.findById(id)
    if (!installment) throw new InstallmentNotFoundException(id)
    return installment
  }
}
