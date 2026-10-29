import { Currency, DepositDeductionConcept } from './billing'
import {
  DepositReturnContractActiveException,
  DepositReturnUnbalancedException,
  InvalidDepositDeductionException,
  InvalidDepositReturnDateException,
} from './billing.exceptions'
import { DepositReturnPolicy } from './deposit-return.policy'

const contract = {
  id: 'c1',
  status: 'ACTIVE',
  endDate: '2026-12-31',
  deposit: '100000.00',
  depositCurrency: Currency.ARS,
}

describe('DepositReturnPolicy', () => {
  describe('assertReturnable', () => {
    it('rechaza un contrato activo cuyo fin no pasó', () => {
      expect(() =>
        DepositReturnPolicy.assertReturnable(contract, '2026-10-29'),
      ).toThrow(DepositReturnContractActiveException)
    })

    it('acepta finalizado, rescindido o activo ya vencido', () => {
      expect(() =>
        DepositReturnPolicy.assertReturnable(
          { ...contract, status: 'FINISHED' },
          '2026-10-29',
        ),
      ).not.toThrow()
      expect(() =>
        DepositReturnPolicy.assertReturnable(
          { ...contract, status: 'TERMINATED' },
          '2026-10-29',
        ),
      ).not.toThrow()
      expect(() =>
        DepositReturnPolicy.assertReturnable(contract, '2027-01-01'),
      ).not.toThrow()
    })
  })

  describe('normalizeReturnedAt', () => {
    it('acepta una fecha pasada y rechaza futuras o inválidas', () => {
      expect(
        DepositReturnPolicy.normalizeReturnedAt(' 2026-10-20 ', '2026-10-29'),
      ).toBe('2026-10-20')
      expect(() =>
        DepositReturnPolicy.normalizeReturnedAt('2026-10-30', '2026-10-29'),
      ).toThrow(InvalidDepositReturnDateException)
      expect(() =>
        DepositReturnPolicy.normalizeReturnedAt('2026-02-30', '2026-10-29'),
      ).toThrow(InvalidDepositReturnDateException)
    })
  })

  describe('deducciones', () => {
    it('normaliza monto y descripción; sólo DEBT lleva cuota', () => {
      expect(
        DepositReturnPolicy.normalizeDeductions([
          {
            concept: DepositDeductionConcept.DAMAGE,
            description: '  Pintura   living ',
            amount: '1500.5',
            installmentId: null,
          },
        ]),
      ).toEqual([
        {
          concept: 'DAMAGE',
          description: 'Pintura living',
          amount: '1500.50',
          installmentId: null,
        },
      ])
      expect(() =>
        DepositReturnPolicy.normalizeDeductions([
          {
            concept: DepositDeductionConcept.DAMAGE,
            description: 'x',
            amount: '10',
            installmentId: 'i1',
          },
        ]),
      ).toThrow(InvalidDepositDeductionException)
      expect(() =>
        DepositReturnPolicy.normalizeDeductions([
          {
            concept: DepositDeductionConcept.OTHER,
            description: 'x',
            amount: '0',
            installmentId: null,
          },
        ]),
      ).toThrow(InvalidDepositDeductionException)
    })

    it('lo devuelto más las deducciones tiene que ser el depósito', () => {
      expect(() =>
        DepositReturnPolicy.assertBalanced('100000.00', '80000.00', [
          { amount: '20000.00' },
        ]),
      ).not.toThrow()
      expect(() =>
        DepositReturnPolicy.assertBalanced('100000.00', '80000.00', [
          { amount: '10000.00' },
        ]),
      ).toThrow(DepositReturnUnbalancedException)
      expect(DepositReturnPolicy.normalizeReturnedAmount('0')).toBe('0.00')
      expect(() => DepositReturnPolicy.normalizeReturnedAmount('-1')).toThrow(
        InvalidDepositDeductionException,
      )
    })

    it('una deuda imputada a una cuota tiene que ser del contrato, en la misma moneda y no superar la deuda', () => {
      const installment = {
        contractId: 'c1',
        currency: Currency.ARS,
        totalDue: '30000.00',
      }
      expect(() =>
        DepositReturnPolicy.assertDebtFitsInstallment(
          { amount: '30000.00' },
          installment,
          contract,
        ),
      ).not.toThrow()
      expect(() =>
        DepositReturnPolicy.assertDebtFitsInstallment(
          { amount: '30000.01' },
          installment,
          contract,
        ),
      ).toThrow(InvalidDepositDeductionException)
      expect(() =>
        DepositReturnPolicy.assertDebtFitsInstallment(
          { amount: '1.00' },
          { ...installment, contractId: 'otro' },
          contract,
        ),
      ).toThrow(InvalidDepositDeductionException)
      expect(() =>
        DepositReturnPolicy.assertDebtFitsInstallment(
          { amount: '1.00' },
          { ...installment, currency: Currency.USD },
          contract,
        ),
      ).toThrow(InvalidDepositDeductionException)
    })
  })
})
