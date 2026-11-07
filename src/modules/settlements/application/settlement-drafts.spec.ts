import { BillingFacade, SettleablePayment } from '@/modules/billing/public'
import {
  CollectionMode,
  ContractRef,
  ContractStatus,
  Currency as ContractCurrency,
  DepositReturnMode,
  FeeMode as ContractFeeMode,
} from '@/modules/contracts/public'
import { PendingExpenseRef, ServicesFacade } from '@/modules/services/public'
import { Currency, FeeMode, Settlement } from '../domain/settlement'
import {
  SettlementDraftExistsException,
  SettlementNothingToSettleException,
  SettlementNotPendingException,
} from '../domain/settlement.exceptions'
import { SettlementRepository } from '../domain/settlement.ports'
import { makeAdjustment, makeSettlement } from '../testing/settlement.fixtures'
import { SettlementDrafts } from './settlement-drafts'
import { SettlementReferences } from './settlement-references'
import {
  SettlementAdjustmentConcept,
  SettlementStatus,
} from '../domain/settlement'

const NOW = new Date('2026-10-29T15:00:00.000Z')

function contract(overrides: Partial<ContractRef> = {}): ContractRef {
  return {
    id: 'contract-1',
    propertyId: 'property-1',
    ownerId: 'owner-1',
    renterId: 'renter-1',
    status: ContractStatus.ACTIVE,
    currency: ContractCurrency.ARS,
    startDate: '2026-01-01',
    endDate: '2028-12-31',
    currentRent: '100000.00',
    deposit: '100000.00',
    depositCurrency: ContractCurrency.ARS,
    depositReturnMode: DepositReturnMode.FIXED,
    billingTerms: {
      id: 'terms',
      effectiveFrom: '2026-01-01',
      collectionMode: CollectionMode.AGENCY,
      feeMode: ContractFeeMode.DEDUCTED,
      feePercentage: '5.00',
      feeAmount: null,
      lateFeePercentage: '5.00',
      lateFeeGraceDays: 10,
      lateFeeStartDay: 11,
      inheritedLateFeePercentage: false,
      inheritedLateFeeGraceDays: false,
      notes: null,
      changedById: null,
      createdAt: NOW,
    },
    ...overrides,
  }
}

let n = 0
function settleable(
  overrides: Partial<SettleablePayment> & {
    charges?: Partial<SettleablePayment['chargesApplied']>
    terms?: Partial<SettleablePayment['installment']>
  } = {},
): SettleablePayment {
  n += 1
  const { charges, terms, ...rest } = overrides
  return {
    paymentId: `pay-${n}`,
    installmentId: 'inst-1',
    paidAt: '2026-10-05',
    rentApplied: '100000.00',
    lateFeeApplied: '0.00',
    chargesApplied: {
      SERVICE: '0.00',
      TERMINATION_PENALTY: '0.00',
      OTHER: '0.00',
      ...charges,
    } as SettleablePayment['chargesApplied'],
    currency: 'ARS' as SettleablePayment['currency'],
    installment: {
      installmentId: 'inst-1',
      period: '2026-10',
      currency: 'ARS' as SettleablePayment['currency'],
      baseAmount: '100000.00',
      feeMode: 'DEDUCTED' as SettleablePayment['installment']['feeMode'],
      feePercentage: '5.00',
      feeAmount: null,
      ...terms,
    },
    ...rest,
  }
}

function expense(
  overrides: Partial<PendingExpenseRef> = {},
): PendingExpenseRef {
  n += 1
  return {
    id: `exp-${n}`,
    contractId: 'contract-1',
    renterId: 'renter-1',
    amount: '1500.00',
    currency: 'ARS' as PendingExpenseRef['currency'],
    description: 'Plomero',
    expenseDate: '2026-10-02',
    ...overrides,
  }
}

function setup(
  payments: SettleablePayment[] = [],
  expenses: PendingExpenseRef[] = [],
) {
  const references = {
    feeRules: jest.fn().mockResolvedValue({
      feeIncludesLateFees: false,
      feeIncludesCharges: false,
    }),
    requireContract: jest.fn().mockResolvedValue(contract()),
  }
  const settlements = {
    findPendingByContract: jest.fn().mockResolvedValue(null),
    maxSequence: jest.fn().mockResolvedValue(null),
    create: jest
      .fn()
      .mockImplementation(async (data: Partial<Settlement>) =>
        makeSettlement({ ...data, id: 'created' }),
      ),
    update: jest
      .fn()
      .mockImplementation(async (id: string, data: Partial<Settlement>) =>
        makeSettlement({ ...data, id }),
      ),
    replaceLines: jest.fn().mockResolvedValue(undefined),
    lockPending: jest.fn().mockResolvedValue(true),
    findById: jest.fn().mockResolvedValue(null),
  }
  const billing = {
    listSettleablePayments: jest.fn().mockResolvedValue(payments),
  }
  const services = {
    pendingExpensesByContract: jest
      .fn()
      .mockResolvedValue({ total: '0.00', items: expenses }),
  }
  const drafts = new SettlementDrafts(
    references as unknown as SettlementReferences,
    settlements as unknown as SettlementRepository,
    billing as unknown as BillingFacade,
    services as unknown as ServicesFacade,
  )
  return { drafts, references, settlements, billing, services }
}

describe('SettlementDrafts', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW })
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  describe('compute', () => {
    it('los cargos SERVICE se informan pero no entran al neto del propietario (A-16)', async () => {
      const { drafts } = setup([
        settleable({
          charges: {
            SERVICE: '30000.00',
            OTHER: '5000.00',
            TERMINATION_PENALTY: '2000.00',
          },
        }),
      ])
      const computed = await drafts.compute(contract())
      expect(computed.ownerChargesTotal).toBe('7000.00')
      expect(computed.serviceChargesTotal).toBe('30000.00')
      // 5 % del alquiler: los cargos no entran a la base si el propietario no lo pide.
      expect(computed.feeTotal).toBe('5000.00')
      expect(computed.feeDeducted).toBe(true)
    })

    it('el honorario fijo se prorratea por el alquiler cobrado (A-15)', async () => {
      const { drafts } = setup([
        settleable({
          rentApplied: '50000.00',
          terms: { baseAmount: '100000.00', feeAmount: '10000.00' },
        }),
      ])
      const computed = await drafts.compute(contract())
      expect(computed.feeTotal).toBe('5000.00')
      expect(computed.feeAmountFixed).toBe('10000.00')
    })

    it('dos pagos parciales de una cuota con honorario fijo suman el fijo entero', async () => {
      const terms = { baseAmount: '100000.00', feeAmount: '10000.00' }
      const { drafts } = setup([
        settleable({ rentApplied: '33333.33', terms }),
        settleable({ rentApplied: '66666.67', terms }),
      ])
      // Se calcula por cuota (no por pago): un solo redondeo, exacto.
      expect((await drafts.compute(contract())).feeTotal).toBe('10000.00')
    })

    it('la base del honorario incluye punitorios y cargos sólo si el propietario lo pide', async () => {
      const { drafts, references } = setup([
        settleable({
          lateFeeApplied: '10000.00',
          charges: { OTHER: '10000.00', SERVICE: '99999.00' },
        }),
      ])
      references.feeRules.mockResolvedValue({
        feeIncludesLateFees: true,
        feeIncludesCharges: true,
      })
      const computed = await drafts.compute(contract())
      // 100.000 + 10.000 + 10.000 (nunca los SERVICE) al 5 %.
      expect(computed.feeBase).toBe('120000.00')
      expect(computed.feeTotal).toBe('6000.00')
    })

    it('los gastos en otra moneda que el contrato no se descuentan', async () => {
      const { drafts } = setup(
        [settleable()],
        [
          expense({ amount: '1500.00' }),
          expense({ amount: '50.00', currency: 'USD' as never }),
        ],
      )
      const computed = await drafts.compute(contract())
      expect(computed.expensesTotal).toBe('1500.00')
      expect(computed.skippedExpenses).toHaveLength(1)
    })

    it('pide a cada módulo lo suyo con el contrato', async () => {
      const { drafts, billing, services, references } = setup()
      await drafts.compute(contract())
      expect(billing.listSettleablePayments).toHaveBeenCalledWith('contract-1')
      expect(services.pendingExpensesByContract).toHaveBeenCalledWith(
        'contract-1',
      )
      expect(references.feeRules).toHaveBeenCalledWith('owner-1')
    })

    it('sin pagos usa la modalidad del contrato como referencia', async () => {
      const { drafts } = setup([], [expense()])
      const computed = await drafts.compute(
        contract({
          billingTerms: {
            ...contract().billingTerms,
            feeMode: ContractFeeMode.OWNER_PAYS,
            feePercentage: '3.50',
          },
        }),
      )
      expect(computed.feeMode).toBe(FeeMode.OWNER_PAYS)
      expect(computed.feeDeducted).toBe(false)
      expect(computed.feePercentage).toBe('3.50')
      expect(computed.feeTotal).toBe('0.00')
    })
  })

  describe('create', () => {
    it('crea la pendiente con el neto: alquiler + cargos − honorarios − gastos', async () => {
      const { drafts, settlements } = setup(
        [settleable({ charges: { OTHER: '2000.00' } })],
        [expense({ amount: '1500.00' })],
      )
      await drafts.create(contract(), '2026-10')
      expect(settlements.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          ownerId: 'owner-1',
          currency: Currency.ARS,
          period: '2026-10',
          sequence: 1,
          rentTotal: '100000.00',
          ownerChargesTotal: '2000.00',
          feeTotal: '5000.00',
          expensesTotal: '1500.00',
          adjustmentsTotal: '0.00',
          // 100.000 + 2.000 − 5.000 − 1.500.
          netAmount: '95500.00',
        }),
      )
    })

    it('si el honorario no se descuenta, el neto no lo resta', async () => {
      const { drafts, settlements } = setup([
        settleable({
          terms: { feeMode: 'OWNER_PAYS' as never },
        }),
      ])
      await drafts.create(contract(), '2026-10')
      expect(settlements.create).toHaveBeenCalledWith(
        expect.objectContaining({
          feeTotal: '5000.00',
          feeDeducted: false,
          netAmount: '100000.00',
        }),
      )
    })

    it('numera la liquidación parcial siguiente del mes', async () => {
      const { drafts, settlements } = setup([settleable()])
      settlements.maxSequence.mockResolvedValue(2)
      await drafts.create(contract(), '2026-10')
      expect(settlements.maxSequence).toHaveBeenCalledWith(
        'contract-1',
        '2026-10',
      )
      expect(settlements.create).toHaveBeenCalledWith(
        expect.objectContaining({ sequence: 3 }),
      )
    })

    it('sólo con gastos adelantados se puede liquidar y el neto queda negativo', async () => {
      const { drafts, settlements } = setup(
        [],
        [expense({ amount: '1500.00' })],
      )
      await drafts.create(contract(), '2026-10')
      expect(settlements.create).toHaveBeenCalledWith(
        expect.objectContaining({ netAmount: '-1500.00' }),
      )
    })

    it('una sola pendiente por contrato', async () => {
      const { drafts, settlements } = setup([settleable()])
      settlements.findPendingByContract.mockResolvedValue(makeSettlement())
      await expect(drafts.create(contract(), '2026-10')).rejects.toBeInstanceOf(
        SettlementDraftExistsException,
      )
      expect(settlements.create).not.toHaveBeenCalled()
    })

    it('sin pagos ni gastos no hay nada que liquidar', async () => {
      const { drafts, settlements } = setup()
      await expect(drafts.create(contract(), '2026-10')).rejects.toBeInstanceOf(
        SettlementNothingToSettleException,
      )
      expect(settlements.create).not.toHaveBeenCalled()
    })

    it('un gasto en otra moneda no alcanza para liquidar', async () => {
      const { drafts } = setup([], [expense({ currency: 'USD' as never })])
      await expect(drafts.create(contract(), '2026-10')).rejects.toBeInstanceOf(
        SettlementNothingToSettleException,
      )
    })
  })

  describe('recalculate', () => {
    it('toma de nuevo pagos y gastos y conserva los ajustes vigentes en el neto', async () => {
      const { drafts, settlements } = setup([settleable()])
      const pending = makeSettlement({
        id: 's1',
        adjustments: [
          makeAdjustment({
            concept: SettlementAdjustmentConcept.WITHHOLDING,
            amount: '1000.00',
          }),
          makeAdjustment({
            concept: SettlementAdjustmentConcept.OTHER_CREDIT,
            amount: '300.00',
          }),
          // Anulado: no cuenta.
          makeAdjustment({
            amount: '99999.00',
            voidedAt: new Date(),
          }),
        ],
      })
      await drafts.recalculate(pending)
      expect(settlements.replaceLines).toHaveBeenCalledWith(
        's1',
        [expect.objectContaining({ rentApplied: '100000.00' })],
        [],
      )
      expect(settlements.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          adjustmentsTotal: '-700.00',
          // 100.000 − 5.000 − 700.
          netAmount: '94300.00',
        }),
      )
    })

    it('el recálculo no devuelve las claves internas de la computación', async () => {
      const { drafts, settlements } = setup([settleable()])
      await drafts.recalculate(makeSettlement({ id: 's1' }))
      const [, changes] = settlements.update.mock.calls[0]
      expect(changes).not.toHaveProperty('payments')
      expect(changes).not.toHaveProperty('expenses')
      expect(changes).not.toHaveProperty('skippedExpenses')
    })

    it('sólo se recalcula una pendiente', async () => {
      const { drafts, settlements } = setup([settleable()])
      await expect(
        drafts.recalculate(
          makeSettlement({ status: SettlementStatus.CONFIRMED }),
        ),
      ).rejects.toBeInstanceOf(SettlementNotPendingException)
      expect(settlements.replaceLines).not.toHaveBeenCalled()
    })
  })

  describe('recalculate con una confirmación concurrente (C4)', () => {
    // Antes el recálculo no tomaba el lock: si otro request confirmaba la
    // liquidación en el medio, reescribía las líneas y los totales de una
    // liquidación ya confirmada.
    it('si al tomar el lock ya no está pendiente, no toca nada', async () => {
      const { drafts, settlements } = setup([settleable()])
      settlements.lockPending.mockResolvedValue(false)
      settlements.findById.mockResolvedValue(
        makeSettlement({ id: 's1', status: SettlementStatus.CONFIRMED }),
      )
      await expect(
        drafts.recalculate(makeSettlement({ id: 's1' })),
      ).rejects.toBeInstanceOf(SettlementNotPendingException)
      expect(settlements.replaceLines).not.toHaveBeenCalled()
      expect(settlements.update).not.toHaveBeenCalled()
    })

    it('el listener crea una pendiente nueva si la que había se confirmó en el medio', async () => {
      const { drafts, settlements } = setup([settleable()])
      settlements.findPendingByContract.mockResolvedValue(
        makeSettlement({ id: 'old' }),
      )
      settlements.lockPending.mockResolvedValue(false)
      const created = await drafts.ensureDraft('contract-1')
      expect(created?.id).toBe('created')
      expect(settlements.replaceLines).not.toHaveBeenCalled()
    })
  })

  describe('ensureDraft (listener de cuota pagada)', () => {
    it('si el contrato ya no existe lo ignora', async () => {
      const { drafts, references, settlements } = setup([settleable()])
      references.requireContract.mockRejectedValue(new Error('no existe'))
      await expect(drafts.ensureDraft('contract-1')).resolves.toBeNull()
      expect(settlements.create).not.toHaveBeenCalled()
    })

    it('con una pendiente existente la recalcula en vez de duplicarla', async () => {
      const { drafts, settlements } = setup([settleable()])
      settlements.findPendingByContract.mockResolvedValue(
        makeSettlement({ id: 'existing' }),
      )
      await drafts.ensureDraft('contract-1')
      expect(settlements.create).not.toHaveBeenCalled()
      expect(settlements.update).toHaveBeenCalledWith(
        'existing',
        expect.anything(),
      )
    })

    it('sin pendiente ni pagos de la inmobiliaria no crea nada', async () => {
      const { drafts, settlements } = setup([], [expense()])
      await expect(drafts.ensureDraft('contract-1')).resolves.toBeNull()
      expect(settlements.create).not.toHaveBeenCalled()
    })

    it('sin pendiente y con pagos crea una para el mes de hoy', async () => {
      const { drafts, settlements } = setup([settleable()])
      await drafts.ensureDraft('contract-1')
      expect(settlements.create).toHaveBeenCalledWith(
        expect.objectContaining({ period: '2026-10', sequence: 1 }),
      )
    })
  })

  describe('draftForAdjustment (pago anulado después de confirmar, A-19)', () => {
    it('reusa la pendiente si existe', async () => {
      const { drafts, settlements } = setup()
      const existing = makeSettlement({ id: 'existing' })
      settlements.findPendingByContract.mockResolvedValue(existing)
      await expect(drafts.draftForAdjustment('contract-1')).resolves.toBe(
        existing,
      )
      expect(settlements.create).not.toHaveBeenCalled()
    })

    it('si no hay, crea una vacía para que el ajuste tenga dónde caer', async () => {
      const { drafts, settlements } = setup()
      await drafts.draftForAdjustment('contract-1')
      expect(settlements.create).toHaveBeenCalledWith(
        expect.objectContaining({
          rentTotal: '0.00',
          netAmount: '0.00',
          payments: [],
          expenses: [],
        }),
      )
    })

    it('si el contrato no existe, devuelve null', async () => {
      const { drafts, references } = setup()
      references.requireContract.mockRejectedValue(new Error('no existe'))
      await expect(drafts.draftForAdjustment('contract-1')).resolves.toBeNull()
    })
  })

  it('las líneas de pago creadas conservan los importes de cada pago', async () => {
    const { drafts, settlements } = setup([
      settleable({
        paymentId: 'pay-x',
        rentApplied: '70000.00',
        lateFeeApplied: '3000.00',
        charges: { OTHER: '500.00', SERVICE: '800.00' },
      }),
    ])
    await drafts.create(contract(), '2026-10')
    const [{ payments }] = settlements.create.mock.calls[0]
    expect(payments).toEqual([
      {
        paymentId: 'pay-x',
        installmentId: 'inst-1',
        installmentPeriod: '2026-10',
        paidAt: '2026-10-05',
        rentApplied: '70000.00',
        lateFeeApplied: '3000.00',
        ownerChargesApplied: '500.00',
        serviceChargesApplied: '800.00',
      },
    ])
  })
})
