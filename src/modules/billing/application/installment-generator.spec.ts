import { ContractsFacade } from '@/modules/contracts/public'
import { InstallmentRepository } from '../domain/billing.ports'
import { CollectionMode, Currency, FeeMode } from '../domain/billing'
import { InstallmentCreditApplier } from './installment-credit-applier'
import { InstallmentGenerator } from './installment-generator'

function activeContract(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contract-1',
    propertyId: 'property-1',
    ownerId: 'owner-1',
    renterId: 'renter-1',
    currency: 'ARS',
    currentRent: '200000.5',
    billingTerms: {
      collectionMode: 'AGENCY',
      feeMode: 'DEDUCTED',
      feePercentage: '5.00',
      feeAmount: null,
      lateFeePercentage: '5.00',
      lateFeeGraceDays: 10,
    },
    ...overrides,
  }
}

function setup(contracts: ReturnType<typeof activeContract>[]) {
  const repo = {
    createIfAbsent: jest.fn().mockResolvedValue({ id: 'new' }),
  }
  const facade = {
    listActiveForPeriod: jest.fn().mockResolvedValue(contracts),
  }
  const creditApplier = { applyIfAutomatic: jest.fn().mockResolvedValue(0) }
  const generator = new InstallmentGenerator(
    repo as unknown as InstallmentRepository,
    facade as unknown as ContractsFacade,
    creditApplier as unknown as InstallmentCreditApplier,
  )
  return { generator, repo, facade, creditApplier }
}

describe('InstallmentGenerator', () => {
  it('crea una cuota por contrato con la base redondeada y los términos congelados', async () => {
    const { generator, repo, facade } = setup([activeContract()])
    const result = await generator.generate('2026-10')
    expect(facade.listActiveForPeriod).toHaveBeenCalledWith('2026-10')
    expect(repo.createIfAbsent).toHaveBeenCalledWith({
      contractId: 'contract-1',
      renterId: 'renter-1',
      ownerId: 'owner-1',
      propertyId: 'property-1',
      period: '2026-10',
      baseAmount: '200000.50',
      currency: Currency.ARS,
      // Gracia de 10 días: el último día sin punitorio es el 10.
      graceEndDate: '2026-10-10',
      lateFeePercentage: '5.00',
      lateFeeGraceDays: 10,
      collectionMode: CollectionMode.AGENCY,
      feeMode: FeeMode.DEDUCTED,
      feePercentage: '5.00',
      feeAmount: null,
    })
    expect(result).toEqual({
      period: '2026-10',
      contracts: 1,
      created: 1,
      skipped: 0,
      creditsApplied: 0,
    })
  })

  it('es idempotente: lo que ya tenía cuota se cuenta como omitido', async () => {
    const { generator, repo } = setup([
      activeContract(),
      activeContract({ id: 'contract-2' }),
    ])
    repo.createIfAbsent
      .mockResolvedValueOnce({ id: 'new' })
      .mockResolvedValueOnce(null)
    await expect(generator.generate('2026-10')).resolves.toEqual({
      period: '2026-10',
      contracts: 2,
      created: 1,
      skipped: 1,
      creditsApplied: 0,
    })
  })

  it('aplica el saldo a favor sólo a las cuotas que acaba de crear, nunca a las que ya existían (D-237)', async () => {
    const created = { id: 'new' }
    const { generator, repo, creditApplier } = setup([
      activeContract(),
      activeContract({ id: 'contract-2' }),
    ])
    creditApplier.applyIfAutomatic.mockResolvedValue(1)
    repo.createIfAbsent
      .mockResolvedValueOnce(created)
      .mockResolvedValueOnce(null)
    const result = await generator.generate('2026-10')
    expect(creditApplier.applyIfAutomatic).toHaveBeenCalledTimes(1)
    expect(creditApplier.applyIfAutomatic).toHaveBeenCalledWith(created)
    expect(result).toMatchObject({ created: 1, skipped: 1, creditsApplied: 1 })
  })

  it('copia el honorario fijo del contrato cuando lo tiene', async () => {
    const { generator, repo } = setup([
      activeContract({
        billingTerms: {
          collectionMode: 'OWNER_DIRECT',
          feeMode: 'OWNER_PAYS',
          feePercentage: '0.00',
          feeAmount: '15000.00',
          lateFeePercentage: '2.50',
          lateFeeGraceDays: 5,
        },
      }),
    ])
    await generator.generate('2026-10')
    expect(repo.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        graceEndDate: '2026-10-05',
        lateFeePercentage: '2.50',
        collectionMode: CollectionMode.OWNER_DIRECT,
        feeMode: FeeMode.OWNER_PAYS,
        feeAmount: '15000.00',
      }),
    )
  })

  it('sin período pedido genera el del mes que viene', async () => {
    jest.useFakeTimers({ now: new Date('2026-03-12T15:00:00.000Z') })
    try {
      const { generator, facade } = setup([])
      const result = await generator.generate(null)
      expect(facade.listActiveForPeriod).toHaveBeenCalledWith('2026-04')
      expect(result).toEqual({
        period: '2026-04',
        contracts: 0,
        created: 0,
        skipped: 0,
        creditsApplied: 0,
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('un período mal formado se rechaza antes de buscar contratos', async () => {
    const { generator, facade } = setup([])
    await expect(generator.generate('2026-13')).rejects.toThrow()
    expect(facade.listActiveForPeriod).not.toHaveBeenCalled()
  })
})
