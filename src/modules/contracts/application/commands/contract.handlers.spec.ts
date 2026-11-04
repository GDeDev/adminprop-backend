import { EventBus } from '@nestjs/cqrs'

import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  ContractStatus,
  RentUpdateSource,
  RentUpdateType,
} from '../../domain/contract'
import { ContractRepository } from '../../domain/contract.ports'
import { makeContract, makeRentUpdate } from '../../testing/contract.fixtures'
import { ContractViews } from '../contract.views'
import { ContractTerminatedEvent } from '../events/contract-terminated.event'
import { RentUpdateApplier } from '../rent-update-applier'
import {
  ApplyRentUpdateCommand,
  TerminateContractCommand,
} from './contract.commands'
import {
  ApplyRentUpdateHandler,
  TerminateContractHandler,
} from './contract.handlers'

describe('TerminateContractHandler (rescisión anticipada, RN-09)', () => {
  function setup(contract = makeContract()) {
    const contracts = {
      findById: jest.fn().mockResolvedValue(contract),
      terminate: jest
        .fn()
        .mockResolvedValue(makeContract({ status: ContractStatus.TERMINATED })),
    }
    const properties = {
      detachContract: jest.fn().mockResolvedValue(undefined),
    }
    const renters = { detachContract: jest.fn().mockResolvedValue(undefined) }
    const prisma = {
      transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
    }
    const views = { detail: jest.fn().mockResolvedValue({ id: 'detail' }) }
    const eventBus = { publish: jest.fn() }
    const handler = new TerminateContractHandler(
      contracts as unknown as ContractRepository,
      properties as unknown as PropertiesFacade,
      renters as unknown as RentersFacade,
      prisma as unknown as PrismaService,
      views as unknown as ContractViews,
      eventBus as unknown as EventBus,
    )
    return { handler, contracts, properties, renters, prisma, views, eventBus }
  }

  it('guarda la multa (10 % del canon futuro), libera propiedad e inquilino y avisa', async () => {
    const { handler, contracts, properties, renters, eventBus } = setup()
    const result = await handler.execute(
      new TerminateContractCommand('contract-1', '2026-12-01'),
    )
    // 12 meses y 30 días de 100.000: canon futuro 1.300.000, multa 130.000.
    expect(contracts.terminate).toHaveBeenCalledWith('contract-1', {
      terminatedAt: '2026-12-01',
      notifiedAt: '2026-12-01',
      penalty: '130000.00',
      futureRent: '1300000.00',
    })
    expect(properties.detachContract).toHaveBeenCalledWith('property-1')
    expect(renters.detachContract).toHaveBeenCalledWith('renter-1')
    expect(eventBus.publish).toHaveBeenCalledWith(
      new ContractTerminatedEvent(
        'contract-1',
        '2026-12-01',
        '130000.00',
        '1300000.00',
      ),
    )
    expect(result).toMatchObject({
      penalty: '130000.00',
      futureRent: '1300000.00',
      remainingMonths: 12,
      remainingDays: 30,
    })
  })

  it('calcula la multa sobre el alquiler vigente, no el inicial', async () => {
    const { handler, contracts } = setup(
      makeContract({
        rentUpdates: [
          makeRentUpdate({
            id: 'ru-2',
            effectiveFrom: '2026-07-01',
            newRent: '150000.00',
          }),
          makeRentUpdate(),
        ],
      }),
    )
    await handler.execute(
      new TerminateContractCommand('contract-1', '2027-12-30'),
    )
    // Queda un día: 150.000 / 30 = 5.000; multa 10 % = 500.
    expect(contracts.terminate).toHaveBeenCalledWith(
      'contract-1',
      expect.objectContaining({ futureRent: '5000.00', penalty: '500.00' }),
    )
  })

  it('si la transacción falla no avisa', async () => {
    const { handler, contracts, eventBus } = setup()
    contracts.terminate.mockRejectedValue(new Error('base caída'))
    await expect(
      handler.execute(new TerminateContractCommand('contract-1', '2026-12-01')),
    ).rejects.toThrow('base caída')
    expect(eventBus.publish).not.toHaveBeenCalled()
  })

  it.each([
    ['antes del inicio', '2025-12-31'],
    ['el último día', '2027-12-31'],
    ['después del fin', '2028-01-15'],
  ])('una notificación %s se rechaza sin tocar nada', async (_name, date) => {
    const { handler, contracts, properties } = setup()
    await expect(
      handler.execute(new TerminateContractCommand('contract-1', date)),
    ).rejects.toMatchObject({ code: 'CONTRACT_TERMINATION_DATE_INVALID' })
    expect(contracts.terminate).not.toHaveBeenCalled()
    expect(properties.detachContract).not.toHaveBeenCalled()
  })

  it('un contrato que no está activo no se rescinde', async () => {
    const { handler } = setup(makeContract({ status: ContractStatus.FINISHED }))
    await expect(
      handler.execute(new TerminateContractCommand('contract-1', '2026-12-01')),
    ).rejects.toMatchObject({ code: 'CONTRACT_NOT_ACTIVE' })
  })

  it('un contrato inexistente se informa como tal', async () => {
    const { handler, contracts } = setup()
    contracts.findById.mockResolvedValue(null)
    await expect(
      handler.execute(new TerminateContractCommand('nada', '2026-12-01')),
    ).rejects.toMatchObject({ code: 'CONTRACT_NOT_FOUND' })
  })
})

describe('ApplyRentUpdateHandler', () => {
  // Hoy: 15 de abril de 2026; el próximo aumento trimestral cae el 1/4.
  beforeAll(() => {
    jest.useFakeTimers({ now: new Date('2026-04-15T15:00:00.000Z') })
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  function setup(contract = makeContract()) {
    const contracts = { findById: jest.fn().mockResolvedValue(contract) }
    const updated = makeContract({ id: 'updated' })
    const applier = {
      applyIndex: jest.fn().mockResolvedValue(updated),
      applyFixedPercentage: jest.fn().mockResolvedValue(updated),
      record: jest.fn().mockResolvedValue(updated),
    }
    const views = { detail: jest.fn().mockResolvedValue({ id: 'detail' }) }
    const handler = new ApplyRentUpdateHandler(
      contracts as unknown as ContractRepository,
      applier as unknown as RentUpdateApplier,
      views as unknown as ContractViews,
    )
    return { handler, contracts, applier, views }
  }

  it('con índice y sin monto manda el índice', async () => {
    const { handler, applier, views } = setup()
    await handler.execute(new ApplyRentUpdateCommand('contract-1', undefined))
    expect(applier.applyIndex).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'contract-1' }),
      '2026-04-01',
    )
    expect(applier.record).not.toHaveBeenCalled()
    expect(views.detail).toHaveBeenCalled()
  })

  it('con índice y monto, es un ajuste manual autorizado y queda como MANUAL', async () => {
    const { handler, applier } = setup()
    await handler.execute(
      new ApplyRentUpdateCommand('contract-1', '123456.789'),
    )
    expect(applier.applyIndex).not.toHaveBeenCalled()
    expect(applier.record).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'contract-1' }),
      expect.objectContaining({
        effectiveFrom: '2026-04-01',
        newRent: '123456.79',
        source: RentUpdateSource.MANUAL,
        fixedPercentage: null,
      }),
    )
  })

  it('con porcentaje fijo y sin monto lo calcula solo', async () => {
    const { handler, applier } = setup(
      makeContract({
        rentUpdateType: RentUpdateType.FIXED,
        fixedIncreasePercentage: '8.00',
      }),
    )
    await handler.execute(new ApplyRentUpdateCommand('contract-1', undefined))
    expect(applier.applyFixedPercentage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'contract-1' }),
      '2026-04-01',
      '8.00',
    )
  })

  it('un contrato "otro" sin monto se rechaza: hace falta el nuevo alquiler', async () => {
    const { handler, applier } = setup(
      makeContract({ rentUpdateType: RentUpdateType.OTHER }),
    )
    await expect(
      handler.execute(new ApplyRentUpdateCommand('contract-1', undefined)),
    ).rejects.toMatchObject({ code: 'CONTRACT_NEW_RENT_REQUIRED' })
    expect(applier.record).not.toHaveBeenCalled()
  })

  it('no adelanta aumentos: antes de la fecha se rechaza (D-60)', async () => {
    const { handler, applier } = setup(
      makeContract({
        rentUpdates: [makeRentUpdate({ effectiveFrom: '2026-02-01' })],
      }),
    )
    await expect(
      handler.execute(new ApplyRentUpdateCommand('contract-1', '999999')),
    ).rejects.toMatchObject({
      code: 'CONTRACT_RENT_UPDATE_NOT_DUE',
      metadata: { nextUpdateOn: '2026-05-01' },
    })
    expect(applier.record).not.toHaveBeenCalled()
  })

  it('si el próximo aumento cae después del fin del contrato, no quedan aumentos', async () => {
    const { handler } = setup(makeContract({ endDate: '2026-03-31' }))
    await expect(
      handler.execute(new ApplyRentUpdateCommand('contract-1', undefined)),
    ).rejects.toMatchObject({
      code: 'CONTRACT_RENT_UPDATE_NOT_DUE',
      metadata: { nextUpdateOn: null },
    })
  })

  it('un contrato que no está activo no se actualiza', async () => {
    const { handler } = setup(
      makeContract({ status: ContractStatus.TERMINATED }),
    )
    await expect(
      handler.execute(new ApplyRentUpdateCommand('contract-1', undefined)),
    ).rejects.toMatchObject({ code: 'CONTRACT_NOT_ACTIVE' })
  })
})
