import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { InstallmentStatus } from '@/modules/billing/domain/billing'
import {
  ChargeNotFoundException,
  InstallmentAlreadyPaidException,
} from '@/modules/billing/domain/billing.exceptions'
import { InstallmentRepository } from '@/modules/billing/domain/billing.ports'
import { InstallmentPolicy } from '@/modules/billing/domain/installment.policy'
import { RequestContext } from '@/shared/context/request-context'
import { todayIso } from '@/shared/dates/calendar-date'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { BillingReferences } from '../billing-references'
import { InstallmentRecalculator } from '../installment-recalculator'
import { InstallmentDetailView, InstallmentViews } from '../installment.views'
import {
  AdjustLateFeeCommand,
  CreateChargeCommand,
  VoidChargeCommand,
} from './billing.commands'

function requireUser(): string {
  const userId = RequestContext.userId
  if (!userId) throw new Error('Operación de cobros sin usuario en el contexto')
  return userId
}

/** Cargo adicional (3.2): expensas, multa de rescisión u otro, sobre una cuota no saldada. */
@CommandHandler(CreateChargeCommand)
export class CreateChargeHandler implements ICommandHandler<
  CreateChargeCommand,
  InstallmentDetailView
> {
  constructor(
    private readonly references: BillingReferences,
    private readonly installments: InstallmentRepository,
    private readonly recalculator: InstallmentRecalculator,
    private readonly prisma: PrismaService,
    private readonly views: InstallmentViews,
  ) {}

  async execute(command: CreateChargeCommand): Promise<InstallmentDetailView> {
    const installment = await this.references.requireInstallment(
      command.installmentId,
    )
    if (installment.status === InstallmentStatus.PAID) {
      throw new InstallmentAlreadyPaidException(installment.id)
    }
    const amount = InstallmentPolicy.normalizeChargeAmount(command.data.amount)
    const description = InstallmentPolicy.normalizeDescription(
      command.data.description,
    )
    const updated = await this.prisma.transaction(async () => {
      await this.installments.addCharge(installment.id, {
        concept: command.data.concept,
        description,
        amount,
      })
      return this.recalculator.recalculate(installment.id)
    })
    return this.views.detail(updated)
  }
}

/** Anular un cargo (3.2): sólo si nada se le imputó; queda registrado. */
@CommandHandler(VoidChargeCommand)
export class VoidChargeHandler implements ICommandHandler<
  VoidChargeCommand,
  InstallmentDetailView
> {
  constructor(
    private readonly references: BillingReferences,
    private readonly installments: InstallmentRepository,
    private readonly recalculator: InstallmentRecalculator,
    private readonly prisma: PrismaService,
    private readonly views: InstallmentViews,
  ) {}

  async execute(command: VoidChargeCommand): Promise<InstallmentDetailView> {
    const charge = await this.installments.findCharge(command.chargeId)
    if (!charge) throw new ChargeNotFoundException(command.chargeId)
    const installment = await this.references.requireInstallment(
      charge.installmentId,
    )
    const balances = InstallmentPolicy.balances(installment, todayIso())
    InstallmentPolicy.assertChargeVoidable(charge, balances)
    const reason = InstallmentPolicy.normalizeReason(command.reason)
    const updated = await this.prisma.transaction(async () => {
      await this.installments.voidCharge(charge.id, {
        voidedById: requireUser(),
        voidedAt: new Date(),
        voidReason: reason,
      })
      return this.recalculator.recalculate(installment.id)
    })
    return this.views.detail(updated)
  }
}

/** Reducir o condonar el punitorio (3.5, Micaela #4; sólo admin), con motivo. */
@CommandHandler(AdjustLateFeeCommand)
export class AdjustLateFeeHandler implements ICommandHandler<
  AdjustLateFeeCommand,
  InstallmentDetailView
> {
  constructor(
    private readonly references: BillingReferences,
    private readonly installments: InstallmentRepository,
    private readonly recalculator: InstallmentRecalculator,
    private readonly prisma: PrismaService,
    private readonly views: InstallmentViews,
  ) {}

  async execute(command: AdjustLateFeeCommand): Promise<InstallmentDetailView> {
    const installment = await this.references.requireInstallment(
      command.installmentId,
    )
    const balances = InstallmentPolicy.balances(installment, todayIso())
    const adjustment = InstallmentPolicy.lateFeeAdjustment(
      installment,
      balances,
      command.kind,
      command.amount,
    )
    const reason = InstallmentPolicy.normalizeReason(command.reason)
    const updated = await this.prisma.transaction(async () => {
      await this.installments.addAdjustment(installment.id, {
        kind: command.kind,
        amount: adjustment.amount,
        reason,
      })
      if (adjustment.waive) {
        await this.installments.update(installment.id, { lateFeeWaived: true })
      }
      return this.recalculator.recalculate(installment.id)
    })
    return this.views.detail(updated)
  }
}
