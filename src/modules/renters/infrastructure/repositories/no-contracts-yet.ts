import { Injectable } from '@nestjs/common'

import { RenterContracts } from '@/modules/renters/domain/renter.ports'

/**
 * Mientras no exista el módulo de contratos (Fase 9), ningún inquilino tiene
 * contratos. La Fase 9 reemplaza este provider por uno que le pregunta al
 * módulo de contratos por su facade; las reglas no cambian.
 */
@Injectable()
export class NoContractsYet extends RenterContracts {
  hasActiveContract(): Promise<boolean> {
    return Promise.resolve(false)
  }
}
