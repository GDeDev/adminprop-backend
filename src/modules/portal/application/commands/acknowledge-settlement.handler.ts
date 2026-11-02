import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import {
  SettlementDetailView,
  SettlementsFacade,
} from '@/modules/settlements/public'
import { PortalEntityNotFoundException } from '../../domain/portal.exceptions'
import { PortalIdentity } from '../portal-identity'
import { maskSettlementDetailForOwner } from '../portal.mappers'

/**
 * "Recibí la transferencia" (Fase 17, A-37): la única escritura del portal.
 * Sólo deja constancia de cuándo el propietario lo confirmó; no cambia el
 * estado ni los importes de la liquidación.
 */
export class AcknowledgeSettlementCommand {
  constructor(
    public readonly userId: string,
    public readonly settlementId: string,
  ) {}
}

@CommandHandler(AcknowledgeSettlementCommand)
export class AcknowledgeSettlementHandler implements ICommandHandler<
  AcknowledgeSettlementCommand,
  SettlementDetailView
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly settlements: SettlementsFacade,
  ) {}

  async execute(
    command: AcknowledgeSettlementCommand,
  ): Promise<SettlementDetailView> {
    const ownerId = await this.identity.ownerId(command.userId)
    const settlement = await this.settlements.acknowledgeForOwner(
      ownerId,
      command.settlementId,
    )
    if (!settlement) {
      throw new PortalEntityNotFoundException(
        'SETTLEMENT_NOT_FOUND',
        'La liquidación no existe',
        command.settlementId,
      )
    }
    return maskSettlementDetailForOwner(settlement)
  }
}
