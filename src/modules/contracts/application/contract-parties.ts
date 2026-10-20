import { Injectable } from '@nestjs/common'

import { appliesReducedFee } from '@/modules/owners/public'
import {
  PropertiesFacade,
  PropertyContractInfo,
} from '@/modules/properties/public'
import { RenterContractInfo, RentersFacade } from '@/modules/renters/public'
import { TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import {
  InvalidGuarantorReferenceException,
  InvalidPropertyReferenceException,
  InvalidRenterReferenceException,
  PropertyAlreadyRentedException,
  PropertyWithoutOwnerException,
  RenterAlreadyActiveException,
} from '../domain/contract.exceptions'
import { ContractPolicy } from '../domain/contract.policy'

/**
 * Lo que el alta y la renovación comparten: validar a las partes por las
 * facades de sus módulos y fijar los honorarios. Nada de acá toca la base
 * de contratos.
 */
@Injectable()
export class ContractParties {
  constructor(
    private readonly properties: PropertiesFacade,
    private readonly renters: RentersFacade,
    private readonly tenants: TenantsFacade,
  ) {}

  /**
   * La propiedad existe en esta inmobiliaria, tiene propietario (de ahí sale
   * el del contrato) y no tiene otro contrato activo (RN-04). Cualquier
   * estado sirve: una alquilada a mano pasa a estar respaldada por el
   * contrato.
   */
  async requireProperty(propertyId: string): Promise<PropertyContractInfo> {
    const property = await this.properties.find(propertyId)
    if (!property) throw new InvalidPropertyReferenceException()
    if (!property.ownerId) throw new PropertyWithoutOwnerException()
    if (property.activeContractId) {
      throw new PropertyAlreadyRentedException(property.activeContractId)
    }
    return property
  }

  /**
   * El inquilino existe y no es titular de otro contrato activo (RN-05).
   * `allowedContractId` es el contrato que se está renovando: su titular
   * puede seguir siéndolo en el nuevo.
   */
  async requireRenter(
    renterId: string,
    allowedContractId?: string,
  ): Promise<RenterContractInfo> {
    const renter = await this.renters.find(renterId)
    if (!renter) throw new InvalidRenterReferenceException()
    if (
      renter.activeContractId &&
      renter.activeContractId !== allowedContractId
    ) {
      throw new RenterAlreadyActiveException(renter.activeContractId)
    }
    return renter
  }

  /**
   * Garante del contrato: el indicado (que tiene que existir), ninguno si
   * vino `null`, o el garante actual del inquilino si no vino nada.
   */
  async resolveGuarantor(
    guarantorId: string | null | undefined,
    renter: RenterContractInfo,
  ): Promise<string | null> {
    if (guarantorId === undefined) return renter.guarantorId
    if (guarantorId === null) return null
    if (!(await this.renters.guarantorExists(guarantorId))) {
      throw new InvalidGuarantorReferenceException()
    }
    return guarantorId
  }

  /**
   * Honorarios del contrato (RN-06/RN-07), con el estado del propietario en
   * este momento (spec 4). Se cuenta el contrato que se está creando: el
   * tercer contrato activo del propietario ya nace con el honorario
   * reducido (D-57). En una renovación la propiedad ya cuenta como activa.
   */
  async feePercentage(
    ownerId: string,
    propertyAlreadyActive: boolean,
  ): Promise<string> {
    const tenantId = RequestContext.tenantId
    if (!tenantId) throw new Error('Alta de contrato fuera de un tenant')
    const [settings, portfolios] = await Promise.all([
      this.tenants.getContractSettings(tenantId),
      this.properties.portfolios([ownerId]),
    ])
    const active = portfolios.get(ownerId)?.active ?? 0
    const activeWithThisOne = propertyAlreadyActive ? active : active + 1
    return ContractPolicy.feePercentage(
      appliesReducedFee(activeWithThisOne, settings.reducedFeeThreshold),
      settings,
    )
  }
}
