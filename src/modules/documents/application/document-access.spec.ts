import { Role } from '@/modules/auth/public'
import { DocumentKind } from '../domain/document'
import { DocumentAccess } from './document-access'

describe('DocumentAccess: propietario', () => {
  function build(visible: boolean) {
    const settlements = {
      isSettlementVisibleToOwner: jest.fn().mockResolvedValue(visible),
      isStatementVisibleToOwner: jest.fn().mockResolvedValue(visible),
    }
    const owners = { idForPortalUser: jest.fn().mockResolvedValue('own-1') }
    const access = new DocumentAccess(
      settlements as never,
      {} as never,
      {} as never,
      owners as never,
      {} as never,
    )
    return { access, settlements }
  }
  const owner = { id: 'user-1', role: Role.OWNER }

  // Antes alcanzaba con que la liquidación fuera suya: un borrador se bajaba
  // por /documents aunque el portal no lo mostrara.
  it('usa la misma regla que el portal para liquidaciones y consolidados', async () => {
    const { access, settlements } = build(false)
    await expect(
      access.canRead(owner, DocumentKind.SETTLEMENT, 's-1'),
    ).resolves.toBe(false)
    await expect(
      access.canRead(owner, DocumentKind.OWNER_STATEMENT, 'st-1'),
    ).resolves.toBe(false)
    expect(settlements.isSettlementVisibleToOwner).toHaveBeenCalledWith(
      's-1',
      'own-1',
    )
    expect(settlements.isStatementVisibleToOwner).toHaveBeenCalledWith(
      'st-1',
      'own-1',
    )
  })

  it('deja bajar lo que el portal muestra', async () => {
    const { access } = build(true)
    await expect(
      access.canRead(owner, DocumentKind.SETTLEMENT, 's-1'),
    ).resolves.toBe(true)
  })
})
