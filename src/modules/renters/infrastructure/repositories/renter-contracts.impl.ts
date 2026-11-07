import { Injectable } from '@nestjs/common'

import {
  RenterContracts,
  RenterRepository,
} from '@/modules/renters/domain/renter.ports'

/**
 * Responde con el vínculo que el módulo de contratos deja en el inquilino
 * (`activeContractId`) por `RentersFacade`. Así la regla de baja sabe de
 * contratos sin importar ese módulo (D-51, mismo patrón que propiedades).
 */
@Injectable()
export class RenterContractsImpl extends RenterContracts {
  constructor(private readonly renters: RenterRepository) {
    super()
  }

  async hasActiveContract(renterId: string): Promise<boolean> {
    const renter = await this.renters.findById(renterId)
    return renter?.activeContractId != null
  }
}
