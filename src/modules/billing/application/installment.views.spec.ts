import { UsersFacade } from '@/modules/auth/public'
import { OwnersFacade } from '@/modules/owners/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import {
  CreditStatus,
  Currency,
  InstallmentStatus,
  LateFeeAdjustmentKind,
  PaymentKind,
  PaymentReceiver,
  PaymentStatus,
} from '../domain/billing'
import { RenterCreditRepository } from '../domain/billing.ports'
import { InstallmentPolicy } from '../domain/installment.policy'
import {
  at,
  makeAdjustment,
  makeCharge,
  makeCredit,
  makeInstallment,
  makePayment,
} from '../testing/billing.fixtures'
import {
  ArrearsStatus,
  InstallmentViews,
  sumByCurrency,
  toPaymentView,
  toSummary,
} from './installment.views'

const TODAY = '2026-10-15'

function buildViews(credits: ReturnType<typeof makeCredit>[] = []) {
  const properties = {
    describe: jest
      .fn()
      .mockResolvedValue(
        new Map([
          ['property-1', { id: 'property-1', label: 'Av. Siempreviva 742' }],
        ]),
      ),
  }
  const renters = {
    describe: jest
      .fn()
      .mockResolvedValue(new Map([['renter-1', { id: 'renter-1' }]])),
  }
  const owners = {
    describe: jest
      .fn()
      .mockResolvedValue(new Map([['owner-1', { id: 'owner-1' }]])),
  }
  const users = {
    describe: jest
      .fn()
      .mockResolvedValue(new Map([['user-1', { id: 'user-1', name: 'Ana' }]])),
  }
  const creditRepository = {
    listAvailable: jest.fn().mockResolvedValue(credits),
  }
  const views = new InstallmentViews(
    properties as unknown as PropertiesFacade,
    renters as unknown as RentersFacade,
    owners as unknown as OwnersFacade,
    users as unknown as UsersFacade,
    creditRepository as unknown as RenterCreditRepository,
  )
  return { views, properties, renters, owners, users, creditRepository }
}

describe('sumByCurrency', () => {
  it('suma por moneda sin mezclar y respeta el orden de aparición', () => {
    expect(
      sumByCurrency([
        { currency: Currency.USD, amount: '10.10' },
        { currency: Currency.ARS, amount: '100.00' },
        { currency: Currency.USD, amount: '0.20' },
        { currency: Currency.ARS, amount: '0.05' },
      ]),
    ).toEqual([
      { currency: Currency.USD, amount: '10.30' },
      { currency: Currency.ARS, amount: '100.05' },
    ])
  })

  it('sin movimientos no hay monedas', () => {
    expect(sumByCurrency([])).toEqual([])
  })
})

describe('toSummary', () => {
  it('muestra OVERDUE si queda saldo y pasó la gracia, aunque se guarde PENDING', () => {
    const installment = makeInstallment()
    const view = toSummary(
      installment,
      InstallmentPolicy.balances(installment, TODAY),
      {
        properties: new Map(),
        renters: new Map(),
        owners: new Map(),
      },
      TODAY,
    )
    expect(view.status).toBe(InstallmentStatus.OVERDUE)
    expect(view.totalDue).toBe('250000.00')
    expect(view.lateFeeAccrued).toBe('50000.00')
    expect(view.feeDays).toBe(5)
    // Si la propiedad, el inquilino o el propietario se borraron, quedan en null.
    expect(view.property).toBeNull()
    expect(view.renter).toBeNull()
    expect(view.owner).toBeNull()
  })
})

describe('toPaymentView', () => {
  it('resuelve los usuarios por id y deja null los que no existen o no hay', () => {
    const payment = makePayment({
      rentApplied: '1000.00',
      registeredById: 'user-1',
      confirmedById: 'user-desconocido',
      voidedById: null,
    })
    const view = toPaymentView(
      payment,
      '2026-10',
      new Map([['user-1', { id: 'user-1', name: 'Ana' } as never]]),
    )
    expect(view.registeredBy).toMatchObject({ id: 'user-1' })
    expect(view.confirmedBy).toBeNull()
    expect(view.voidedBy).toBeNull()
    expect(view.amount).toBe('1000.00')
    expect(view.period).toBe('2026-10')
  })
})

describe('InstallmentViews.summaries', () => {
  it('sin cuotas devuelve vacío sin consultar a otros módulos', async () => {
    const { views, properties } = buildViews()
    await expect(views.summaries([], TODAY)).resolves.toEqual([])
    expect(properties.describe).not.toHaveBeenCalled()
  })

  it('arma una fila por cuota con los saldos a la fecha dada', async () => {
    const { views } = buildViews()
    const [row] = await views.summaries([makeInstallment()], TODAY)
    expect(row.property).toMatchObject({ id: 'property-1' })
    expect(row.totalDue).toBe('250000.00')
    expect(row.status).toBe(InstallmentStatus.OVERDUE)
  })
})

describe('InstallmentViews.detail', () => {
  it('suma los créditos disponibles sin errores de coma flotante', async () => {
    const { views } = buildViews([
      makeCredit({ remaining: '0.10' }),
      makeCredit({ remaining: '0.20' }),
    ])
    const detail = await views.detail(makeInstallment(), TODAY)
    expect(detail.creditsAvailable).toBe('0.30')
  })

  it('impaga, muestra el detalle de punitorio calculado a hoy', async () => {
    const { views } = buildViews()
    const detail = await views.detail(makeInstallment(), TODAY)
    expect(detail.lateFeeDays).toHaveLength(5)
    expect(detail.lateFeeDays[0]).toMatchObject({
      day: '2026-10-11',
      amount: '10000.00',
    })
  })

  it('saldada, manda el detalle congelado y no el recalculado (A-4)', async () => {
    const frozen = [
      {
        day: '2026-10-11',
        dayNumber: 1,
        outstandingBase: '200000.00',
        dailyPercentage: '5.00',
        amount: '10000.00',
      },
    ]
    const { views } = buildViews()
    const detail = await views.detail(
      makeInstallment({
        status: InstallmentStatus.PAID,
        paidAt: '2026-10-11',
        frozenFeeDays: frozen,
        payments: [
          makePayment({
            paidAt: '2026-10-11',
            rentApplied: '200000.00',
            lateFeeApplied: '10000.00',
          }),
        ],
      }),
      TODAY,
    )
    expect(detail.lateFeeDays).toEqual(frozen)
    expect(detail.totalDue).toBe('0.00')
    expect(detail.status).toBe(InstallmentStatus.PAID)
  })

  it('incluye cargos y pagos con quién los cargó, y los honorarios devengados', async () => {
    const { views } = buildViews()
    const detail = await views.detail(
      makeInstallment({
        charges: [makeCharge({ amount: '30000.00', createdById: 'user-1' })],
        adjustments: [
          makeAdjustment({
            kind: LateFeeAdjustmentKind.REDUCE,
            amount: '10000.00',
            createdById: 'otro',
          }),
        ],
      }),
      TODAY,
    )
    expect(detail.charges[0].createdBy).toMatchObject({ id: 'user-1' })
    expect(detail.lateFeeAdjustments[0].createdBy).toBeNull()
    expect(detail.chargesTotal).toBe('30000.00')
    // 5 % del alquiler base; nada cobrado todavía.
    expect(detail.feeOnBase).toBe('10000.00')
    expect(detail.feeOnCollected).toBe('0.00')
    // 250.000 de alquiler y punitorio + 30.000 de cargo − 10.000 de reducción.
    expect(detail.lateFeeBalance).toBe('40000.00')
    expect(detail.totalDue).toBe('270000.00')
  })
})

describe('InstallmentViews.breakdown (desglose a una fecha, spec 3.4)', () => {
  it('con crédito menor a la deuda lo aplica entero', async () => {
    const { views } = buildViews([makeCredit({ remaining: '50000.00' })])
    const breakdown = await views.breakdown(makeInstallment(), TODAY, TODAY)
    expect(breakdown.totalDue).toBe('250000.00')
    expect(breakdown.creditAvailable).toBe('50000.00')
    expect(breakdown.totalDueAfterCredit).toBe('200000.00')
  })

  it('con crédito mayor a la deuda sólo aplica lo que se debe y no queda negativo', async () => {
    const { views } = buildViews([makeCredit({ remaining: '999999.99' })])
    const breakdown = await views.breakdown(makeInstallment(), TODAY, TODAY)
    expect(breakdown.creditAvailable).toBe('999999.99')
    expect(breakdown.totalDueAfterCredit).toBe('0.00')
  })

  it('con crédito igual a la deuda deja el saldo en cero', async () => {
    const { views } = buildViews([
      makeCredit({ remaining: '100000.00' }),
      makeCredit({ remaining: '150000.00' }),
    ])
    const breakdown = await views.breakdown(makeInstallment(), TODAY, TODAY)
    expect(breakdown.totalDueAfterCredit).toBe('0.00')
  })

  it('sin crédito la deuda no cambia', async () => {
    const { views } = buildViews([])
    const breakdown = await views.breakdown(makeInstallment(), TODAY, TODAY)
    expect(breakdown.creditAvailable).toBe('0.00')
    expect(breakdown.totalDueAfterCredit).toBe('250000.00')
  })

  it('calcula los saldos a la fecha pedida y el estado a hoy', async () => {
    const { views } = buildViews()
    // A la fecha de gracia no hay punitorio; hoy ya está vencida.
    const breakdown = await views.breakdown(
      makeInstallment(),
      '2026-10-10',
      TODAY,
    )
    expect(breakdown.asOf).toBe('2026-10-10')
    expect(breakdown.feeDays).toBe(0)
    expect(breakdown.totalDue).toBe('200000.00')
    expect(breakdown.status).toBe(InstallmentStatus.OVERDUE)
  })

  it('pide los créditos del inquilino en la moneda de la cuota', async () => {
    const { views, creditRepository } = buildViews()
    await views.breakdown(
      makeInstallment({ currency: Currency.USD }),
      TODAY,
      TODAY,
    )
    expect(creditRepository.listAvailable).toHaveBeenCalledWith(
      'renter-1',
      Currency.USD,
    )
  })
})

describe('InstallmentViews.summary (resumen del mes)', () => {
  const vencida = makeInstallment({
    id: 'a',
    payments: [
      // El propietario cobró 20.000 de alquiler directo (confirmado).
      makePayment({
        installmentId: 'a',
        paidAt: '2026-10-05',
        rentApplied: '20000.00',
        receivedBy: PaymentReceiver.OWNER,
      }),
    ],
  })
  const saldada = makeInstallment({
    id: 'b',
    baseAmount: '100000.00',
    status: InstallmentStatus.PAID,
    paidAt: '2026-10-05',
    payments: [
      makePayment({
        installmentId: 'b',
        paidAt: '2026-10-05',
        rentApplied: '100000.00',
      }),
      // Anulado: no cuenta en nada.
      makePayment({
        installmentId: 'b',
        paidAt: '2026-10-06',
        rentApplied: '77777.00',
        status: PaymentStatus.VOIDED,
      }),
    ],
  })
  const enDolares = makeInstallment({
    id: 'c',
    currency: Currency.USD,
    baseAmount: '500.00',
    graceEndDate: '2026-10-31',
  })

  it('agrupa por moneda sin mezclar y cuenta los estados', () => {
    const { views } = buildViews()
    const result = views.summary(
      '2026-10',
      [vencida, saldada, enDolares],
      TODAY,
    )
    expect(result.period).toBe('2026-10')
    expect(result.byCurrency.map((c) => c.currency)).toEqual([
      Currency.ARS,
      Currency.USD,
    ])
    const [ars, usd] = result.byCurrency
    expect(ars).toMatchObject({ total: 2, overdue: 1, paid: 1, pending: 0 })
    expect(usd).toMatchObject({ total: 1, overdue: 0, pending: 1 })
  })

  it('suma lo cobrado según quién lo recibió y no cuenta los pagos anulados', () => {
    const { views } = buildViews()
    const [ars] = views.summary('2026-10', [vencida, saldada], TODAY).byCurrency
    expect(ars.collectedTotal).toBe('120000.00')
    expect(ars.collectedByAgency).toBe('100000.00')
    expect(ars.collectedByOwner).toBe('20000.00')
  })

  it('el saldo y el punitorio salen de las cuotas impagas', () => {
    const { views } = buildViews()
    const [ars] = views.summary('2026-10', [vencida, saldada], TODAY).byCurrency
    expect(ars.baseTotal).toBe('300000.00')
    // El pago de 20.000 del día 5 baja la base impaga a 180.000: 9.000 × 5 días.
    expect(ars.lateFeeAccrued).toBe('45000.00')
    expect(ars.lateFeeCollected).toBe('0.00')
    expect(ars.balanceTotal).toBe('225000.00')
  })

  it('los honorarios se devengan sobre la base y sobre lo cobrado confirmado', () => {
    const { views } = buildViews()
    const [ars] = views.summary('2026-10', [vencida, saldada], TODAY).byCurrency
    // 5 % de 200.000 + 5 % de 100.000.
    expect(ars.feeAccruedOnBase).toBe('15000.00')
    // 5 % de 20.000 + 5 % de 100.000 (el pago anulado no cuenta).
    expect(ars.feeAccruedOnCollected).toBe('6000.00')
  })

  it('los pagos sin confirmar entran como cobrados por quien los recibió pero se informan aparte', () => {
    const { views } = buildViews()
    const pendiente = makeInstallment({
      id: 'p',
      status: InstallmentStatus.PARTIAL,
      payments: [
        makePayment({
          installmentId: 'p',
          paidAt: '2026-10-05',
          rentApplied: '10000.00',
          status: PaymentStatus.PENDING_CONFIRMATION,
        }),
      ],
    })
    const [ars] = views.summary('2026-10', [pendiente], TODAY).byCurrency
    expect(ars.pendingConfirmationTotal).toBe('10000.00')
    expect(ars.collectedByAgency).toBe('10000.00')
    // Los honorarios sobre lo cobrado sólo miran pagos confirmados.
    expect(ars.feeAccruedOnCollected).toBe('0.00')
  })

  it('un crédito aplicado no cuenta como cobro de caja', () => {
    const { views } = buildViews()
    const conCredito = makeInstallment({
      id: 'k',
      payments: [
        makePayment({
          installmentId: 'k',
          paidAt: '2026-10-05',
          rentApplied: '5000.00',
          kind: PaymentKind.CREDIT_APPLICATION,
        }),
      ],
    })
    const [ars] = views.summary('2026-10', [conCredito], TODAY).byCurrency
    expect(ars.collectedByAgency).toBe('0.00')
    expect(ars.collectedTotal).toBe('5000.00')
  })

  it('sin cuotas no hay monedas', () => {
    const { views } = buildViews()
    expect(views.summary('2026-10', [], TODAY).byCurrency).toEqual([])
  })
})

describe('InstallmentViews.arrears (mora por inquilino)', () => {
  it('distingue al día, pendiente y vencido, y mide los días de atraso', () => {
    const { views } = buildViews()
    const vencida = makeInstallment({ id: 'v', renterId: 'r1' })
    const proxima = makeInstallment({
      id: 'n',
      renterId: 'r1',
      period: '2026-11',
      graceEndDate: '2026-11-10',
    })
    const soloPendiente = makeInstallment({
      id: 's',
      renterId: 'r2',
      graceEndDate: '2026-10-20',
    })
    const saldada = makeInstallment({
      id: 'z',
      renterId: 'r3',
      status: InstallmentStatus.PAID,
      paidAt: '2026-10-02',
      payments: [
        makePayment({ rentApplied: '200000.00', paidAt: '2026-10-02' }),
      ],
    })
    const result = views.arrears(
      ['r1', 'r2', 'r3', 'r4'],
      [vencida, proxima, soloPendiente, saldada],
      TODAY,
    )
    expect(result.map((r) => r.status)).toEqual([
      ArrearsStatus.OVERDUE,
      ArrearsStatus.PENDING,
      ArrearsStatus.UP_TO_DATE,
      ArrearsStatus.UP_TO_DATE,
    ])
    expect(result[0]).toMatchObject({
      renterId: 'r1',
      overdueInstallments: 1,
      maxDaysOverdue: 5,
    })
    // Deuda total: 250.000 de la vencida + 200.000 de noviembre.
    expect(result[0].balance).toEqual([
      { currency: Currency.ARS, amount: '450000.00' },
    ])
    expect(result[0].lateFeeAccrued).toEqual([
      { currency: Currency.ARS, amount: '50000.00' },
    ])
    expect(result[1].maxDaysOverdue).toBe(0)
    expect(result[2].balance).toEqual([])
  })

  it('el punitorio de mora descuenta lo ya pagado y lo reducido', () => {
    const { views } = buildViews()
    const cuota = makeInstallment({
      renterId: 'r1',
      adjustments: [makeAdjustment({ amount: '10000.00' })],
      payments: [
        makePayment({
          paidAt: '2026-10-12',
          lateFeeApplied: '5000.00',
          rentApplied: '0.00',
        }),
      ],
    })
    const [row] = views.arrears(['r1'], [cuota], TODAY)
    // 50.000 devengados − 10.000 reducidos − 5.000 pagados.
    expect(row.lateFeeAccrued).toEqual([
      { currency: Currency.ARS, amount: '35000.00' },
    ])
    expect(row.balance).toEqual([
      { currency: Currency.ARS, amount: '235000.00' },
    ])
  })
})

describe('InstallmentViews.credits', () => {
  it('el total disponible sólo suma los créditos AVAILABLE, por moneda', () => {
    const { views } = buildViews()
    const result = views.credits('renter-1', [
      makeCredit({ remaining: '100.10' }),
      makeCredit({ remaining: '0.20' }),
      makeCredit({ remaining: '900.00', status: CreditStatus.APPLIED }),
      makeCredit({ remaining: '50.00', currency: Currency.USD }),
      makeCredit({ remaining: '70.00', status: CreditStatus.REFUNDED }),
    ])
    expect(result.totals).toEqual([
      { currency: Currency.ARS, available: '100.30' },
      { currency: Currency.USD, available: '50.00' },
    ])
    expect(result.credits).toHaveLength(5)
  })
})

describe('InstallmentViews.paymentList', () => {
  it('sin pagos devuelve vacío sin consultar', async () => {
    const { views, users } = buildViews()
    await expect(views.paymentList([], [])).resolves.toEqual([])
    expect(users.describe).not.toHaveBeenCalled()
  })

  it('agrega inquilino, propiedad y la moneda del contrato', async () => {
    const { views } = buildViews()
    const installment = makeInstallment({ currency: Currency.USD })
    const payment = makePayment({
      rentApplied: '10.00',
      paidCurrency: Currency.ARS,
      createdAt: at('2026-10-15'),
    })
    const [item] = await views.paymentList([payment], [installment])
    expect(item.currency).toBe(Currency.USD)
    expect(item.period).toBe('2026-10')
    expect(item.renter).toMatchObject({ id: 'renter-1' })
    expect(item.registeredBy).toMatchObject({ id: 'user-1' })
  })

  it('si la cuota no vino, cae a la moneda del pago y deja el período vacío', async () => {
    const { views } = buildViews()
    const payment = makePayment({
      installmentId: 'inexistente',
      paidCurrency: Currency.USD,
    })
    const [item] = await views.paymentList([payment], [])
    expect(item.currency).toBe(Currency.USD)
    expect(item.period).toBe('')
    expect(item.property).toBeNull()
  })
})
