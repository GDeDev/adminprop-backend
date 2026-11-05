import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  ContractStatus,
  RentUpdateFrequency,
  RentUpdateType,
} from '../domain/contract'
import { IndexMissingException } from '../domain/contract.exceptions'
import { ContractRepository } from '../domain/contract.ports'
import { makeContract, makeRentUpdate } from '../testing/contract.fixtures'
import { ContractLifecycle } from './contract-lifecycle'
import { RentUpdateApplier } from './rent-update-applier'

function setup() {
  const contracts = {
    listActive: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    setStatus: jest.fn().mockResolvedValue(undefined),
  }
  const properties = { detachContract: jest.fn().mockResolvedValue(undefined) }
  const renters = { detachContract: jest.fn().mockResolvedValue(undefined) }
  const prisma = {
    transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  }
  const applier = {
    applyIndex: jest.fn(),
    applyFixedPercentage: jest.fn(),
  }
  const lifecycle = new ContractLifecycle(
    contracts as unknown as ContractRepository,
    properties as unknown as PropertiesFacade,
    renters as unknown as RentersFacade,
    prisma as unknown as PrismaService,
    applier as unknown as RentUpdateApplier,
  )
  return { lifecycle, contracts, properties, renters, prisma, applier }
}

/** Ajuste trimestral: el último rige desde el 1/1, el próximo toca el 1/4. */
const quarterly = (overrides = {}) => makeContract(overrides)

describe('ContractLifecycle', () => {
  describe('listDueForRentUpdate', () => {
    it('lista los activos cuyo próximo aumento ya llegó y cae antes del fin', async () => {
      const { lifecycle, contracts } = setup()
      contracts.listActive.mockResolvedValue([
        quarterly({ id: 'due' }),
        // Último aumento el 1/2: el próximo toca el 1/5.
        quarterly({
          id: 'not-yet',
          rentUpdates: [makeRentUpdate({ effectiveFrom: '2026-02-01' })],
        }),
        // El aumento caería después del fin: no corresponde.
        quarterly({ id: 'after-end', endDate: '2026-03-31' }),
      ])
      await expect(
        lifecycle.listDueForRentUpdate('2026-04-01'),
      ).resolves.toEqual(['due'])
    })

    it('el día anterior todavía no corresponde', async () => {
      const { lifecycle, contracts } = setup()
      contracts.listActive.mockResolvedValue([quarterly()])
      await expect(
        lifecycle.listDueForRentUpdate('2026-03-31'),
      ).resolves.toEqual([])
    })
  })

  describe('applyDueRentUpdate', () => {
    it('un contrato inexistente o no activo no tiene aumento pendiente', async () => {
      const { lifecycle, contracts } = setup()
      contracts.findById.mockResolvedValueOnce(null)
      await expect(
        lifecycle.applyDueRentUpdate('x', '2026-04-01'),
      ).resolves.toEqual({ status: 'NOT_DUE', contractId: 'x' })
      contracts.findById.mockResolvedValueOnce(
        quarterly({ status: ContractStatus.TERMINATED }),
      )
      await expect(
        lifecycle.applyDueRentUpdate('contract-1', '2026-04-01'),
      ).resolves.toEqual({ status: 'NOT_DUE', contractId: 'contract-1' })
    })

    it('antes de la fecha del aumento, o con el aumento después del fin, no hace nada', async () => {
      const { lifecycle, contracts, applier } = setup()
      contracts.findById.mockResolvedValueOnce(quarterly())
      await expect(
        lifecycle.applyDueRentUpdate('contract-1', '2026-03-31'),
      ).resolves.toMatchObject({ status: 'NOT_DUE' })
      contracts.findById.mockResolvedValueOnce(
        quarterly({ endDate: '2026-03-31' }),
      )
      await expect(
        lifecycle.applyDueRentUpdate('contract-1', '2026-04-01'),
      ).resolves.toMatchObject({ status: 'NOT_DUE' })
      expect(applier.applyIndex).not.toHaveBeenCalled()
    })

    it('con índice aplica el aumento sin autor (lo hizo el sistema)', async () => {
      const { lifecycle, contracts, applier } = setup()
      const contract = quarterly()
      contracts.findById.mockResolvedValue(contract)
      applier.applyIndex.mockResolvedValue(
        quarterly({
          rentUpdates: [
            makeRentUpdate({ id: 'ru-2', newRent: '110500.00' }),
            makeRentUpdate(),
          ],
        }),
      )
      await expect(
        lifecycle.applyDueRentUpdate('contract-1', '2026-04-15'),
      ).resolves.toEqual({
        status: 'APPLIED',
        contractId: 'contract-1',
        effectiveFrom: '2026-04-01',
        previousRent: '100000.00',
        newRent: '110500.00',
        source: 'INDEX',
      })
      expect(applier.applyIndex).toHaveBeenCalledWith(
        contract,
        '2026-04-01',
        null,
      )
    })

    it('si falta el índice pide intervención manual y dice qué mes falta', async () => {
      const { lifecycle, contracts, applier } = setup()
      contracts.findById.mockResolvedValue(quarterly())
      applier.applyIndex.mockRejectedValue(
        new IndexMissingException('ICL', '2026-04'),
      )
      await expect(
        lifecycle.applyDueRentUpdate('contract-1', '2026-04-01'),
      ).resolves.toEqual({
        status: 'MANUAL_REQUIRED',
        contractId: 'contract-1',
        effectiveFrom: '2026-04-01',
        reason: 'MISSING_INDEX',
        rentUpdateType: RentUpdateType.ICL,
        missingPeriod: '2026-04',
      })
    })

    it('cualquier otro error al aplicar el índice se propaga', async () => {
      const { lifecycle, contracts, applier } = setup()
      contracts.findById.mockResolvedValue(quarterly())
      applier.applyIndex.mockRejectedValue(new Error('base caída'))
      await expect(
        lifecycle.applyDueRentUpdate('contract-1', '2026-04-01'),
      ).rejects.toThrow('base caída')
    })

    it('con porcentaje fijo lo aplica solo', async () => {
      const { lifecycle, contracts, applier } = setup()
      const contract = quarterly({
        rentUpdateType: RentUpdateType.FIXED,
        fixedIncreasePercentage: '10.00',
      })
      contracts.findById.mockResolvedValue(contract)
      applier.applyFixedPercentage.mockResolvedValue(
        quarterly({
          rentUpdates: [
            makeRentUpdate({ id: 'ru-2', newRent: '110000.00' }),
            makeRentUpdate(),
          ],
        }),
      )
      await expect(
        lifecycle.applyDueRentUpdate('contract-1', '2026-04-01'),
      ).resolves.toMatchObject({
        status: 'APPLIED',
        source: 'FIXED_PERCENTAGE',
        previousRent: '100000.00',
        newRent: '110000.00',
      })
      expect(applier.applyFixedPercentage).toHaveBeenCalledWith(
        contract,
        '2026-04-01',
        '10.00',
        null,
      )
    })

    it('fijo sin porcentaje, u otro tipo, requiere monto a mano', async () => {
      const { lifecycle, contracts, applier } = setup()
      for (const rentUpdateType of [
        RentUpdateType.FIXED,
        RentUpdateType.OTHER,
      ]) {
        contracts.findById.mockResolvedValueOnce(
          quarterly({ rentUpdateType, fixedIncreasePercentage: null }),
        )
        await expect(
          lifecycle.applyDueRentUpdate('contract-1', '2026-04-01'),
        ).resolves.toEqual({
          status: 'MANUAL_REQUIRED',
          contractId: 'contract-1',
          effectiveFrom: '2026-04-01',
          reason: 'MANUAL_AMOUNT',
          rentUpdateType,
          missingPeriod: null,
        })
      }
      expect(applier.applyFixedPercentage).not.toHaveBeenCalled()
    })

    it('aplica un solo aumento por llamada aunque haya varios atrasados', async () => {
      const { lifecycle, contracts, applier } = setup()
      contracts.findById.mockResolvedValue(
        quarterly({ rentUpdateFrequency: RentUpdateFrequency.MONTHLY }),
      )
      applier.applyIndex.mockResolvedValue(quarterly())
      await lifecycle.applyDueRentUpdate('contract-1', '2026-06-30')
      expect(applier.applyIndex).toHaveBeenCalledTimes(1)
      expect(applier.applyIndex.mock.calls[0][1]).toBe('2026-02-01')
    })
  })

  describe('listExpiringWithin', () => {
    it('incluye hoy y el límite, excluye vencidos y lejanos, y ordena por urgencia', async () => {
      const { lifecycle, contracts } = setup()
      contracts.listActive.mockResolvedValue([
        quarterly({ id: 'thirty', endDate: '2026-05-31' }),
        quarterly({ id: 'today', endDate: '2026-05-01' }),
        quarterly({ id: 'yesterday', endDate: '2026-04-30' }),
        quarterly({ id: 'far', endDate: '2026-06-01' }),
        quarterly({ id: 'ten', endDate: '2026-05-11' }),
      ])
      const result = await lifecycle.listExpiringWithin(30, '2026-05-01')
      expect(result.map((c) => [c.id, c.daysLeft])).toEqual([
        ['today', 0],
        ['ten', 10],
        ['thirty', 30],
      ])
    })
  })

  describe('listWithSurety e indexTypesInUse', () => {
    it('sólo devuelve los contratos con caución', async () => {
      const { lifecycle, contracts } = setup()
      const withSurety = quarterly({
        id: 'with',
        surety: {
          hasSurety: true,
          insurerName: 'Aseguradora',
          insurerAlertEmail: 'a@b.com',
          policyNumber: '123',
          policyExpiresAt: '2026-12-31',
          policyPdfKey: null,
          policyPdfUrl: null,
        },
      })
      contracts.listActive.mockResolvedValue([quarterly(), withSurety])
      await expect(lifecycle.listWithSurety()).resolves.toEqual([
        expect.objectContaining({
          id: 'with',
          insurerName: 'Aseguradora',
          policyExpiresAt: '2026-12-31',
        }),
      ])
    })

    it('informa cada índice en uso una sola vez', async () => {
      const { lifecycle, contracts } = setup()
      contracts.listActive.mockResolvedValue([
        quarterly({ rentUpdateType: RentUpdateType.ICL }),
        quarterly({ rentUpdateType: RentUpdateType.ICL }),
        quarterly({ rentUpdateType: RentUpdateType.FIXED }),
      ])
      await expect(lifecycle.indexTypesInUse()).resolves.toEqual(['ICL'])
      contracts.listActive.mockResolvedValue([
        quarterly({ rentUpdateType: RentUpdateType.IPC }),
        quarterly({ rentUpdateType: RentUpdateType.ICL }),
      ])
      await expect(lifecycle.indexTypesInUse()).resolves.toEqual(['IPC', 'ICL'])
    })
  })

  describe('finishExpired', () => {
    it('finaliza los vencidos y libera propiedad e inquilino, cada uno en su transacción', async () => {
      const { lifecycle, contracts, properties, renters, prisma } = setup()
      contracts.listActive.mockResolvedValue([
        quarterly({ id: 'a', propertyId: 'pa', renterId: 'ra' }),
        quarterly({ id: 'b', propertyId: 'pb', renterId: 'rb' }),
      ])
      await expect(lifecycle.finishExpired('2028-01-01')).resolves.toBe(2)
      expect(contracts.listActive).toHaveBeenCalledWith({
        endingBefore: '2028-01-01',
      })
      expect(prisma.transaction).toHaveBeenCalledTimes(2)
      expect(contracts.setStatus).toHaveBeenCalledWith(
        'a',
        ContractStatus.FINISHED,
      )
      expect(properties.detachContract).toHaveBeenCalledWith('pb')
      expect(renters.detachContract).toHaveBeenCalledWith('rb')
    })

    it('es idempotente: sin vencidos no hace nada', async () => {
      const { lifecycle, contracts, prisma } = setup()
      await expect(lifecycle.finishExpired('2028-01-01')).resolves.toBe(0)
      expect(prisma.transaction).not.toHaveBeenCalled()
      expect(contracts.setStatus).not.toHaveBeenCalled()
    })
  })
})
