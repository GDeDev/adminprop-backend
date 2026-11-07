import { EventBus } from '@nestjs/cqrs'
import { Injectable } from '@nestjs/common'

import { TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import { errorMessage } from '@/shared/core/error-message'
import { todayIso } from '@/shared/dates/calendar-date'
import { createLogger } from '@/shared/logging/root-logger'
import { compareMoney } from '@/shared/money'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { CollectionMode, Installment } from '../domain/billing'
import {
  InstallmentRepository,
  PaymentRepository,
  RenterCreditRepository,
} from '../domain/billing.ports'
import { InstallmentPolicy } from '../domain/installment.policy'
import { PaymentPolicy } from '../domain/payment.policy'
import { applyCreditPlan, publishConfirmed } from './credit-application'
import { InstallmentRecalculator } from './installment-recalculator'

/**
 * Aplica el saldo a favor del inquilino a una cuota recién generada, si la
 * inmobiliaria eligió el modo automático (Micaela #6, D-237). Con el modo
 * manual (el de siempre) no hace nada: el saldo se aplica con
 * `POST /installments/:id/apply-credit` o al registrar un pago.
 *
 * Sólo se llama con cuotas que `createIfAbsent` acaba de crear, nunca con las
 * que ya existían: así volver a generar el mes no duplica aplicaciones.
 */
@Injectable()
export class InstallmentCreditApplier {
  private readonly logger = createLogger('InstallmentCreditApplier')

  constructor(
    private readonly tenants: TenantsFacade,
    private readonly installments: InstallmentRepository,
    private readonly payments: PaymentRepository,
    private readonly credits: RenterCreditRepository,
    private readonly recalculator: InstallmentRecalculator,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
  ) {}

  /** Cuántos saldos a favor aplicó (0 si no correspondía). */
  async applyIfAutomatic(installment: Installment): Promise<number> {
    const tenantId = RequestContext.tenantId
    if (!tenantId) return 0
    const settings = await this.tenants.getBillingSettings(tenantId)
    if (!settings.autoApplyCreditOnGeneration) return 0
    // Un cobro directo al propietario no pasa por la inmobiliaria: aplicarle
    // saldo (plata que ella tiene) sería mover fondos entre las dos cuentas
    // sin que nadie lo haya decidido (D-237). Queda para aplicar a mano.
    if (installment.collectionMode === CollectionMode.OWNER_DIRECT) return 0

    try {
      const today = todayIso()
      // Sin usuario cuando corre el cron: el pago queda "registrado por el
      // sistema" (null).
      const registeredById = RequestContext.userId ?? null
      const result = await this.prisma.transaction(async () => {
        // Mismo orden que RegisterPayment y ApplyCredit: lock de la cuota y
        // recién ahí saldos y créditos, leídos dentro de la transacción. La
        // cuota es nueva, pero entre crearla y acá un pago o una aplicación a
        // mano puede haberla tocado, y dos aplicaciones no pueden gastar el
        // mismo saldo.
        await this.installments.lockForUpdate(installment.id)
        const current = await this.installments.findById(installment.id)
        if (!current) return null
        const balances = InstallmentPolicy.balances(current, today)
        if (compareMoney(balances.totalDue, '0') <= 0) return null
        const available = PaymentPolicy.usableCredits(
          await this.credits.lockAvailable(current.renterId, current.currency),
          current,
        )
        const plan = PaymentPolicy.planCreditApplications(
          available,
          balances.totalDue,
          current.currency,
        )
        if (plan.length === 0) return null
        const applied = await applyCreditPlan(
          { payments: this.payments, credits: this.credits },
          current,
          plan,
          balances,
          today,
          registeredById,
        )
        return {
          created: applied.created,
          updated: await this.recalculator.recalculate(current.id),
        }
      })
      if (!result) return 0
      publishConfirmed(this.eventBus, result.updated, result.created)
      return result.created.length
    } catch (error) {
      // La cuota ya existe: que no se pueda aplicar el saldo no puede frenar
      // la generación del resto. Queda para aplicar a mano.
      this.logger.warn(
        { installmentId: installment.id, error: errorMessage(error) },
        'No se pudo aplicar el saldo a favor a la cuota recién generada',
      )
      return 0
    }
  }
}
