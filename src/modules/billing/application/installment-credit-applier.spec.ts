import { EventBus } from '@nestjs/cqrs'

import { TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { CreditStatus, Installment, RenterCredit } from '../domain/billing'
import {
  InstallmentRepository,
  PaymentRepository,
  RenterCreditRepository,
} from '../domain/billing.ports'
import { installment } from '../domain/installment.policy.spec'
import { applyCreditPlan } from './credit-application'
import { InstallmentCreditApplier } from './installment-credit-applier'
import { InstallmentRecalculator } from './installment-recalculator'

jest.mock('./credit-application', () => ({
  applyCreditPlan: jest.fn(),
  publishConfirmed: jest.fn(),
}))

const credit = {
  id: 'credit-1',
  renterId: 'renter-1',
  currency: 'ARS',
  amount: '50000.00',
  remaining: '50000.00',
  status: CreditStatus.AVAILABLE,
} as unknown as RenterCredit

function setup(autoApply = true) {
  const calls: string[] = []
  let inTransaction = false
  const where = () => (inTransaction ? 'tx' : 'fuera')
  const installments = {
    lockForUpdate: jest.fn(async () => {
      calls.push(`lock(${where()})`)
    }),
    findById: jest.fn(async (): Promise<Installment | null> => {
      calls.push(`findById(${where()})`)
      return installment()
    }),
  }
  const credits = {
    listAvailable: jest.fn(async () => {
      calls.push(`credits(${where()})`)
      return [credit]
    }),
  }
  const mocked = applyCreditPlan as jest.Mock
  mocked.mockReset()
  mocked.mockImplementation(async () => {
    calls.push('apply')
    return { created: [], balances: {} }
  })
  const prisma = {
    transaction: async <T>(fn: () => Promise<T>) => {
      inTransaction = true
      try {
        return await fn()
      } finally {
        inTransaction = false
      }
    },
  }
  const applier = new InstallmentCreditApplier(
    {
      getBillingSettings: jest
        .fn()
        .mockResolvedValue({ autoApplyCreditOnGeneration: autoApply }),
    } as unknown as TenantsFacade,
    installments as unknown as InstallmentRepository,
    {} as PaymentRepository,
    credits as unknown as RenterCreditRepository,
    {
      recalculate: jest.fn(async () => installment()),
    } as unknown as InstallmentRecalculator,
    prisma as unknown as PrismaService,
    { publish: jest.fn() } as unknown as EventBus,
  )
  const run = <T>(fn: () => Promise<T>) =>
    RequestContext.run(
      { tenantId: 'tenant-1', correlationId: 'c' } as never,
      fn,
    )
  return { applier, calls, installments, mocked, run }
}

describe('InstallmentCreditApplier', () => {
  it('toma el lock de la cuota antes de leer saldos y créditos, todo dentro de la transacción', async () => {
    const { applier, calls, run } = setup()
    await run(() => applier.applyIfAutomatic(installment()))
    expect(calls).toEqual(['lock(tx)', 'findById(tx)', 'credits(tx)', 'apply'])
  })

  it('con el modo manual no toca la cuota ni el saldo', async () => {
    const { applier, calls, run } = setup(false)
    await run(() => applier.applyIfAutomatic(installment()))
    expect(calls).toEqual([])
  })

  it('usa los saldos de después del lock: si ya no se debe nada, no aplica el saldo a favor', async () => {
    const { applier, installments, mocked, run } = setup()
    // Entre generar la cuota y tomar el lock, alguien la dejó en cero.
    installments.findById.mockResolvedValue(installment({ baseAmount: '0.00' }))
    const applied = await run(() => applier.applyIfAutomatic(installment()))
    expect(applied).toBe(0)
    expect(mocked).not.toHaveBeenCalled()
  })

  it('si la cuota ya no existe, no aplica nada', async () => {
    const { applier, installments, mocked, run } = setup()
    installments.findById.mockResolvedValue(null)
    expect(await run(() => applier.applyIfAutomatic(installment()))).toBe(0)
    expect(mocked).not.toHaveBeenCalled()
  })
})
