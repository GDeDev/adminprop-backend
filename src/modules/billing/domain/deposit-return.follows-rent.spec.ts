import { Currency, DepositReturnMode } from './billing'
import { DepositReturnPolicy } from './deposit-return.policy'

// Supuesto documentado (D-233), pregunta abierta para Micaela: con FOLLOWS_RENT y
// un depósito menor que el alquiler vigente, la devolución supera lo recibido.
// Este test fija el comportamiento actual; si la respuesta es "topear en lo
// recibido", hay que cambiarlo junto con la regla.
describe('FOLLOWS_RENT con depósito menor que el alquiler (D-233)', () => {
  const contract = {
    id: 'c1',
    status: 'TERMINATED',
    endDate: '2026-12-31',
    deposit: '200000.00',
    depositCurrency: Currency.ARS,
    depositReturnMode: DepositReturnMode.FOLLOWS_RENT,
    currency: Currency.ARS,
    currentRent: '260000.00',
  }

  it('la referencia es el alquiler vigente y se devuelve más de lo recibido', () => {
    const { referenceAmount } = DepositReturnPolicy.resolveReference(
      contract,
      null,
    )
    expect(referenceAmount).toBe('260000.00')
    expect(DepositReturnPolicy.settle(referenceAmount, [], null)).toBe(
      '260000.00',
    )
  })
})
