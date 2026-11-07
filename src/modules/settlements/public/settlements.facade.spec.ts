import { SettlementStatus, StatementStatus } from '../domain/settlement'
import { SettlementsFacade } from './settlements.facade'

function build() {
  const settlements = {
    listAll: jest.fn(),
    count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(5),
    countByOwner: jest.fn().mockResolvedValue(
      new Map([
        ['own-1', 2],
        ['own-2', 1],
      ]),
    ),
  }
  const statements = {
    listAll: jest.fn(),
    count: jest.fn().mockResolvedValue(4),
  }
  const facade = new SettlementsFacade(
    settlements as never,
    statements as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
  return { facade, settlements, statements }
}

// Antes se hidrataban todas las liquidaciones y consolidados (con sus
// relaciones) sólo para contarlos (B-P2).
describe('SettlementsFacade: conteos en la base', () => {
  it('workload cuenta sin traer filas', async () => {
    const { facade, settlements, statements } = build()
    await expect(facade.workload()).resolves.toEqual({
      toConfirm: 3,
      toTransfer: 5,
      openStatements: 4,
    })
    expect(settlements.count).toHaveBeenCalledWith({
      status: SettlementStatus.PENDING,
    })
    expect(statements.count).toHaveBeenCalledWith({
      status: StatementStatus.OPEN,
    })
    expect(settlements.listAll).not.toHaveBeenCalled()
    expect(statements.listAll).not.toHaveBeenCalled()
  })

  it('ownersPendingStatement agrupa por propietario en la base', async () => {
    const { facade, settlements } = build()
    await expect(facade.ownersPendingStatement('2026-10')).resolves.toEqual([
      { ownerId: 'own-1', settlements: 2 },
      { ownerId: 'own-2', settlements: 1 },
    ])
    expect(settlements.countByOwner).toHaveBeenCalledWith({
      period: '2026-10',
      statuses: [SettlementStatus.CONFIRMED, SettlementStatus.TRANSFERRED],
      statementId: null,
    })
    expect(settlements.listAll).not.toHaveBeenCalled()
  })
})
