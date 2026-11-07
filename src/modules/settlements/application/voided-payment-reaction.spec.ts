import { PaymentVoidedPayload } from '@/modules/billing/public'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  FeeReceivableStatus,
  SettlementAdjustmentConcept,
  SettlementStatus,
} from '../domain/settlement'
import {
  FeeReceivableRepository,
  SettlementRepository,
} from '../domain/settlement.ports'
import {
  makeAdjustment,
  makePaymentLine,
  makeReceivable,
  makeSettlement,
} from '../testing/settlement.fixtures'
import { SettlementDrafts } from './settlement-drafts'
import { VoidedPaymentReaction } from './voided-payment-reaction'

function payload(
  overrides: Partial<PaymentVoidedPayload> = {},
): PaymentVoidedPayload {
  return {
    paymentId: 'pay-1',
    installmentId: 'inst-1',
    contractId: 'contract-1',
    ownerId: 'owner-1',
    period: '2026-09',
    settlementId: 'settlement-1',
    receivedBy: 'AGENCY',
    paidAt: '2026-10-05',
    rentApplied: '100000.00',
    lateFeeApplied: '5000.00',
    chargesApplied: '1000.00',
    currency: 'ARS',
    voidReason: 'Transferencia rechazada',
    ...overrides,
  }
}

function setup() {
  const settlements = {
    findById: jest.fn(),
    findContainingPayment: jest.fn().mockResolvedValue(null),
    findPendingByContract: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
    addAdjustment: jest.fn().mockResolvedValue(undefined),
  }
  const receivables = {
    findByOriginPayment: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
  }
  const drafts = {
    recalculate: jest.fn().mockResolvedValue(undefined),
    draftForAdjustment: jest.fn(),
  }
  const prisma = {
    transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  }
  const reaction = new VoidedPaymentReaction(
    settlements as unknown as SettlementRepository,
    receivables as unknown as FeeReceivableRepository,
    drafts as unknown as SettlementDrafts,
    prisma as unknown as PrismaService,
  )
  return { reaction, settlements, receivables, drafts }
}

describe('VoidedPaymentReaction', () => {
  describe('pago sin liquidación', () => {
    it('no hace nada con la liquidación', async () => {
      const { reaction, settlements, drafts } = setup()
      await reaction.handle(payload({ settlementId: null }))
      expect(settlements.findById).not.toHaveBeenCalled()
      expect(drafts.recalculate).not.toHaveBeenCalled()
    })
  })

  describe('pago en una pendiente que todavía no lo marcó (crítico 1)', () => {
    // Una pendiente no completa payment.settlementId hasta confirmarse: el
    // evento llega con settlementId null. Antes la reacción salía ahí, la
    // pendiente seguía con el pago anulado y al confirmarla se transferían
    // 95.000 por un pago que ya no existía.
    it('la encuentra por la línea del pago y la recalcula', async () => {
      const { reaction, settlements, drafts } = setup()
      const pending = makeSettlement({
        id: 'settlement-1',
        payments: [makePaymentLine({ paymentId: 'pay-1' })],
      })
      settlements.findContainingPayment.mockResolvedValue(pending)
      await reaction.handle(payload({ settlementId: null }))
      expect(settlements.findContainingPayment).toHaveBeenCalledWith('pay-1')
      expect(drafts.recalculate).toHaveBeenCalledWith(pending)
      expect(settlements.addAdjustment).not.toHaveBeenCalled()
    })

    it('si no está en ninguna línea, recalcula la pendiente del contrato', async () => {
      const { reaction, settlements, drafts } = setup()
      const pending = makeSettlement({ id: 'settlement-1' })
      settlements.findPendingByContract.mockResolvedValue(pending)
      await reaction.handle(payload({ settlementId: null }))
      expect(settlements.findPendingByContract).toHaveBeenCalledWith(
        'contract-1',
      )
      expect(drafts.recalculate).toHaveBeenCalledWith(pending)
    })
  })

  describe('pago en una liquidación pendiente', () => {
    it('la recalcula: el pago ya no es liquidable', async () => {
      const { reaction, settlements, drafts } = setup()
      const pending = makeSettlement({ id: 'settlement-1' })
      settlements.findById.mockResolvedValue(pending)
      await reaction.handle(payload())
      expect(drafts.recalculate).toHaveBeenCalledWith(pending)
      expect(settlements.addAdjustment).not.toHaveBeenCalled()
    })
  })

  describe('pago en una liquidación confirmada (A-19)', () => {
    const confirmed = () =>
      makeSettlement({
        id: 'settlement-1',
        status: SettlementStatus.CONFIRMED,
        payments: [
          makePaymentLine({
            paymentId: 'pay-1',
            rentApplied: '100000.00',
            lateFeeApplied: '5000.00',
            ownerChargesApplied: '1000.00',
          }),
        ],
      })

    it('la deja como está, la marca y descuenta lo que el pago le dio al propietario en la próxima pendiente', async () => {
      const { reaction, settlements, drafts } = setup()
      settlements.findById
        .mockResolvedValueOnce(confirmed())
        // La pendiente releída ya con el ajuste cargado.
        .mockResolvedValueOnce(
          makeSettlement({
            id: 'draft',
            rentTotal: '50000.00',
            feeTotal: '2500.00',
            feeDeducted: true,
            adjustments: [
              makeAdjustment({
                concept: SettlementAdjustmentConcept.OTHER_DEDUCTION,
                amount: '106000.00',
              }),
              makeAdjustment({ amount: '500.00', voidedAt: new Date() }),
            ],
          }),
        )
      drafts.draftForAdjustment.mockResolvedValue(
        makeSettlement({ id: 'draft' }),
      )
      await reaction.handle(payload())

      expect(settlements.update).toHaveBeenNthCalledWith(1, 'settlement-1', {
        hasVoidedPayments: true,
      })
      expect(drafts.recalculate).not.toHaveBeenCalled()
      expect(settlements.addAdjustment).toHaveBeenCalledWith('draft', {
        concept: SettlementAdjustmentConcept.OTHER_DEDUCTION,
        description:
          'Pago anulado del 2026-10-05 (cuota 2026-09) ya liquidado: Transferencia rechazada',
        // Alquiler + punitorio + cargos del propietario del pago anulado.
        amount: '106000.00',
        originPaymentId: 'pay-1',
        createdById: null,
      })
      // El neto de la pendiente se recalcula con el ajuste (los anulados no cuentan):
      // 50.000 − 2.500 − 106.000.
      expect(settlements.update).toHaveBeenNthCalledWith(2, 'draft', {
        adjustmentsTotal: '-106000.00',
        netAmount: '-58500.00',
      })
    })

    it('usa los importes de la línea de la liquidación, no los del evento', async () => {
      const { reaction, settlements, drafts } = setup()
      settlements.findById.mockResolvedValue(confirmed())
      drafts.draftForAdjustment.mockResolvedValue(
        makeSettlement({ id: 'draft' }),
      )
      await reaction.handle(
        payload({
          rentApplied: '1.00',
          lateFeeApplied: '1.00',
          chargesApplied: '1.00',
        }),
      )
      expect(settlements.addAdjustment).toHaveBeenCalledWith(
        'draft',
        expect.objectContaining({ amount: '106000.00' }),
      )
    })

    it('si la línea no está, descuenta con los importes del evento', async () => {
      const { reaction, settlements, drafts } = setup()
      settlements.findById.mockResolvedValue(
        makeSettlement({
          id: 'settlement-1',
          status: SettlementStatus.TRANSFERRED,
        }),
      )
      drafts.draftForAdjustment.mockResolvedValue(
        makeSettlement({ id: 'draft' }),
      )
      await reaction.handle(payload())
      expect(settlements.addAdjustment).toHaveBeenCalledWith(
        'draft',
        expect.objectContaining({ amount: '106000.00' }),
      )
    })

    it('es idempotente por pago: si el ajuste ya está, no lo duplica', async () => {
      const { reaction, settlements, drafts } = setup()
      settlements.findById.mockResolvedValue(
        makeSettlement({
          id: 'settlement-1',
          status: SettlementStatus.CONFIRMED,
          hasVoidedPayments: true,
        }),
      )
      drafts.draftForAdjustment.mockResolvedValue(
        makeSettlement({
          id: 'draft',
          adjustments: [makeAdjustment({ originPaymentId: 'pay-1' })],
        }),
      )
      await reaction.handle(payload())
      expect(settlements.addAdjustment).not.toHaveBeenCalled()
      // Ya estaba marcada: tampoco la vuelve a marcar.
      expect(settlements.update).not.toHaveBeenCalled()
    })

    it('si no se pudo obtener la pendiente (contrato borrado) no falla', async () => {
      const { reaction, settlements, drafts } = setup()
      settlements.findById.mockResolvedValue(confirmed())
      drafts.draftForAdjustment.mockResolvedValue(null)
      await expect(reaction.handle(payload())).resolves.toBeUndefined()
      expect(settlements.addAdjustment).not.toHaveBeenCalled()
    })
  })

  describe('otros estados', () => {
    it('una liquidación cancelada no se toca', async () => {
      const { reaction, settlements, drafts } = setup()
      settlements.findById.mockResolvedValue(
        makeSettlement({ status: SettlementStatus.CANCELLED }),
      )
      await reaction.handle(payload())
      expect(drafts.recalculate).not.toHaveBeenCalled()
      expect(drafts.draftForAdjustment).not.toHaveBeenCalled()
    })

    it('si la liquidación ya no existe lo registra y sigue', async () => {
      const { reaction, settlements, drafts } = setup()
      settlements.findById.mockResolvedValue(null)
      await expect(reaction.handle(payload())).resolves.toBeUndefined()
      expect(drafts.recalculate).not.toHaveBeenCalled()
    })
  })

  describe('honorario devengado por un pago del propietario (4.8)', () => {
    it('sin cobros, el honorario se anula', async () => {
      const { reaction, receivables } = setup()
      receivables.findByOriginPayment.mockResolvedValue(
        makeReceivable({ id: 'r1', paidAmount: '0.00' }),
      )
      await reaction.handle(payload({ settlementId: null }))
      expect(receivables.update).toHaveBeenCalledWith('r1', {
        status: FeeReceivableStatus.VOIDED,
        voidedAt: expect.any(Date),
      })
    })

    it('con cobros, queda marcado para revisión manual y no se anula', async () => {
      const { reaction, receivables } = setup()
      receivables.findByOriginPayment.mockResolvedValue(
        makeReceivable({ id: 'r1', paidAmount: '0.01' }),
      )
      await reaction.handle(payload({ settlementId: null }))
      expect(receivables.update).toHaveBeenCalledWith('r1', {
        needsReview: true,
      })
    })

    it('si ya estaba anulado no vuelve a tocarlo', async () => {
      const { reaction, receivables } = setup()
      receivables.findByOriginPayment.mockResolvedValue(
        makeReceivable({ status: FeeReceivableStatus.VOIDED }),
      )
      await reaction.handle(payload({ settlementId: null }))
      expect(receivables.update).not.toHaveBeenCalled()
    })
  })
})
