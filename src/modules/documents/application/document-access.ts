import { Injectable } from '@nestjs/common'

import { Role } from '@/modules/auth/public'
import { BillingFacade } from '@/modules/billing/public'
import { ContractsFacade } from '@/modules/contracts/public'
import { OwnersFacade } from '@/modules/owners/public'
import { RentersFacade } from '@/modules/renters/public'
import { SettlementsFacade } from '@/modules/settlements/public'
import { DocumentKind } from '../domain/document'

export interface DocumentViewer {
  id: string
  role: Role
}

/**
 * Quién puede bajar qué (Fase 15, 5): el personal todo; un propietario las
 * liquidaciones y consolidados suyos y la rescisión de sus contratos; un
 * inquilino los recibos de sus pagos y la rescisión de su contrato. Todo lo
 * demás se responde como si no existiera, para no revelar nada.
 */
@Injectable()
export class DocumentAccess {
  constructor(
    private readonly settlements: SettlementsFacade,
    private readonly billing: BillingFacade,
    private readonly contracts: ContractsFacade,
    private readonly owners: OwnersFacade,
    private readonly renters: RentersFacade,
  ) {}

  isStaff(viewer: DocumentViewer): boolean {
    return viewer.role === Role.ADMIN || viewer.role === Role.EMPLOYEE
  }

  async canRead(
    viewer: DocumentViewer,
    kind: DocumentKind,
    entityId: string,
  ): Promise<boolean> {
    if (this.isStaff(viewer)) return true
    if (viewer.role === Role.OWNER) {
      const ownerId = await this.owners.idForPortalUser(viewer.id)
      if (!ownerId) return false
      switch (kind) {
        case DocumentKind.SETTLEMENT:
          return this.settlements.isSettlementVisibleToOwner(entityId, ownerId)
        case DocumentKind.OWNER_STATEMENT:
          return this.settlements.isStatementVisibleToOwner(entityId, ownerId)
        case DocumentKind.TERMINATION_NOTICE:
          return (await this.contracts.parties(entityId))?.ownerId === ownerId
        default:
          return false
      }
    }
    if (viewer.role === Role.RENTER) {
      const renterId = await this.renters.idForPortalUser(viewer.id)
      if (!renterId) return false
      switch (kind) {
        case DocumentKind.PAYMENT_RECEIPT:
          return (
            (await this.billing.receiptOwner(entityId))?.renterId === renterId
          )
        case DocumentKind.TERMINATION_NOTICE:
          return (await this.contracts.parties(entityId))?.renterId === renterId
        default:
          return false
      }
    }
    return false
  }
}
