import { Injectable } from '@nestjs/common'

import { PropertyContracts } from '@/modules/properties/domain/property.ports'

/**
 * Mientras no exista el módulo de contratos (Fase 9), ninguna propiedad tiene
 * contratos. La Fase 9 reemplaza este provider por uno que le pregunta al
 * módulo de contratos por su facade; las reglas no cambian.
 */
@Injectable()
export class NoContractsYet extends PropertyContracts {
  hasActiveContract(): Promise<boolean> {
    return Promise.resolve(false)
  }

  hasContractHistory(): Promise<boolean> {
    return Promise.resolve(false)
  }
}
