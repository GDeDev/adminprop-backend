import { Injectable, OnModuleInit } from '@nestjs/common'

import {
  PAYMENT_CONFIRMED_NOTIFICATIONS_QUEUE,
  PaymentConfirmedPayload,
} from '@/modules/billing/public'
import { ContractsFacade } from '@/modules/contracts/public'
import { OwnersFacade, StatementSendMode } from '@/modules/owners/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import {
  SETTLEMENT_CONFIRMED_QUEUE,
  SettlementConfirmedPayload,
  STATEMENT_CLOSED_QUEUE,
  StatementClosedPayload,
} from '@/modules/settlements/public'
import {
  NotificationChannel,
  NotificationRecipientKind,
  NotificationRequest,
} from '@/platform/notifications/notifications.port'
import { QueueMessage, QueuePort } from '@/platform/queue/queue.port'
import { RequestContext } from '@/shared/context/request-context'
import { createLogger } from '@/shared/logging/root-logger'
import { addMoney, toMoneyString } from '@/shared/money'
import { NotificationPipeline } from '../../application/notification.pipeline'

/**
 * Los tres avisos que nacen de un evento y no de un cron (REDISENO_FASE_14,
 * 3.1): liquidación confirmada y consolidado cerrado (al propietario, con el
 * PDF) y recibo de pago (al inquilino, apagado por defecto, A-54). Cada
 * mensaje corre dentro del tenant del evento; si algo falla, pg-boss reintenta
 * y el `dedupeKey` evita el doble envío.
 */
@Injectable()
export class NotificationEventsConsumer implements OnModuleInit {
  private readonly logger = createLogger('NotificationEvents')

  constructor(
    private readonly queue: QueuePort,
    private readonly pipeline: NotificationPipeline,
    private readonly owners: OwnersFacade,
    private readonly renters: RentersFacade,
    private readonly contracts: ContractsFacade,
    private readonly properties: PropertiesFacade,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.consume<SettlementConfirmedPayload>(
      SETTLEMENT_CONFIRMED_QUEUE,
      (message) => this.onSettlementConfirmed(message),
    )
    await this.queue.consume<StatementClosedPayload>(
      STATEMENT_CLOSED_QUEUE,
      (message) => this.onStatementClosed(message),
    )
    await this.queue.consume<PaymentConfirmedPayload>(
      PAYMENT_CONFIRMED_NOTIFICATIONS_QUEUE,
      (message) => this.onPaymentConfirmed(message),
    )
  }

  /**
   * El aviso de cada liquidación respeta el modo de envío del propietario
   * (D-228, Micaela #7): con "solo el resumen" el comprobante individual no
   * sale. El consolidado puede pedirlo después, al cerrarse, con otro modo.
   */
  async onSettlementConfirmed(
    message: QueueMessage<SettlementConfirmedPayload>,
  ): Promise<void> {
    const event = message.payload
    const settings = await this.owners.feeSettings(event.ownerId)
    if (settings?.statementSendMode === StatementSendMode.SUMMARY) {
      this.logger.info(
        { settlementId: event.settlementId, ownerId: event.ownerId },
        'Comprobante individual omitido: el propietario recibe sólo el resumen',
      )
      return
    }
    await this.sendSettlementConfirmed(event)
  }

  private async sendSettlementConfirmed(
    event: SettlementConfirmedPayload,
  ): Promise<void> {
    const owner = (await this.owners.contacts([event.ownerId])).get(
      event.ownerId,
    )
    const contract = await this.contracts.find(event.contractId)
    const property = contract
      ? (await this.properties.describe([contract.propertyId])).get(
          contract.propertyId,
        )
      : undefined
    await this.send({
      type: 'SETTLEMENT_CONFIRMED',
      recipient: {
        kind: NotificationRecipientKind.OWNER,
        id: event.ownerId,
        email: owner?.email,
        phone: owner?.phone,
      },
      entity: { type: 'SETTLEMENT', id: event.settlementId },
      dedupeKey: `SETTLEMENT_CONFIRMED:${event.settlementId}`,
      data: {
        recipientName: owner?.fullName ?? null,
        ownerName: owner?.fullName ?? null,
        propertyAddress: property?.address ?? null,
        period: event.period,
        amount: event.netAmount,
        currency: event.currency,
      },
    })
  }

  async onStatementClosed(
    message: QueueMessage<StatementClosedPayload>,
  ): Promise<void> {
    const event = message.payload
    // Con "ambos" o "comprobantes" salen los comprobantes que el aviso al
    // confirmar dejó pendientes (modo del propietario distinto del elegido al
    // cerrar). Los ya enviados no se repiten: mismo `dedupeKey`.
    if (event.sendMode !== 'SUMMARY') {
      for (const settlement of event.settlements ?? []) {
        await this.sendSettlementConfirmed(settlement)
      }
    }
    if (event.sendMode === 'RECEIPTS') {
      this.logger.info(
        { statementId: event.statementId, ownerId: event.ownerId },
        'Aviso del consolidado omitido: el envío es sólo de comprobantes',
      )
      return
    }
    const owner = (await this.owners.contacts([event.ownerId])).get(
      event.ownerId,
    )
    await this.send({
      type: 'OWNER_STATEMENT_CLOSED',
      recipient: {
        kind: NotificationRecipientKind.OWNER,
        id: event.ownerId,
        email: owner?.email,
        phone: owner?.phone,
      },
      entity: { type: 'OWNER_STATEMENT', id: event.statementId },
      dedupeKey: `OWNER_STATEMENT_CLOSED:${event.statementId}`,
      data: {
        recipientName: owner?.fullName ?? null,
        ownerName: owner?.fullName ?? null,
        period: event.period,
      },
    })
  }

  async onPaymentConfirmed(
    message: QueueMessage<PaymentConfirmedPayload>,
  ): Promise<void> {
    const event = message.payload
    // Igual que el recibo (A-33): sólo cobros reales, no saldo a favor aplicado.
    if (event.kind !== 'CASH_IN') return
    const renter = (await this.renters.contacts([event.renterId])).get(
      event.renterId,
    )
    const contract = await this.contracts.find(event.contractId)
    const property = contract
      ? (await this.properties.describe([contract.propertyId])).get(
          contract.propertyId,
        )
      : undefined
    await this.send({
      type: 'PAYMENT_RECEIVED',
      recipient: {
        kind: NotificationRecipientKind.RENTER,
        id: event.renterId,
        email: renter?.email,
        phone: renter?.phone,
      },
      entity: { type: 'PAYMENT', id: event.paymentId },
      dedupeKey: `PAYMENT_RECEIVED:${event.paymentId}`,
      data: {
        recipientName: renter?.fullName ?? null,
        renterName: renter?.fullName ?? null,
        propertyAddress: property?.address ?? null,
        period: event.period,
        amount: toMoneyString(
          addMoney(
            event.rentApplied,
            event.lateFeeApplied,
            event.chargesApplied,
          ),
        ),
        currency: event.currency,
      },
    })
  }

  private async send(
    request: Omit<NotificationRequest, 'tenantId' | 'channels'>,
  ): Promise<void> {
    const tenantId = RequestContext.tenantId
    if (!tenantId) {
      this.logger.error({}, 'Evento de notificación sin tenant: se descarta')
      return
    }
    const outcome = await this.pipeline.process({
      ...request,
      tenantId,
      channels: [NotificationChannel.EMAIL],
    })
    // El pipeline no tira: un FAILED es un mensaje que no se pudo ni encolar.
    // Se tira para que pg-boss reintente; el dedupeKey evita el doble envío.
    if (outcome === 'FAILED') {
      throw new Error(`No se pudo encolar el aviso ${request.dedupeKey}`)
    }
  }
}
