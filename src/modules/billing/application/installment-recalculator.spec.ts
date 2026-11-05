import { EventBus } from '@nestjs/cqrs'

import {
  Installment,
  InstallmentStatus,
  PaymentStatus,
} from '../domain/billing'
import { InstallmentRepository } from '../domain/billing.ports'
import { makeInstallment, makePayment } from '../testing/billing.fixtures'
import { InstallmentPaidEvent } from './events/installment-paid.event'
import { InstallmentRecalculator } from './installment-recalculator'

// "Hoy" para el cálculo del saldo: 20 de octubre de 2026 (gracia hasta el 10).
const NOW = new Date('2026-10-20T15:00:00.000Z')

function setup(loaded: Installment) {
  const repo = {
    findById: jest.fn().mockResolvedValue(loaded),
    update: jest.fn().mockResolvedValue(loaded),
    replaceFeeDays: jest.fn().mockResolvedValue(undefined),
  }
  const eventBus = { publish: jest.fn() }
  const recalculator = new InstallmentRecalculator(
    repo as unknown as InstallmentRepository,
    eventBus as unknown as EventBus,
  )
  return { recalculator, repo, eventBus }
}

describe('InstallmentRecalculator', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW })
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  it('sin pagos queda PENDING, sin fecha de saldado y sin tocar el detalle congelado', async () => {
    const { recalculator, repo, eventBus } = setup(makeInstallment())
    await recalculator.recalculate('inst-1')
    expect(repo.update).toHaveBeenCalledWith('inst-1', {
      status: InstallmentStatus.PENDING,
      paidAt: null,
    })
    expect(repo.replaceFeeDays).not.toHaveBeenCalled()
    expect(eventBus.publish).not.toHaveBeenCalled()
  })

  it('con un pago parcial queda PARTIAL', async () => {
    const { recalculator, repo, eventBus } = setup(
      makeInstallment({
        payments: [
          makePayment({ paidAt: '2026-10-05', rentApplied: '50000.00' }),
        ],
      }),
    )
    await recalculator.recalculate('inst-1')
    expect(repo.update).toHaveBeenCalledWith('inst-1', {
      status: InstallmentStatus.PARTIAL,
      paidAt: null,
    })
    expect(eventBus.publish).not.toHaveBeenCalled()
  })

  it('si el alquiler se salda pero el punitorio sigue debiéndose, no pasa a PAID', async () => {
    // Alquiler completo el 15, sin pagar los 50.000 de punitorio.
    const { recalculator, repo, eventBus } = setup(
      makeInstallment({
        payments: [
          makePayment({ paidAt: '2026-10-15', rentApplied: '200000.00' }),
        ],
      }),
    )
    await recalculator.recalculate('inst-1')
    expect(repo.update).toHaveBeenCalledWith('inst-1', {
      status: InstallmentStatus.PARTIAL,
      paidAt: '2026-10-15',
    })
    expect(eventBus.publish).not.toHaveBeenCalled()
  })

  it('al saldarse todo pasa a PAID, congela el punitorio hasta el día del pago y avisa una vez', async () => {
    const { recalculator, repo, eventBus } = setup(
      makeInstallment({
        payments: [
          makePayment({
            paidAt: '2026-10-15',
            rentApplied: '200000.00',
            lateFeeApplied: '50000.00',
          }),
        ],
      }),
    )
    await recalculator.recalculate('inst-1')
    expect(repo.update).toHaveBeenCalledWith('inst-1', {
      status: InstallmentStatus.PAID,
      paidAt: '2026-10-15',
    })
    const [, frozen] = repo.replaceFeeDays.mock.calls[0]
    expect(repo.replaceFeeDays.mock.calls[0][0]).toBe('inst-1')
    // Días 11 a 15: el punitorio deja de correr el día que se salda el alquiler.
    expect(frozen).toHaveLength(5)
    expect(frozen[4]).toMatchObject({ day: '2026-10-15', amount: '10000.00' })
    expect(eventBus.publish).toHaveBeenCalledTimes(1)
    expect(eventBus.publish).toHaveBeenCalledWith(
      new InstallmentPaidEvent('inst-1', 'contract-1', 'owner-1', '2026-10'),
    )
  })

  it('una cuota que ya estaba PAID y sigue igual no vuelve a avisar ni a recongelar', async () => {
    const { recalculator, repo, eventBus } = setup(
      makeInstallment({
        status: InstallmentStatus.PAID,
        paidAt: '2026-10-05',
        payments: [
          makePayment({ paidAt: '2026-10-05', rentApplied: '200000.00' }),
        ],
      }),
    )
    await recalculator.recalculate('inst-1')
    expect(repo.update).toHaveBeenCalledWith('inst-1', {
      status: InstallmentStatus.PAID,
      paidAt: '2026-10-05',
    })
    expect(repo.replaceFeeDays).not.toHaveBeenCalled()
    expect(eventBus.publish).not.toHaveBeenCalled()
  })

  it('al anular el pago que la saldó se reabre: vuelve el cálculo en vivo y no avisa', async () => {
    const { recalculator, repo, eventBus } = setup(
      makeInstallment({
        status: InstallmentStatus.PAID,
        paidAt: '2026-10-05',
        payments: [
          makePayment({
            paidAt: '2026-10-05',
            rentApplied: '200000.00',
            status: PaymentStatus.VOIDED,
          }),
        ],
      }),
    )
    await recalculator.recalculate('inst-1')
    expect(repo.update).toHaveBeenCalledWith('inst-1', {
      status: InstallmentStatus.PENDING,
      paidAt: null,
    })
    expect(repo.replaceFeeDays).toHaveBeenCalledWith('inst-1', [])
    expect(eventBus.publish).not.toHaveBeenCalled()
  })

  it('devuelve la cuota releída, o la actualizada si ya no se encuentra', async () => {
    const loaded = makeInstallment()
    const reloaded = makeInstallment({ notes: 'releída' })
    const { recalculator, repo } = setup(loaded)
    repo.findById.mockResolvedValueOnce(loaded).mockResolvedValueOnce(reloaded)
    await expect(recalculator.recalculate('inst-1')).resolves.toBe(reloaded)

    const updated = makeInstallment({ notes: 'actualizada' })
    repo.findById.mockResolvedValueOnce(loaded).mockResolvedValueOnce(null)
    repo.update.mockResolvedValueOnce(updated)
    await expect(recalculator.recalculate('inst-1')).resolves.toBe(updated)
  })

  it('falla si la cuota desapareció', async () => {
    const { recalculator, repo } = setup(makeInstallment())
    repo.findById.mockReset().mockResolvedValue(null)
    await expect(recalculator.recalculate('nada')).rejects.toThrow(
      'La cuota nada desapareció',
    )
  })
})
