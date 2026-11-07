import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { randomUUID } from 'node:crypto'

import { BillingFacade } from '@/modules/billing/public'
import { ServicesFacade } from '@/modules/services/public'
import { StoragePort } from '@/platform/storage/storage.port'
import { errorMessage } from '@/shared/core/error-message'
import { todayIso } from '@/shared/dates/calendar-date'
import { createLogger } from '@/shared/logging/root-logger'
import { compareMoney } from '@/shared/money'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { FeePolicy } from '../../domain/fee.policy'
import {
  FeeReceivableSource,
  Settlement,
  SettlementStatus,
} from '../../domain/settlement'
import {
  SettlementAdjustmentAlreadyVoidedException,
  SettlementAdjustmentNotFoundException,
  SettlementLinesChangedException,
  SettlementNotPendingException,
  SettlementStaleException,
  SettlementTransferAlreadyVoidedException,
  SettlementTransferNotFoundException,
} from '../../domain/settlement.exceptions'
import { SettlementRepository } from '../../domain/settlement.ports'
import { SettlementPolicy } from '../../domain/settlement.policy'
import { SettlementConfirmedEvent } from '../events/settlement-events'
import { FeeAccountService } from '../fee-account.service'
import { SettlementDrafts } from '../settlement-drafts'
import { SettlementReferences } from '../settlement-references'
import { SettlementDetailView, SettlementViews } from '../settlement.views'
import {
  CancelSettlementCommand,
  ConfirmSettlementCommand,
  CreateSettlementAdjustmentCommand,
  CreateSettlementCommand,
  RecalculateSettlementCommand,
  RegisterSettlementTransferCommand,
  VoidSettlementAdjustmentCommand,
  VoidSettlementTransferCommand,
} from './settlement.commands'

/** Crear la liquidación pendiente de un contrato (4.1). */
@CommandHandler(CreateSettlementCommand)
export class CreateSettlementHandler implements ICommandHandler<
  CreateSettlementCommand,
  SettlementDetailView
> {
  constructor(
    private readonly references: SettlementReferences,
    private readonly drafts: SettlementDrafts,
    private readonly prisma: PrismaService,
    private readonly views: SettlementViews,
  ) {}

  async execute(
    command: CreateSettlementCommand,
  ): Promise<SettlementDetailView> {
    const contract = await this.references.requireContract(command.contractId)
    const period = SettlementPolicy.normalizePeriod(command.period, todayIso())
    const created = await this.prisma.transaction(() =>
      this.drafts.create(contract, period),
    )
    return this.views.detail(created)
  }
}

/** Recalcular una pendiente (4.1): pagos y gastos de nuevo, ajustes intactos. */
@CommandHandler(RecalculateSettlementCommand)
export class RecalculateSettlementHandler implements ICommandHandler<
  RecalculateSettlementCommand,
  SettlementDetailView
> {
  constructor(
    private readonly references: SettlementReferences,
    private readonly drafts: SettlementDrafts,
    private readonly prisma: PrismaService,
    private readonly views: SettlementViews,
  ) {}

  async execute(
    command: RecalculateSettlementCommand,
  ): Promise<SettlementDetailView> {
    const settlement = await this.references.requireSettlement(
      command.settlementId,
    )
    SettlementPolicy.assertPending(settlement)
    const updated = await this.prisma.transaction(() =>
      this.drafts.recalculate(settlement),
    )
    return this.views.detail(updated)
  }
}

/** Vuelve a sumar los ajustes vigentes y el neto después de tocarlos. */
async function refreshAdjustments(
  settlements: SettlementRepository,
  settlementId: string,
): Promise<Settlement> {
  const current = await settlements.findById(settlementId)
  if (!current) throw new Error(`La liquidación ${settlementId} desapareció`)
  const adjustmentsTotal = SettlementPolicy.adjustmentsTotal(
    current.adjustments,
  )
  return settlements.update(current.id, {
    adjustmentsTotal,
    netAmount: SettlementPolicy.net(current, adjustmentsTotal),
  })
}

/** Retenciones, adelantos y otros rubros manuales (A-20), sólo pendiente. */
@CommandHandler(CreateSettlementAdjustmentCommand)
export class CreateSettlementAdjustmentHandler implements ICommandHandler<
  CreateSettlementAdjustmentCommand,
  SettlementDetailView
> {
  constructor(
    private readonly references: SettlementReferences,
    private readonly settlements: SettlementRepository,
    private readonly prisma: PrismaService,
    private readonly views: SettlementViews,
  ) {}

  async execute(
    command: CreateSettlementAdjustmentCommand,
  ): Promise<SettlementDetailView> {
    const settlement = await this.references.requireSettlement(
      command.settlementId,
    )
    SettlementPolicy.assertPending(settlement)
    const amount = SettlementPolicy.normalizeAmount(command.data.amount)
    const description = SettlementPolicy.normalizeDescription(
      command.data.description,
    )
    const createdById = this.references.requireUser()
    const updated = await this.prisma.transaction(async () => {
      await this.settlements.addAdjustment(settlement.id, {
        concept: command.data.concept,
        description,
        amount,
        originPaymentId: null,
        createdById,
      })
      return refreshAdjustments(this.settlements, settlement.id)
    })
    return this.views.detail(updated)
  }
}

@CommandHandler(VoidSettlementAdjustmentCommand)
export class VoidSettlementAdjustmentHandler implements ICommandHandler<
  VoidSettlementAdjustmentCommand,
  SettlementDetailView
> {
  constructor(
    private readonly references: SettlementReferences,
    private readonly settlements: SettlementRepository,
    private readonly prisma: PrismaService,
    private readonly views: SettlementViews,
  ) {}

  async execute(
    command: VoidSettlementAdjustmentCommand,
  ): Promise<SettlementDetailView> {
    const found = await this.settlements.findAdjustment(command.adjustmentId)
    if (!found) {
      throw new SettlementAdjustmentNotFoundException(command.adjustmentId)
    }
    const settlement = await this.references.requireSettlement(
      found.settlementId,
    )
    SettlementPolicy.assertPending(settlement)
    if (found.adjustment.voidedAt !== null) {
      throw new SettlementAdjustmentAlreadyVoidedException(found.adjustment.id)
    }
    const voidReason = SettlementPolicy.normalizeReason(command.reason)
    const voidedById = this.references.requireUser()
    const updated = await this.prisma.transaction(async () => {
      await this.settlements.voidAdjustment(found.adjustment.id, {
        voidedById,
        voidedAt: new Date(),
        voidReason,
      })
      return refreshAdjustments(this.settlements, settlement.id)
    })
    return this.views.detail(updated)
  }
}

/**
 * Confirmar (4.4): en una transacción pasa a CONFIRMED, marca los pagos en
 * cobros y los gastos en servicios, y si el honorario no se descuenta nace
 * el honorario a cobrar (`SETTLEMENT_NOT_DEDUCTED`). Después emite
 * `settlement-confirmed`. Desde ahí la liquidación es inmutable.
 */
@CommandHandler(ConfirmSettlementCommand)
export class ConfirmSettlementHandler implements ICommandHandler<
  ConfirmSettlementCommand,
  SettlementDetailView
> {
  private readonly logger = createLogger('ConfirmSettlementHandler')

  constructor(
    private readonly references: SettlementReferences,
    private readonly settlements: SettlementRepository,
    private readonly billing: BillingFacade,
    private readonly services: ServicesFacade,
    private readonly fees: FeeAccountService,
    private readonly drafts: SettlementDrafts,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
    private readonly views: SettlementViews,
  ) {}

  async execute(
    command: ConfirmSettlementCommand,
  ): Promise<SettlementDetailView> {
    const snapshot = await this.references.requireSettlement(
      command.settlementId,
    )
    SettlementPolicy.assertPending(snapshot)
    const confirmedById = this.references.requireUser()
    const confirmedAt = new Date()

    let confirmed: Settlement
    try {
      confirmed = await this.prisma.transaction(() =>
        this.confirm(snapshot.id, confirmedById, confirmedAt),
      )
    } catch (error) {
      if (error instanceof SettlementStaleException) {
        // Se deja recalculada (en su propia transacción: la de confirmar se
        // deshizo) para que el que la abra de nuevo vea los números de hoy.
        await this.prisma.transaction(async () => {
          const current = await this.settlements.findById(snapshot.id)
          if (current?.status === SettlementStatus.PENDING) {
            await this.drafts.recalculate(current)
          }
        })
      }
      throw error
    }
    this.eventBus.publish(new SettlementConfirmedEvent(confirmed))
    return this.views.detail(confirmed)
  }

  private async confirm(
    id: string,
    confirmedById: string,
    confirmedAt: Date,
  ): Promise<Settlement> {
    // Lock de la fila antes de leer: un recálculo, una cancelación u otra
    // confirmación simultáneos esperan. Las líneas y los totales se leen
    // recién acá, no del snapshot de antes de la transacción (C4).
    if (!(await this.settlements.lockPending(id))) {
      await this.throwNotPending(id)
    }
    const settlement = await this.references.requireSettlement(id)
    // Lo guardado tiene que ser lo que se liquidaría hoy. Antes se confirmaba
    // tal cual: un pago anulado (o un gasto corregido) después de armarse la
    // pendiente se le transfería igual al propietario (crítico 1 / C1).
    const contract = await this.references.requireContract(
      settlement.contractId,
    )
    if (
      SettlementPolicy.isStale(settlement, await this.drafts.compute(contract))
    ) {
      throw new SettlementStaleException(id)
    }
    const claimed = await this.settlements.updateWhilePending(id, {
      status: SettlementStatus.CONFIRMED,
      confirmedAt,
      confirmedById,
    })
    if (!claimed) await this.throwNotPending(id)
    const paymentIds = settlement.payments.map((p) => p.paymentId)
    const marked = await this.billing.markPaymentsSettled(paymentIds, id)
    if (marked !== paymentIds.length) {
      // Un pago se anuló (o lo tomó otra liquidación) entre el cálculo y el
      // UPDATE: no se confirma con un pago que ya no vale.
      this.logger.warn(
        { settlementId: id, expected: paymentIds.length, marked },
        'Un pago de la liquidación dejó de ser liquidable al confirmar',
      )
      throw new SettlementLinesChangedException(id, 'payments')
    }
    const expenseIds = settlement.expenses.map((e) => e.expenseId)
    const markedExpenses = await this.services.markExpensesSettled(
      expenseIds,
      id,
      confirmedAt,
    )
    if (markedExpenses !== expenseIds.length) {
      throw new SettlementLinesChangedException(id, 'expenses')
    }
    if (!settlement.feeDeducted && compareMoney(settlement.feeTotal, '0') > 0) {
      await this.fees.accrue({
        ownerId: settlement.ownerId,
        contractId: settlement.contractId,
        installmentId: null,
        period: settlement.period,
        currency: settlement.currency,
        source: FeeReceivableSource.SETTLEMENT_NOT_DEDUCTED,
        payer: FeePolicy.payerFor(settlement.feeMode),
        originPaymentId: null,
        originSettlementId: settlement.id,
        amount: settlement.feeTotal,
        feePercentage: settlement.feePercentage,
        feeAmountFixed: settlement.feeAmountFixed,
        baseAmount: settlement.feeBase,
      })
    }
    return this.references.requireSettlement(settlement.id)
  }

  private async throwNotPending(id: string): Promise<never> {
    const current = await this.references.requireSettlement(id)
    SettlementPolicy.assertPending(current)
    throw new SettlementNotPendingException(id, current.status)
  }
}

/** Cancelar (admin, sólo pendiente): libera pagos y gastos para otra liquidación. */
@CommandHandler(CancelSettlementCommand)
export class CancelSettlementHandler implements ICommandHandler<
  CancelSettlementCommand,
  SettlementDetailView
> {
  constructor(
    private readonly references: SettlementReferences,
    private readonly settlements: SettlementRepository,
    private readonly prisma: PrismaService,
    private readonly views: SettlementViews,
  ) {}

  async execute(
    command: CancelSettlementCommand,
  ): Promise<SettlementDetailView> {
    const settlement = await this.references.requireSettlement(
      command.settlementId,
    )
    SettlementPolicy.assertPending(settlement)
    const cancelReason = SettlementPolicy.normalizeReason(command.reason)
    const cancelledById = this.references.requireUser()
    const cancelled = await this.prisma.transaction(async () => {
      // Se reserva el cambio de estado antes de soltar las líneas (ver
      // ConfirmSettlementHandler).
      const claimed = await this.settlements.updateWhilePending(settlement.id, {
        status: SettlementStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledById,
        cancelReason,
      })
      if (!claimed) {
        const current = await this.references.requireSettlement(settlement.id)
        throw new SettlementNotPendingException(current.id, current.status)
      }
      // Las líneas son únicas por pago y por gasto: se sueltan para que la
      // próxima liquidación del contrato pueda tomarlos. Los totales quedan
      // como registro de lo que se iba a liquidar.
      await this.settlements.replaceLines(settlement.id, [], [])
      return this.references.requireSettlement(settlement.id)
    })
    return this.views.detail(cancelled)
  }
}

/** Vuelve a sumar las transferencias vigentes y fija el estado (4.5). */
async function refreshTransfers(
  settlements: SettlementRepository,
  settlementId: string,
): Promise<Settlement> {
  const current = await settlements.findById(settlementId)
  if (!current) throw new Error(`La liquidación ${settlementId} desapareció`)
  const transferredTotal = SettlementPolicy.transferredTotal(current)
  return settlements.update(current.id, {
    transferredTotal,
    status: SettlementPolicy.statusAfterTransfers(current, transferredTotal),
  })
}

/**
 * Registrar una transferencia al propietario (4.5): sólo confirmada o
 * transferida; la suma no supera el neto; al cubrirlo pasa a TRANSFERRED.
 * El comprobante se sube antes y se borra si la transacción falla.
 */
@CommandHandler(RegisterSettlementTransferCommand)
export class RegisterSettlementTransferHandler implements ICommandHandler<
  RegisterSettlementTransferCommand,
  SettlementDetailView
> {
  private readonly logger = createLogger('RegisterSettlementTransferHandler')

  constructor(
    private readonly references: SettlementReferences,
    private readonly settlements: SettlementRepository,
    private readonly storage: StoragePort,
    private readonly prisma: PrismaService,
    private readonly views: SettlementViews,
  ) {}

  async execute(
    command: RegisterSettlementTransferCommand,
  ): Promise<SettlementDetailView> {
    const settlement = await this.references.requireSettlement(
      command.settlementId,
    )
    SettlementPolicy.assertConfirmed(settlement)
    const amount = SettlementPolicy.normalizeAmount(command.data.amount)
    const transferredAt = SettlementPolicy.normalizeDate(
      command.data.transferredAt,
      todayIso(),
    )
    const receipt = SettlementPolicy.receiptKind(command.receipt)
    const notes = SettlementPolicy.normalizeNotes(command.data.notes)
    SettlementPolicy.assertTransferFits(settlement, amount)
    const registeredById = this.references.requireUser()

    const stored = receipt
      ? await this.storage.upload(
          command.receipt,
          `settlements/${settlement.id}/${randomUUID()}.${receipt.extension}`,
          { contentType: receipt.contentType, access: 'private' },
        )
      : null
    try {
      const updated = await this.prisma.transaction(async () => {
        await this.settlements.addTransfer(settlement.id, {
          transferredAt,
          amount,
          method: command.data.method,
          receiptKey: stored?.key ?? null,
          receiptUrl: stored?.url ?? null,
          notes,
          registeredById,
        })
        return refreshTransfers(this.settlements, settlement.id)
      })
      return this.views.detail(updated)
    } catch (error) {
      if (stored) {
        try {
          await this.storage.delete(stored.key)
        } catch (cleanupError) {
          this.logger.warn(
            { key: stored.key, error: errorMessage(cleanupError) },
            'No se pudo borrar el comprobante de una transferencia que no se guardó',
          )
        }
      }
      throw error
    }
  }
}

/** Anular una transferencia (admin, A-18): resta y puede volver a CONFIRMED. */
@CommandHandler(VoidSettlementTransferCommand)
export class VoidSettlementTransferHandler implements ICommandHandler<
  VoidSettlementTransferCommand,
  SettlementDetailView
> {
  constructor(
    private readonly references: SettlementReferences,
    private readonly settlements: SettlementRepository,
    private readonly prisma: PrismaService,
    private readonly views: SettlementViews,
  ) {}

  async execute(
    command: VoidSettlementTransferCommand,
  ): Promise<SettlementDetailView> {
    const found = await this.settlements.findTransfer(command.transferId)
    if (!found)
      throw new SettlementTransferNotFoundException(command.transferId)
    if (found.transfer.voidedAt !== null) {
      throw new SettlementTransferAlreadyVoidedException(found.transfer.id)
    }
    const voidReason = SettlementPolicy.normalizeReason(command.reason)
    const voidedById = this.references.requireUser()
    const updated = await this.prisma.transaction(async () => {
      await this.settlements.voidTransfer(found.transfer.id, {
        voidedById,
        voidedAt: new Date(),
        voidReason,
      })
      return refreshTransfers(this.settlements, found.settlementId)
    })
    return this.views.detail(updated)
  }
}
