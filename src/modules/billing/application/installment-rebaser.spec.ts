import { ContractsFacade } from '@/modules/contracts/public'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { RequestContext } from '@/shared/context/request-context'
import { InstallmentStatus } from '../domain/billing'
import { InstallmentRepository } from '../domain/billing.ports'
import { makeInstallment, makePayment } from '../testing/billing.fixtures'
import { InstallmentRebaser } from './installment-rebaser'

// Historial del alquiler, del más nuevo al más viejo.
const history = [
  { effectiveFrom: '2026-11-01', newRent: '220000.00' },
  { effectiveFrom: '2026-09-01', newRent: '200000.00' },
]

function setup(
  installments = [
    makeInstallment({ id: 'oct', period: '2026-10' }),
    makeInstallment({ id: 'nov', period: '2026-11' }),
  ],
  rentHistory: typeof history | null = history,
) {
  const repo = {
    listAll: jest.fn().mockResolvedValue(installments),
    update: jest.fn().mockResolvedValue(undefined),
  }
  const contracts = { rentHistory: jest.fn().mockResolvedValue(rentHistory) }
  const notifications = { notifyStaff: jest.fn().mockResolvedValue(undefined) }
  const rebaser = new InstallmentRebaser(
    repo as unknown as InstallmentRepository,
    contracts as unknown as ContractsFacade,
    notifications as unknown as NotificationsService,
  )
  return { rebaser, repo, contracts, notifications }
}

describe('InstallmentRebaser', () => {
  describe('firstAffectedPeriod', () => {
    it('si el aumento rige desde el 1, alcanza ese mes', () => {
      expect(InstallmentRebaser.firstAffectedPeriod('2026-11-01')).toBe(
        '2026-11',
      )
    })

    it('si rige a mitad de mes, la cuota de ese mes ya salió entera: empieza el siguiente', () => {
      expect(InstallmentRebaser.firstAffectedPeriod('2026-11-15')).toBe(
        '2026-12',
      )
      expect(InstallmentRebaser.firstAffectedPeriod('2026-12-02')).toBe(
        '2027-01',
      )
    })
  })

  describe('rebase', () => {
    it('corrige la base de la cuota pendiente sin pagos al alquiler vigente el día 1', async () => {
      const { rebaser, repo } = setup()
      const result = await rebaser.rebase('contract-1', '2026-11-01')
      expect(repo.update).toHaveBeenCalledTimes(1)
      expect(repo.update).toHaveBeenCalledWith('nov', {
        baseAmount: '220000.00',
      })
      expect(result.rebased).toEqual([
        {
          id: 'nov',
          period: '2026-11',
          previousBase: '200000.00',
          newBase: '220000.00',
        },
      ])
      expect(result.outdated).toEqual([])
    })

    it('no toca las cuotas anteriores al aumento', async () => {
      const { rebaser, repo } = setup([
        makeInstallment({ id: 'oct', period: '2026-10' }),
      ])
      const result = await rebaser.rebase('contract-1', '2026-11-01')
      expect(repo.update).not.toHaveBeenCalled()
      expect(result.rebased).toEqual([])
    })

    it('las cuotas con pagos no se corrigen: se informan como desactualizadas', async () => {
      const conPago = makeInstallment({
        id: 'nov',
        period: '2026-11',
        status: InstallmentStatus.PARTIAL,
        payments: [makePayment({ rentApplied: '10000.00' })],
      })
      const { rebaser, repo } = setup([conPago])
      const result = await rebaser.rebase('contract-1', '2026-11-01')
      expect(repo.update).not.toHaveBeenCalled()
      expect(result.outdated).toEqual([
        {
          id: 'nov',
          period: '2026-11',
          previousBase: '200000.00',
          newBase: '220000.00',
        },
      ])
    })

    it('es idempotente: si la base ya es la vigente no hace nada', async () => {
      const { rebaser, repo } = setup([
        makeInstallment({
          id: 'nov',
          period: '2026-11',
          baseAmount: '220000.00',
        }),
      ])
      const result = await rebaser.rebase('contract-1', '2026-11-01')
      expect(repo.update).not.toHaveBeenCalled()
      expect(result).toEqual({
        contractId: 'contract-1',
        rebased: [],
        outdated: [],
      })
    })

    it('compara los montos como decimales, no como texto', async () => {
      const { rebaser, repo } = setup([
        makeInstallment({
          id: 'nov',
          period: '2026-11',
          baseAmount: '220000',
        }),
      ])
      await rebaser.rebase('contract-1', '2026-11-01')
      expect(repo.update).not.toHaveBeenCalled()
    })

    it('un aumento a mitad de mes se aplica recién a la cuota siguiente, con el alquiler que regía el día 1', async () => {
      const { rebaser, repo } = setup(
        [
          makeInstallment({ id: 'nov', period: '2026-11' }),
          makeInstallment({ id: 'dic', period: '2026-12' }),
        ],
        [
          { effectiveFrom: '2026-11-15', newRent: '230000.00' },
          ...history.slice(1),
        ],
      )
      await rebaser.rebase('contract-1', '2026-11-15')
      expect(repo.update).toHaveBeenCalledTimes(1)
      expect(repo.update).toHaveBeenCalledWith('dic', {
        baseAmount: '230000.00',
      })
    })

    it('dos aumentos seguidos dan lo mismo sin importar cuál evento llegue primero', async () => {
      const twoRaises = [
        { effectiveFrom: '2026-12-01', newRent: '250000.00' },
        { effectiveFrom: '2026-11-01', newRent: '220000.00' },
        { effectiveFrom: '2026-09-01', newRent: '200000.00' },
      ]
      const installments = () => [
        makeInstallment({ id: 'nov', period: '2026-11' }),
        makeInstallment({ id: 'dic', period: '2026-12' }),
      ]
      const first = setup(installments(), twoRaises)
      await first.rebaser.rebase('contract-1', '2026-11-01')
      const second = setup(installments(), twoRaises)
      await second.rebaser.rebase('contract-1', '2026-12-01')
      const bases = (repo: { update: jest.Mock }) =>
        Object.fromEntries(
          repo.update.mock.calls.map(([id, changes]) => [id, changes]),
        )
      expect(bases(first.repo)).toEqual({
        nov: { baseAmount: '220000.00' },
        dic: { baseAmount: '250000.00' },
      })
      // El segundo evento sólo alcanza diciembre, pero con la misma base.
      expect(bases(second.repo)).toEqual({
        dic: { baseAmount: '250000.00' },
      })
    })

    it('si el contrato no existe no hay nada que corregir', async () => {
      const { rebaser, repo } = setup(undefined, null)
      const result = await rebaser.rebase('contract-1', '2026-11-01')
      expect(result).toEqual({
        contractId: 'contract-1',
        rebased: [],
        outdated: [],
      })
      expect(repo.listAll).not.toHaveBeenCalled()
    })

    it('si el historial no llega al mes de la cuota, la deja como está', async () => {
      const { rebaser, repo } = setup(
        [makeInstallment({ id: 'ant', period: '2026-08' })],
        [{ effectiveFrom: '2026-09-01', newRent: '200000.00' }],
      )
      await rebaser.rebase('contract-1', '2026-08-01')
      expect(repo.update).not.toHaveBeenCalled()
    })
  })

  describe('handle', () => {
    const pagada = makeInstallment({
      id: 'nov',
      period: '2026-11',
      status: InstallmentStatus.PARTIAL,
      payments: [makePayment({ rentApplied: '10000.00' })],
    })

    it('avisa al personal una vez por cada cuota desactualizada', async () => {
      const { rebaser, notifications } = setup([pagada])
      await RequestContext.run(
        { correlationId: 'c', tenantId: 'tenant-1' },
        () =>
          rebaser.handle({
            contractId: 'contract-1',
            effectiveFrom: '2026-11-01',
          }),
      )
      expect(notifications.notifyStaff).toHaveBeenCalledTimes(1)
      expect(notifications.notifyStaff).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          type: 'INSTALLMENT_BASE_OUTDATED',
          dedupeKey: 'INSTALLMENT_BASE_OUTDATED:nov:220000.00',
          entity: { type: 'INSTALLMENT', id: 'nov' },
          link: '/contratos/contract-1',
        }),
      )
      const [{ body }] = notifications.notifyStaff.mock.calls[0]
      expect(body).toContain('base 200000.00')
      expect(body).toContain('220000.00')
    })

    it('sin tenant en el contexto corrige igual pero no avisa', async () => {
      const { rebaser, notifications } = setup([pagada])
      const result = await rebaser.handle({
        contractId: 'contract-1',
        effectiveFrom: '2026-11-01',
      })
      expect(result.outdated).toHaveLength(1)
      expect(notifications.notifyStaff).not.toHaveBeenCalled()
    })
  })
})
