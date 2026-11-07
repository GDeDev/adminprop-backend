import { EventBus } from '@nestjs/cqrs'

import { StoragePort } from '@/platform/storage/storage.port'
import { RequestContext } from '@/shared/context/request-context'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  CreditStatus,
  Currency,
  ExchangeRateSource,
  Installment,
  InstallmentStatus,
  Payment,
  PaymentKind,
  PaymentMethod,
  PaymentReceiver,
  PaymentStatus,
} from '../../domain/billing'
import {
  CreditNotAvailableException,
  CreditNotFoundException,
  ExchangeRateRequiredException,
  InstallmentAlreadyPaidException,
  InvalidPaymentDateException,
  PaymentAlreadyConfirmedException,
  PaymentAlreadyVoidedException,
  PaymentCreditAlreadyUsedException,
  PaymentNotFoundException,
} from '../../domain/billing.exceptions'
import {
  InstallmentRepository,
  PaymentRepository,
  RenterCreditRepository,
} from '../../domain/billing.ports'
import {
  makeCharge,
  makeCredit,
  makeInstallment,
  makePayment,
} from '../../testing/billing.fixtures'
import { IdempotencyService } from '@/shared/idempotency/idempotency.service'
import { BillingReferences } from '../billing-references'
import {
  PaymentConfirmedEvent,
  PaymentVoidedEvent,
} from '../events/payment-events'
import { InstallmentRecalculator } from '../installment-recalculator'
import { InstallmentViews } from '../installment.views'
import {
  ApplyCreditCommand,
  ConfirmPaymentCommand,
  RefundCreditCommand,
  RegisterPaymentCommand,
  RegisterPaymentInput,
  VoidPaymentCommand,
} from './billing.commands'
import {
  ApplyCreditHandler,
  ConfirmPaymentHandler,
  RefundCreditHandler,
  RegisterPaymentHandler,
  VoidPaymentHandler,
} from './payment.handlers'

// Hoy: 20 de octubre de 2026. La cuota vence (gracia) el 10, así que un pago
// del 15 trae 5 días de punitorio: 5 × 10.000 = 50.000 sobre 200.000 de base.
const NOW = new Date('2026-10-20T15:00:00.000Z')

const PDF = Buffer.from('%PDF-1.4 comprobante')

/** Cuota con un cargo de 30.000: total a pagar el 15 = 50.000 + 200.000 + 30.000. */
function installmentWithCharge(overrides: Partial<Installment> = {}) {
  return makeInstallment({
    charges: [makeCharge({ amount: '30000.00' })],
    ...overrides,
  })
}

function input(overrides: Partial<RegisterPaymentInput> = {}) {
  return {
    paidAt: '2026-10-15',
    amount: '280000.00',
    paidCurrency: Currency.ARS,
    exchangeRate: null,
    exchangeRateSource: null,
    exchangeRateDate: null,
    method: PaymentMethod.TRANSFER,
    receivedBy: null,
    allocation: null,
    applyCredit: false,
    notes: null,
    ...overrides,
  } satisfies RegisterPaymentInput
}

function inUserContext<T>(fn: () => Promise<T>): Promise<T> {
  return RequestContext.run(
    { correlationId: 'test', userId: 'user-1', tenantId: 'tenant-1' },
    fn,
  )
}

function build(installment: Installment = installmentWithCharge()) {
  const references = {
    requireInstallment: jest.fn().mockResolvedValue(installment),
  }
  const payments = {
    // Devuelve lo que se le pasó, ya convertido en un pago completo.
    create: jest.fn().mockImplementation(async (data: Partial<Payment>) =>
      makePayment({
        ...data,
        id: `new-${payments.create.mock.calls.length}`,
      }),
    ),
    findById: jest.fn(),
    confirm: jest.fn(),
    void: jest.fn(),
  }
  const credits = {
    create: jest.fn().mockResolvedValue(undefined),
    listAvailable: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    findByOriginPayment: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(makeCredit()),
  }
  const recalculator = {
    recalculate: jest.fn().mockResolvedValue(installment),
  }
  const storage = {
    upload: jest
      .fn()
      .mockResolvedValue({ key: 'tenants/t/payments/x.pdf', url: 'http://x' }),
    delete: jest.fn().mockResolvedValue(undefined),
  }
  const prisma = {
    transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  }
  const views = {
    detail: jest.fn().mockResolvedValue({ payments: [] }),
  }
  const eventBus = { publish: jest.fn() }
  const installments = {
    findById: jest.fn().mockResolvedValue(installment),
    lockForUpdate: jest.fn().mockResolvedValue(undefined),
  }
  const idempotency = {
    begin: jest.fn().mockResolvedValue({ replay: false }),
    complete: jest.fn().mockResolvedValue(undefined),
    purgeExpired: jest.fn().mockResolvedValue(undefined),
  }
  return {
    idempotency,
    references,
    payments,
    credits,
    recalculator,
    storage,
    prisma,
    views,
    eventBus,
    installments,
  }
}

type Deps = ReturnType<typeof build>

function registerHandler(d: Deps) {
  return new RegisterPaymentHandler(
    d.references as unknown as BillingReferences,
    d.installments as unknown as InstallmentRepository,
    d.payments as unknown as PaymentRepository,
    d.credits as unknown as RenterCreditRepository,
    d.recalculator as unknown as InstallmentRecalculator,
    d.storage as unknown as StoragePort,
    d.prisma as unknown as PrismaService,
    d.views as unknown as InstallmentViews,
    d.eventBus as unknown as EventBus,
    d.idempotency as unknown as IdempotencyService,
  )
}

const created = (d: Deps, index = 0): Record<string, unknown> =>
  d.payments.create.mock.calls[index][0]

describe('RegisterPaymentHandler', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW })
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  it('un pago exacto se imputa punitorio, alquiler y cargos, queda confirmado y avisa', async () => {
    const d = build()
    await inUserContext(() =>
      registerHandler(d).execute(
        new RegisterPaymentCommand('inst-1', input(), Buffer.alloc(0)),
      ),
    )
    expect(created(d)).toMatchObject({
      kind: PaymentKind.CASH_IN,
      receivedBy: PaymentReceiver.AGENCY,
      status: PaymentStatus.CONFIRMED,
      lateFeeApplied: '50000.00',
      rentApplied: '200000.00',
      chargesApplied: '30000.00',
      creditGenerated: '0.00',
      amountInContractCurrency: '280000.00',
      registeredById: 'user-1',
    })
    expect(d.credits.create).not.toHaveBeenCalled()
    expect(d.recalculator.recalculate).toHaveBeenCalledWith('inst-1')
    expect(d.eventBus.publish).toHaveBeenCalledTimes(1)
    expect(d.eventBus.publish.mock.calls[0][0]).toBeInstanceOf(
      PaymentConfirmedEvent,
    )
  })

  it('un pago parcial cubre primero el punitorio y después el alquiler', async () => {
    const d = build()
    await inUserContext(() =>
      registerHandler(d).execute(
        new RegisterPaymentCommand(
          'inst-1',
          input({ amount: '120000.00' }),
          Buffer.alloc(0),
        ),
      ),
    )
    expect(created(d)).toMatchObject({
      lateFeeApplied: '50000.00',
      rentApplied: '70000.00',
      chargesApplied: '0.00',
      creditGenerated: '0.00',
    })
  })

  it('el exceso nace como saldo a favor ligado al pago', async () => {
    const d = build()
    await inUserContext(() =>
      registerHandler(d).execute(
        new RegisterPaymentCommand(
          'inst-1',
          input({ amount: '300000.00' }),
          Buffer.alloc(0),
        ),
      ),
    )
    expect(created(d).creditGenerated).toBe('20000.00')
    expect(d.credits.create).toHaveBeenCalledWith({
      renterId: 'renter-1',
      contractId: 'contract-1',
      currency: Currency.ARS,
      amount: '20000.00',
      originPaymentId: 'new-1',
      heldBy: 'AGENCY',
    })
  })

  it('una imputación manual respeta el reparto pedido', async () => {
    const d = build()
    await inUserContext(() =>
      registerHandler(d).execute(
        new RegisterPaymentCommand(
          'inst-1',
          input({
            amount: '100000.00',
            allocation: JSON.stringify({ rent: '100000.00' }),
          }),
          Buffer.alloc(0),
        ),
      ),
    )
    expect(created(d)).toMatchObject({
      lateFeeApplied: '0.00',
      rentApplied: '100000.00',
      chargesApplied: '0.00',
    })
  })

  it('un pago en dólares a una cuota en pesos se convierte con la cotización', async () => {
    const d = build()
    await inUserContext(() =>
      registerHandler(d).execute(
        new RegisterPaymentCommand(
          'inst-1',
          input({
            amount: '100.00',
            paidCurrency: Currency.USD,
            exchangeRate: '1000',
            exchangeRateSource: ExchangeRateSource.MEP,
            exchangeRateDate: '2026-10-15',
          }),
          Buffer.alloc(0),
        ),
      ),
    )
    expect(created(d)).toMatchObject({
      paidCurrency: Currency.USD,
      amount: '100.00',
      amountInContractCurrency: '100000.00',
      exchangeRate: '1000.0000',
      exchangeRateSource: ExchangeRateSource.MEP,
      lateFeeApplied: '50000.00',
      rentApplied: '50000.00',
    })
  })

  it('un pago en otra moneda sin cotización se rechaza antes de guardar nada', async () => {
    const d = build()
    await expect(
      inUserContext(() =>
        registerHandler(d).execute(
          new RegisterPaymentCommand(
            'inst-1',
            input({ paidCurrency: Currency.USD }),
            Buffer.alloc(0),
          ),
        ),
      ),
    ).rejects.toBeInstanceOf(ExchangeRateRequiredException)
    expect(d.payments.create).not.toHaveBeenCalled()
  })

  it('lo cobrado por el propietario queda informado: no avisa a liquidaciones hasta que se confirme', async () => {
    const d = build()
    await inUserContext(() =>
      registerHandler(d).execute(
        new RegisterPaymentCommand(
          'inst-1',
          input({ receivedBy: PaymentReceiver.OWNER }),
          Buffer.alloc(0),
        ),
      ),
    )
    expect(created(d)).toMatchObject({
      receivedBy: PaymentReceiver.OWNER,
      status: PaymentStatus.PENDING_CONFIRMATION,
    })
    expect(d.eventBus.publish).not.toHaveBeenCalled()
  })

  it('aplicando saldo a favor primero, el pago en plata cubre sólo lo que falta', async () => {
    const d = build()
    d.credits.listAvailable.mockResolvedValue([
      makeCredit({ id: 'credit-a', remaining: '30000.00' }),
    ])
    await inUserContext(() =>
      registerHandler(d).execute(
        new RegisterPaymentCommand(
          'inst-1',
          input({ applyCredit: true, amount: '250000.00' }),
          Buffer.alloc(0),
        ),
      ),
    )
    expect(d.payments.create).toHaveBeenCalledTimes(2)
    expect(created(d, 0)).toMatchObject({
      kind: PaymentKind.CREDIT_APPLICATION,
      method: PaymentMethod.CREDIT,
      amount: '30000.00',
      creditId: 'credit-a',
      lateFeeApplied: '30000.00',
    })
    // Quedaban 250.000 por pagar: el pago en plata cubre exactamente eso.
    expect(created(d, 1)).toMatchObject({
      kind: PaymentKind.CASH_IN,
      lateFeeApplied: '20000.00',
      rentApplied: '200000.00',
      chargesApplied: '30000.00',
      creditGenerated: '0.00',
    })
    expect(d.credits.update).toHaveBeenCalledWith('credit-a', {
      remaining: '0.00',
      status: CreditStatus.APPLIED,
    })
    // Aviso por el crédito aplicado y por el pago: dos.
    expect(d.eventBus.publish).toHaveBeenCalledTimes(2)
  })

  it('un saldo a favor que se usa sólo en parte queda disponible por el resto', async () => {
    const d = build()
    d.credits.listAvailable.mockResolvedValue([
      makeCredit({ id: 'credit-a', remaining: '500000.00' }),
    ])
    await inUserContext(() =>
      registerHandler(d).execute(
        new RegisterPaymentCommand(
          'inst-1',
          input({ applyCredit: true, amount: '1.00' }),
          Buffer.alloc(0),
        ),
      ),
    )
    expect(d.credits.update).toHaveBeenCalledWith('credit-a', {
      remaining: '220000.00',
      status: CreditStatus.AVAILABLE,
    })
  })

  it('una cuota sin saldo a la fecha del pago no admite otro pago', async () => {
    const d = build(
      makeInstallment({ baseAmount: '0.00', status: InstallmentStatus.PAID }),
    )
    await expect(
      inUserContext(() =>
        registerHandler(d).execute(
          new RegisterPaymentCommand('inst-1', input(), Buffer.alloc(0)),
        ),
      ),
    ).rejects.toBeInstanceOf(InstallmentAlreadyPaidException)
  })

  it('bloquea la cuota y recalcula los saldos dentro de la transacción', async () => {
    // La cuota que se leyó antes estaba impaga; para cuando se tomó el lock,
    // otro pago ya la había saldado. Sin releer adentro, este pago se imputaba
    // contra un saldo viejo.
    const stale = installmentWithCharge()
    const settled = installmentWithCharge({
      payments: [
        makePayment({
          lateFeeApplied: '50000.00',
          rentApplied: '200000.00',
          chargesApplied: '30000.00',
        }),
      ],
    })
    const d = build(stale)
    d.references.requireInstallment
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(settled)

    await expect(
      inUserContext(() =>
        registerHandler(d).execute(
          new RegisterPaymentCommand('inst-1', input(), Buffer.alloc(0)),
        ),
      ),
    ).rejects.toBeInstanceOf(InstallmentAlreadyPaidException)

    expect(d.installments.lockForUpdate).toHaveBeenCalledWith('inst-1')
    expect(d.payments.create).not.toHaveBeenCalled()
    // El lock va antes de la segunda lectura de la cuota.
    expect(
      d.installments.lockForUpdate.mock.invocationCallOrder[0],
    ).toBeLessThan(d.references.requireInstallment.mock.invocationCallOrder[1])
  })

  describe('con Idempotency-Key', () => {
    const KEY = 'pago-123'
    const withKey = (amount = '280000.00') =>
      new RegisterPaymentCommand(
        'inst-1',
        input({ amount }),
        Buffer.alloc(0),
        KEY,
      )

    it('la primera vez registra el pago y guarda con qué reconstruirlo', async () => {
      const d = build()
      await inUserContext(() => registerHandler(d).execute(withKey()))

      expect(d.idempotency.begin).toHaveBeenCalledWith(
        'billing.register-payment',
        KEY,
        expect.stringMatching(/^[0-9a-f]{64}$/),
      )
      expect(d.payments.create).toHaveBeenCalledTimes(1)
      expect(d.idempotency.complete).toHaveBeenCalledWith(
        'billing.register-payment',
        KEY,
        { paymentId: 'new-1', creditApplicationIds: [] },
      )
    })

    it('la misma clave con otro monto no es el mismo pedido: otra huella', async () => {
      const d = build()
      await inUserContext(() => registerHandler(d).execute(withKey()))
      await inUserContext(() =>
        registerHandler(d).execute(withKey('100000.00')),
      )
      const [first, second] = d.idempotency.begin.mock.calls.map((c) => c[2])
      expect(first).not.toEqual(second)
    })

    it('si la clave ya se usó devuelve el pago de la primera vez sin crear otro', async () => {
      const original = makePayment({ id: 'pay-orig' })
      const d = build()
      d.idempotency.begin.mockResolvedValue({
        replay: true,
        response: { paymentId: 'pay-orig', creditApplicationIds: [] },
      })
      d.payments.findById.mockResolvedValue(original)

      await inUserContext(() => registerHandler(d).execute(withKey()))

      expect(d.payments.create).not.toHaveBeenCalled()
      expect(d.installments.lockForUpdate).not.toHaveBeenCalled()
      expect(d.credits.create).not.toHaveBeenCalled()
      expect(d.eventBus.publish).not.toHaveBeenCalled()
    })

    it('el reintento de un pago que saldó la cuota devuelve ese pago y no un 409', async () => {
      const paid = installmentWithCharge({
        status: InstallmentStatus.PAID,
        payments: [
          makePayment({
            id: 'pay-orig',
            lateFeeApplied: '50000.00',
            rentApplied: '200000.00',
            chargesApplied: '30000.00',
          }),
        ],
      })
      const d = build(paid)
      d.idempotency.begin.mockResolvedValue({
        replay: true,
        response: { paymentId: 'pay-orig', creditApplicationIds: [] },
      })
      d.payments.findById.mockResolvedValue(paid.payments[0])

      await expect(
        inUserContext(() => registerHandler(d).execute(withKey())),
      ).resolves.toBeDefined()
    })

    it('si era un reintento descarta el comprobante recién subido', async () => {
      const d = build()
      d.idempotency.begin.mockResolvedValue({
        replay: true,
        response: { paymentId: 'pay-orig', creditApplicationIds: [] },
      })
      d.payments.findById.mockResolvedValue(makePayment({ id: 'pay-orig' }))

      await inUserContext(() =>
        registerHandler(d).execute(
          new RegisterPaymentCommand('inst-1', input(), PDF, KEY),
        ),
      )

      expect(d.storage.upload).toHaveBeenCalledTimes(1)
      expect(d.storage.delete).toHaveBeenCalledTimes(1)
    })

    it('sin clave no toca la tabla de idempotencia', async () => {
      const d = build()
      await inUserContext(() =>
        registerHandler(d).execute(
          new RegisterPaymentCommand('inst-1', input(), Buffer.alloc(0)),
        ),
      )
      expect(d.idempotency.begin).not.toHaveBeenCalled()
      expect(d.idempotency.complete).not.toHaveBeenCalled()
    })
  })

  it('un pago con fecha futura se rechaza', async () => {
    const d = build()
    await expect(
      inUserContext(() =>
        registerHandler(d).execute(
          new RegisterPaymentCommand(
            'inst-1',
            input({ paidAt: '2026-10-21' }),
            Buffer.alloc(0),
          ),
        ),
      ),
    ).rejects.toBeInstanceOf(InvalidPaymentDateException)
  })

  it('sin usuario en el contexto no registra nada', async () => {
    const d = build()
    await expect(
      registerHandler(d).execute(
        new RegisterPaymentCommand('inst-1', input(), Buffer.alloc(0)),
      ),
    ).rejects.toThrow('sin usuario')
  })

  it('sube el comprobante y lo guarda con el pago', async () => {
    const d = build()
    await inUserContext(() =>
      registerHandler(d).execute(
        new RegisterPaymentCommand('inst-1', input(), PDF),
      ),
    )
    expect(d.storage.upload).toHaveBeenCalledTimes(1)
    expect(created(d)).toMatchObject({
      receiptKey: 'tenants/t/payments/x.pdf',
      receiptUrl: 'http://x',
    })
    expect(d.storage.delete).not.toHaveBeenCalled()
  })

  it('si la transacción falla, borra el comprobante que ya había subido y no avisa', async () => {
    const d = build()
    d.recalculator.recalculate.mockRejectedValue(new Error('se cayó'))
    await expect(
      inUserContext(() =>
        registerHandler(d).execute(
          new RegisterPaymentCommand('inst-1', input(), PDF),
        ),
      ),
    ).rejects.toThrow('se cayó')
    expect(d.storage.delete).toHaveBeenCalledWith('tenants/t/payments/x.pdf')
    expect(d.eventBus.publish).not.toHaveBeenCalled()
  })

  it('si además falla el borrado del comprobante, igual sale el error original', async () => {
    const d = build()
    d.recalculator.recalculate.mockRejectedValue(new Error('se cayó'))
    d.storage.delete.mockRejectedValue(new Error('storage caído'))
    await expect(
      inUserContext(() =>
        registerHandler(d).execute(
          new RegisterPaymentCommand('inst-1', input(), PDF),
        ),
      ),
    ).rejects.toThrow('se cayó')
  })
})

describe('ApplyCreditHandler', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW })
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  function handler(d: Deps) {
    return new ApplyCreditHandler(
      d.references as unknown as BillingReferences,
      d.installments as unknown as InstallmentRepository,
      d.payments as unknown as PaymentRepository,
      d.credits as unknown as RenterCreditRepository,
      d.recalculator as unknown as InstallmentRecalculator,
      d.prisma as unknown as PrismaService,
      d.views as unknown as InstallmentViews,
      d.eventBus as unknown as EventBus,
    )
  }

  it('aplica el saldo disponible hasta donde alcance, sin pasarse de la deuda', async () => {
    const d = build()
    d.credits.listAvailable.mockResolvedValue([
      makeCredit({ id: 'c1', remaining: '40000.00' }),
      makeCredit({ id: 'c2', remaining: '900000.00' }),
    ])
    await inUserContext(() =>
      handler(d).execute(
        new ApplyCreditCommand('inst-1', undefined, undefined),
      ),
    )
    // Hoy 20/10: 10 días de punitorio = 100.000 + 200.000 + 30.000 = 330.000.
    expect(created(d, 0)).toMatchObject({ amount: '40000.00' })
    expect(created(d, 1)).toMatchObject({ amount: '290000.00' })
    expect(d.credits.update).toHaveBeenCalledWith('c2', {
      remaining: '610000.00',
      status: CreditStatus.AVAILABLE,
    })
  })

  it('sin saldo a favor disponible falla', async () => {
    const d = build()
    await expect(
      inUserContext(() =>
        handler(d).execute(
          new ApplyCreditCommand('inst-1', undefined, undefined),
        ),
      ),
    ).rejects.toBeInstanceOf(CreditNotAvailableException)
  })

  it('con la cuota saldada falla', async () => {
    const d = build(makeInstallment({ baseAmount: '0.00' }))
    await expect(
      inUserContext(() =>
        handler(d).execute(
          new ApplyCreditCommand('inst-1', undefined, undefined),
        ),
      ),
    ).rejects.toBeInstanceOf(InstallmentAlreadyPaidException)
  })

  it('no deja aplicar más de lo que se debe', async () => {
    const d = build()
    d.credits.listAvailable.mockResolvedValue([makeCredit()])
    await expect(
      inUserContext(() =>
        handler(d).execute(
          new ApplyCreditCommand('inst-1', undefined, '999999'),
        ),
      ),
    ).rejects.toBeInstanceOf(CreditNotAvailableException)
  })
})

describe('ConfirmPaymentHandler', () => {
  function handler(d: Deps) {
    return new ConfirmPaymentHandler(
      d.payments as unknown as PaymentRepository,
      d.installments as unknown as InstallmentRepository,
      d.views as unknown as InstallmentViews,
      d.eventBus as unknown as EventBus,
    )
  }

  it('confirma un pago informado y avisa a liquidaciones', async () => {
    const d = build()
    const pending = makePayment({
      id: 'p1',
      status: PaymentStatus.PENDING_CONFIRMATION,
    })
    d.payments.findById.mockResolvedValue(pending)
    d.payments.confirm.mockResolvedValue({
      ...pending,
      status: PaymentStatus.CONFIRMED,
    })
    const view = await inUserContext(() =>
      handler(d).execute(new ConfirmPaymentCommand('p1')),
    )
    expect(view.status).toBe(PaymentStatus.CONFIRMED)
    expect(d.eventBus.publish.mock.calls[0][0]).toBeInstanceOf(
      PaymentConfirmedEvent,
    )
  })

  it('un pago inexistente, ya anulado o ya confirmado no se confirma', async () => {
    const d = build()
    d.payments.findById.mockResolvedValueOnce(null)
    await expect(
      inUserContext(() => handler(d).execute(new ConfirmPaymentCommand('x'))),
    ).rejects.toBeInstanceOf(PaymentNotFoundException)

    d.payments.findById.mockResolvedValueOnce(
      makePayment({ status: PaymentStatus.VOIDED }),
    )
    await expect(
      inUserContext(() => handler(d).execute(new ConfirmPaymentCommand('x'))),
    ).rejects.toBeInstanceOf(PaymentAlreadyVoidedException)

    d.payments.findById.mockResolvedValueOnce(makePayment())
    await expect(
      inUserContext(() => handler(d).execute(new ConfirmPaymentCommand('x'))),
    ).rejects.toBeInstanceOf(PaymentAlreadyConfirmedException)
    expect(d.payments.confirm).not.toHaveBeenCalled()
  })

  it('si otro request lo anuló o confirmó entre la lectura y el UPDATE, lo distingue', async () => {
    const d = build()
    const pending = makePayment({ status: PaymentStatus.PENDING_CONFIRMATION })
    d.payments.confirm.mockResolvedValue(null)

    d.payments.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(makePayment({ status: PaymentStatus.VOIDED }))
    await expect(
      inUserContext(() => handler(d).execute(new ConfirmPaymentCommand('x'))),
    ).rejects.toBeInstanceOf(PaymentAlreadyVoidedException)

    d.payments.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(makePayment())
    await expect(
      inUserContext(() => handler(d).execute(new ConfirmPaymentCommand('x'))),
    ).rejects.toBeInstanceOf(PaymentAlreadyConfirmedException)
    expect(d.eventBus.publish).not.toHaveBeenCalled()
  })
})

describe('VoidPaymentHandler', () => {
  function handler(d: Deps) {
    return new VoidPaymentHandler(
      d.payments as unknown as PaymentRepository,
      d.credits as unknown as RenterCreditRepository,
      d.recalculator as unknown as InstallmentRecalculator,
      d.prisma as unknown as PrismaService,
      d.views as unknown as InstallmentViews,
      d.eventBus as unknown as EventBus,
    )
  }

  const voidedOf = (payment: Payment): Payment => ({
    ...payment,
    status: PaymentStatus.VOIDED,
  })

  it('anula el pago, recalcula la cuota y avisa a liquidaciones', async () => {
    const d = build()
    const payment = makePayment({ id: 'p1', rentApplied: '1000.00' })
    d.payments.findById.mockResolvedValue(payment)
    d.payments.void.mockResolvedValue(voidedOf(payment))
    await inUserContext(() =>
      handler(d).execute(new VoidPaymentCommand('p1', '  Error de carga ')),
    )
    expect(d.payments.void).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        voidedById: 'user-1',
        voidReason: 'Error de carga',
      }),
    )
    expect(d.recalculator.recalculate).toHaveBeenCalledWith('inst-1')
    expect(d.eventBus.publish.mock.calls[0][0]).toBeInstanceOf(
      PaymentVoidedEvent,
    )
    expect(d.credits.update).not.toHaveBeenCalled()
  })

  it('anular un pago que generó saldo a favor lo deja anulado con saldo cero', async () => {
    const d = build()
    const payment = makePayment({ id: 'p1', creditGenerated: '5000.00' })
    d.payments.findById.mockResolvedValue(payment)
    d.payments.void.mockResolvedValue(voidedOf(payment))
    d.credits.findByOriginPayment.mockResolvedValue(
      makeCredit({ id: 'cg', amount: '5000.00', remaining: '5000.00' }),
    )
    await inUserContext(() =>
      handler(d).execute(new VoidPaymentCommand('p1', 'motivo')),
    )
    expect(d.credits.update).toHaveBeenCalledWith('cg', {
      remaining: '0.00',
      status: CreditStatus.VOIDED,
    })
  })

  it('si el saldo a favor que generó ya se usó en parte, no se puede anular', async () => {
    const d = build()
    const payment = makePayment({ id: 'p1', creditGenerated: '5000.00' })
    d.payments.findById.mockResolvedValue(payment)
    d.credits.findByOriginPayment.mockResolvedValue(
      makeCredit({ amount: '5000.00', remaining: '4999.99' }),
    )
    await expect(
      inUserContext(() =>
        handler(d).execute(new VoidPaymentCommand('p1', 'motivo')),
      ),
    ).rejects.toBeInstanceOf(PaymentCreditAlreadyUsedException)
    expect(d.payments.void).not.toHaveBeenCalled()
  })

  it('si el saldo a favor que generó ya se aplicó entero, tampoco', async () => {
    const d = build()
    d.payments.findById.mockResolvedValue(
      makePayment({ creditGenerated: '5000.00' }),
    )
    d.credits.findByOriginPayment.mockResolvedValue(
      makeCredit({
        amount: '5000.00',
        remaining: '0.00',
        status: CreditStatus.APPLIED,
      }),
    )
    await expect(
      inUserContext(() =>
        handler(d).execute(new VoidPaymentCommand('p1', 'motivo')),
      ),
    ).rejects.toBeInstanceOf(PaymentCreditAlreadyUsedException)
  })

  it('anular una aplicación de saldo a favor devuelve el monto al saldo', async () => {
    const d = build()
    const payment = makePayment({
      id: 'p1',
      kind: PaymentKind.CREDIT_APPLICATION,
      creditId: 'credit-a',
      rentApplied: '30000.00',
    })
    d.payments.findById.mockResolvedValue(payment)
    d.payments.void.mockResolvedValue(voidedOf(payment))
    d.credits.findById.mockResolvedValue(
      makeCredit({
        id: 'credit-a',
        remaining: '0.10',
        status: CreditStatus.APPLIED,
      }),
    )
    await inUserContext(() =>
      handler(d).execute(new VoidPaymentCommand('p1', 'motivo')),
    )
    expect(d.credits.update).toHaveBeenCalledWith('credit-a', {
      remaining: '30000.10',
      status: CreditStatus.AVAILABLE,
    })
  })

  it('dos anulaciones simultáneas: la segunda falla sin tocar el crédito', async () => {
    const d = build()
    d.payments.findById.mockResolvedValue(
      makePayment({
        kind: PaymentKind.CREDIT_APPLICATION,
        creditId: 'credit-a',
        rentApplied: '30000.00',
      }),
    )
    d.payments.void.mockResolvedValue(null)
    await expect(
      inUserContext(() =>
        handler(d).execute(new VoidPaymentCommand('p1', 'motivo')),
      ),
    ).rejects.toBeInstanceOf(PaymentAlreadyVoidedException)
    expect(d.credits.update).not.toHaveBeenCalled()
    expect(d.eventBus.publish).not.toHaveBeenCalled()
  })

  it('un pago inexistente o ya anulado no se anula', async () => {
    const d = build()
    d.payments.findById.mockResolvedValueOnce(null)
    await expect(
      inUserContext(() => handler(d).execute(new VoidPaymentCommand('x', 'm'))),
    ).rejects.toBeInstanceOf(PaymentNotFoundException)
    d.payments.findById.mockResolvedValueOnce(
      makePayment({ status: PaymentStatus.VOIDED }),
    )
    await expect(
      inUserContext(() => handler(d).execute(new VoidPaymentCommand('x', 'm'))),
    ).rejects.toBeInstanceOf(PaymentAlreadyVoidedException)
  })
})

describe('RefundCreditHandler', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW })
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  function handler(d: Deps) {
    return new RefundCreditHandler(
      d.credits as unknown as RenterCreditRepository,
    )
  }

  it('devuelve un saldo disponible: queda en cero, con fecha, medio y notas', async () => {
    const d = build()
    d.credits.findById.mockResolvedValue(makeCredit({ id: 'c1' }))
    d.credits.update.mockResolvedValue(
      makeCredit({
        id: 'c1',
        status: CreditStatus.REFUNDED,
        remaining: '0.00',
      }),
    )
    const view = await inUserContext(() =>
      handler(d).execute(
        new RefundCreditCommand(
          'c1',
          '2026-10-18',
          PaymentMethod.CASH,
          '  efectivo   en mostrador ',
        ),
      ),
    )
    expect(d.credits.update).toHaveBeenCalledWith('c1', {
      remaining: '0.00',
      status: CreditStatus.REFUNDED,
      refundedAt: '2026-10-18',
      refundMethod: PaymentMethod.CASH,
      refundedById: 'user-1',
      refundNotes: 'efectivo en mostrador',
    })
    expect(view.status).toBe(CreditStatus.REFUNDED)
  })

  it('no devuelve un saldo ya aplicado, devuelto o anulado', async () => {
    const d = build()
    for (const status of [
      CreditStatus.APPLIED,
      CreditStatus.REFUNDED,
      CreditStatus.VOIDED,
    ]) {
      d.credits.findById.mockResolvedValueOnce(makeCredit({ status }))
      await expect(
        inUserContext(() =>
          handler(d).execute(
            new RefundCreditCommand(
              'c',
              '2026-10-18',
              PaymentMethod.CASH,
              null,
            ),
          ),
        ),
      ).rejects.toBeInstanceOf(CreditNotAvailableException)
    }
    expect(d.credits.update).not.toHaveBeenCalled()
  })

  it('un saldo inexistente falla', async () => {
    const d = build()
    d.credits.findById.mockResolvedValue(null)
    await expect(
      inUserContext(() =>
        handler(d).execute(
          new RefundCreditCommand('c', '2026-10-18', PaymentMethod.CASH, null),
        ),
      ),
    ).rejects.toBeInstanceOf(CreditNotFoundException)
  })

  it('una fecha futura se rechaza nombrando el campo refundedAt', async () => {
    const d = build()
    d.credits.findById.mockResolvedValue(makeCredit())
    await expect(
      inUserContext(() =>
        handler(d).execute(
          new RefundCreditCommand('c', '2026-12-01', PaymentMethod.CASH, null),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'PAYMENT_INVALID_DATE',
      metadata: { field: 'refundedAt' },
    })
  })
})
