import {
  FeePaymentRepository,
  FeeReceivableRepository,
  NewFeeReceivable,
} from '../domain/settlement.ports'
import {
  Currency,
  FeePayer,
  FeeReceivable,
  FeeReceivableSource,
  FeeReceivableStatus,
} from '../domain/settlement'
import { makeFeePayment, makeReceivable } from '../testing/settlement.fixtures'
import { FeeAccountService } from './fee-account.service'

function newReceivable(overrides: Partial<NewFeeReceivable> = {}) {
  return {
    ownerId: 'owner-1',
    contractId: 'contract-1',
    installmentId: 'inst-1',
    period: '2026-10',
    currency: Currency.ARS,
    source: FeeReceivableSource.OWNER_DIRECT_PAYMENT,
    payer: FeePayer.OWNER,
    originPaymentId: 'pay-1',
    originSettlementId: null,
    amount: '10000.00',
    feePercentage: '5.00',
    feeAmountFixed: null,
    baseAmount: '200000.00',
    ...overrides,
  } satisfies NewFeeReceivable
}

function setup() {
  const receivables = {
    createIfAbsent: jest
      .fn()
      .mockImplementation(async (data: NewFeeReceivable) =>
        makeReceivable({ ...data, id: 'recv-new', paidAmount: '0.00' }),
      ),
    update: jest
      .fn()
      .mockImplementation(async (id: string, changes: Partial<FeeReceivable>) =>
        makeReceivable({
          id,
          amount: '10000.00',
          ...changes,
        }),
      ),
  }
  const payments = {
    listAll: jest.fn().mockResolvedValue([]),
    addAllocations: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  }
  const service = new FeeAccountService(
    receivables as unknown as FeeReceivableRepository,
    payments as unknown as FeePaymentRepository,
  )
  return { service, receivables, payments }
}

describe('FeeAccountService', () => {
  describe('accrue', () => {
    it('un honorario en cero (o negativo) no devenga nada', async () => {
      const { service, receivables } = setup()
      await expect(
        service.accrue(newReceivable({ amount: '0.00' })),
      ).resolves.toBeNull()
      await expect(
        service.accrue(newReceivable({ amount: '-5.00' })),
      ).resolves.toBeNull()
      expect(receivables.createIfAbsent).not.toHaveBeenCalled()
    })

    it('es idempotente por origen: el reintento de un listener no duplica', async () => {
      const { service, receivables, payments } = setup()
      receivables.createIfAbsent.mockResolvedValue(null)
      await expect(service.accrue(newReceivable())).resolves.toBeNull()
      expect(payments.listAll).not.toHaveBeenCalled()
    })

    it('sin pagos sin imputar queda pendiente por el monto entero', async () => {
      const { service, receivables } = setup()
      const result = await service.accrue(newReceivable())
      expect(result).toMatchObject({ id: 'recv-new', amount: '10000.00' })
      expect(receivables.update).not.toHaveBeenCalled()
    })

    it('busca los pagos con saldo sin imputar del mismo propietario y moneda, del más viejo al más nuevo', async () => {
      const { service, payments } = setup()
      await service.accrue(newReceivable())
      expect(payments.listAll).toHaveBeenCalledWith(
        { ownerId: 'owner-1', currency: Currency.ARS, withUnallocated: true },
        'oldest',
      )
    })

    it('un pago adelantado de honorarios cubre el receivable nuevo en parte', async () => {
      const { service, receivables, payments } = setup()
      payments.listAll.mockResolvedValue([
        makeFeePayment({ id: 'fp1', unallocatedAmount: '4000.00' }),
      ])
      await service.accrue(newReceivable())
      expect(payments.addAllocations).toHaveBeenCalledWith('fp1', [
        { feeReceivableId: 'recv-new', amount: '4000.00' },
      ])
      expect(payments.update).toHaveBeenCalledWith('fp1', {
        unallocatedAmount: '0.00',
      })
      expect(receivables.update).toHaveBeenCalledWith('recv-new', {
        paidAmount: '4000.00',
        status: FeeReceivableStatus.PARTIAL,
      })
    })

    it('si los pagos sobrantes alcanzan, lo deja pagado y el excedente sigue sin imputar', async () => {
      const { service, receivables, payments } = setup()
      payments.listAll.mockResolvedValue([
        makeFeePayment({ id: 'fp1', unallocatedAmount: '7000.00' }),
        makeFeePayment({ id: 'fp2', unallocatedAmount: '5000.00' }),
        makeFeePayment({ id: 'fp3', unallocatedAmount: '9999.00' }),
      ])
      receivables.update.mockImplementation(
        async (id: string, changes: Partial<FeeReceivable>) =>
          makeReceivable({ id, amount: '10000.00', ...changes }),
      )
      const result = await service.accrue(newReceivable())
      expect(payments.addAllocations).toHaveBeenCalledTimes(2)
      expect(payments.addAllocations).toHaveBeenNthCalledWith(1, 'fp1', [
        { feeReceivableId: 'recv-new', amount: '7000.00' },
      ])
      expect(payments.addAllocations).toHaveBeenNthCalledWith(2, 'fp2', [
        { feeReceivableId: 'recv-new', amount: '3000.00' },
      ])
      // fp2 conserva 2.000; fp3 ni se toca.
      expect(payments.update).toHaveBeenNthCalledWith(2, 'fp2', {
        unallocatedAmount: '2000.00',
      })
      expect(payments.update).toHaveBeenCalledTimes(2)
      expect(result).toMatchObject({
        paidAmount: '10000.00',
        status: FeeReceivableStatus.PAID,
      })
    })
  })

  describe('applyToReceivable', () => {
    it('suma lo imputado y recalcula el estado', async () => {
      const { service, receivables } = setup()
      const receivable = makeReceivable({
        id: 'r1',
        amount: '10000.00',
        paidAmount: '2500.50',
      })
      await service.applyToReceivable(receivable, '0.25')
      expect(receivables.update).toHaveBeenCalledWith('r1', {
        paidAmount: '2500.75',
        status: FeeReceivableStatus.PARTIAL,
      })
    })

    it('al completar el monto queda PAID', async () => {
      const { service, receivables } = setup()
      const receivable = makeReceivable({
        id: 'r1',
        amount: '10000.00',
        paidAmount: '9999.99',
      })
      await service.applyToReceivable(receivable, '0.01')
      expect(receivables.update).toHaveBeenCalledWith('r1', {
        paidAmount: '10000.00',
        status: FeeReceivableStatus.PAID,
      })
    })
  })
})
