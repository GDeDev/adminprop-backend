import { EventBus } from '@nestjs/cqrs'

import { IndexType, IndicesFacade } from '@/modules/indices/public'
import { RequestContext } from '@/shared/context/request-context'
import { RentUpdateSource, RentUpdateType } from '../domain/contract'
import { IndexMissingException } from '../domain/contract.exceptions'
import { ContractRepository } from '../domain/contract.ports'
import { makeContract, makeRentUpdate } from '../testing/contract.fixtures'
import { RentUpdateAppliedEvent } from './events/rent-update-applied.event'
import { RentUpdateApplier } from './rent-update-applier'

function setup(indexValues: Record<string, string | null> = {}) {
  const contracts = {
    addRentUpdate: jest
      .fn()
      .mockImplementation(async () => makeContract({ id: 'updated' })),
  }
  const indices = {
    getValue: jest
      .fn()
      .mockImplementation(
        async (_type: IndexType, period: string) => indexValues[period] ?? null,
      ),
  }
  const eventBus = { publish: jest.fn() }
  const applier = new RentUpdateApplier(
    contracts as unknown as ContractRepository,
    indices as unknown as IndicesFacade,
    eventBus as unknown as EventBus,
  )
  return { applier, contracts, indices, eventBus }
}

describe('RentUpdateApplier', () => {
  describe('isIndexed', () => {
    it('sólo ICL e IPC se actualizan solos por índice', () => {
      const of = (rentUpdateType: RentUpdateType) =>
        RentUpdateApplier.isIndexed(makeContract({ rentUpdateType }))
      expect(of(RentUpdateType.ICL)).toBe(true)
      expect(of(RentUpdateType.IPC)).toBe(true)
      expect(of(RentUpdateType.FIXED)).toBe(false)
      expect(of(RentUpdateType.OTHER)).toBe(false)
    })
  })

  describe('record', () => {
    const update = {
      effectiveFrom: '2026-04-01',
      newRent: '120000.00',
      source: RentUpdateSource.MANUAL,
      indexType: null,
      indexFromPeriod: null,
      indexToPeriod: null,
      indexFromValue: null,
      indexToValue: null,
      fixedPercentage: null,
    }

    it('guarda el alquiler anterior y avisa con el evento', async () => {
      const { applier, contracts, eventBus } = setup()
      await applier.record(makeContract(), update, 'admin-1')
      expect(contracts.addRentUpdate).toHaveBeenCalledWith('contract-1', {
        ...update,
        previousRent: '100000.00',
        appliedById: 'admin-1',
      })
      expect(eventBus.publish).toHaveBeenCalledWith(
        new RentUpdateAppliedEvent(
          'contract-1',
          '2026-04-01',
          '100000.00',
          '120000.00',
        ),
      )
    })

    it('el alquiler anterior es el vigente, no el inicial', async () => {
      const { applier, contracts } = setup()
      const contract = makeContract({
        rentUpdates: [
          makeRentUpdate({
            id: 'ru-2',
            effectiveFrom: '2026-04-01',
            newRent: '110000.00',
          }),
          makeRentUpdate(),
        ],
      })
      await applier.record(contract, update, null)
      expect(contracts.addRentUpdate.mock.calls[0][1]).toMatchObject({
        previousRent: '110000.00',
        appliedById: null,
      })
    })

    it('sin autor explícito toma al usuario del contexto', async () => {
      const { applier, contracts } = setup()
      await RequestContext.run({ correlationId: 'c', userId: 'user-7' }, () =>
        applier.record(makeContract(), update),
      )
      expect(contracts.addRentUpdate.mock.calls[0][1].appliedById).toBe(
        'user-7',
      )
    })

    it('fuera de un request (el cron) queda sin autor', async () => {
      const { applier, contracts } = setup()
      await applier.record(makeContract(), update)
      expect(contracts.addRentUpdate.mock.calls[0][1].appliedById).toBeNull()
    })
  })

  describe('applyIndex', () => {
    it('multiplica el alquiler por la variación del índice y deja registrado el cálculo', async () => {
      const { applier, contracts, indices } = setup({
        '2026-01': '100',
        '2026-04': '110.5',
      })
      await applier.applyIndex(makeContract(), '2026-04-01', 'admin-1')
      expect(indices.getValue).toHaveBeenCalledWith(IndexType.ICL, '2026-01')
      expect(indices.getValue).toHaveBeenCalledWith(IndexType.ICL, '2026-04')
      expect(contracts.addRentUpdate).toHaveBeenCalledWith('contract-1', {
        effectiveFrom: '2026-04-01',
        newRent: '110500.00',
        previousRent: '100000.00',
        source: RentUpdateSource.INDEX,
        indexType: IndexType.ICL,
        indexFromPeriod: '2026-01',
        indexToPeriod: '2026-04',
        indexFromValue: '100',
        indexToValue: '110.5',
        fixedPercentage: null,
        appliedById: 'admin-1',
      })
    })

    it('redondea una sola vez, a centavos, con toda la precisión de la razón', async () => {
      const { applier, contracts } = setup({
        '2026-01': '101',
        '2026-04': '103',
      })
      await applier.applyIndex(makeContract(), '2026-04-01', null)
      // 100.000 × 103 / 101 = 101.980,198… → 101.980,20.
      expect(contracts.addRentUpdate.mock.calls[0][1].newRent).toBe('101980.20')
    })

    it('el período de partida es el del último aumento, no el del inicio', async () => {
      const { applier, indices } = setup({
        '2026-04': '110',
        '2026-07': '121',
      })
      const contract = makeContract({
        rentUpdates: [
          makeRentUpdate({
            id: 'ru-2',
            effectiveFrom: '2026-04-01',
            newRent: '110000.00',
          }),
          makeRentUpdate(),
        ],
      })
      await applier.applyIndex(contract, '2026-07-01', null)
      expect(indices.getValue).toHaveBeenCalledWith(IndexType.ICL, '2026-04')
      expect(indices.getValue).toHaveBeenCalledWith(IndexType.ICL, '2026-07')
    })

    it('usa el índice del contrato: IPC si es IPC', async () => {
      const { applier, indices } = setup({ '2026-01': '100', '2026-04': '105' })
      await applier.applyIndex(
        makeContract({ rentUpdateType: RentUpdateType.IPC }),
        '2026-04-01',
        null,
      )
      expect(indices.getValue).toHaveBeenCalledWith(IndexType.IPC, '2026-01')
    })

    it('si falta el valor del mes de partida falla sin guardar ni avisar', async () => {
      const { applier, contracts, eventBus } = setup({ '2026-04': '110' })
      await expect(
        applier.applyIndex(makeContract(), '2026-04-01', null),
      ).rejects.toMatchObject({
        code: 'CONTRACT_INDEX_MISSING',
        metadata: { indexType: IndexType.ICL, period: '2026-01' },
      })
      expect(contracts.addRentUpdate).not.toHaveBeenCalled()
      expect(eventBus.publish).not.toHaveBeenCalled()
    })

    it('si falta el valor del mes nuevo también falla, nombrando ese mes', async () => {
      const { applier } = setup({ '2026-01': '100' })
      const error = await applier
        .applyIndex(makeContract(), '2026-04-01', null)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(IndexMissingException)
      expect((error as IndexMissingException).metadata).toMatchObject({
        period: '2026-04',
      })
    })
  })

  describe('applyFixedPercentage', () => {
    it('aplica el porcentaje al alquiler vigente y lo deja registrado', async () => {
      const { applier, contracts } = setup()
      await applier.applyFixedPercentage(
        makeContract({ rentUpdateType: RentUpdateType.FIXED }),
        '2026-04-01',
        '10.00',
        null,
      )
      expect(contracts.addRentUpdate).toHaveBeenCalledWith('contract-1', {
        effectiveFrom: '2026-04-01',
        newRent: '110000.00',
        previousRent: '100000.00',
        source: RentUpdateSource.MANUAL,
        indexType: null,
        indexFromPeriod: null,
        indexToPeriod: null,
        indexFromValue: null,
        indexToValue: null,
        fixedPercentage: '10.00',
        appliedById: null,
      })
    })

    it('redondea el resultado a centavos', async () => {
      const { applier, contracts } = setup()
      await applier.applyFixedPercentage(
        makeContract({
          rentUpdates: [makeRentUpdate({ newRent: '33333.33' })],
        }),
        '2026-04-01',
        '7.50',
        null,
      )
      // 33.333,33 × 1,075 = 35.833,32975 → 35.833,33.
      expect(contracts.addRentUpdate.mock.calls[0][1].newRent).toBe('35833.33')
    })
  })
})
