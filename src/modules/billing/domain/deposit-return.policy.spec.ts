import { Currency, DepositDeductionConcept, DepositReturnMode } from './billing'
import {
  DepositDeductionsExceedReferenceException,
  DepositReturnContractActiveException,
  DepositReturnUnbalancedException,
  InvalidDepositDeductionException,
  InvalidDepositReferenceException,
  InvalidDepositReturnDateException,
} from './billing.exceptions'
import { DepositReturnPolicy } from './deposit-return.policy'

const contract = {
  id: 'c1',
  status: 'ACTIVE',
  endDate: '2026-12-31',
  deposit: '100000.00',
  depositCurrency: Currency.ARS,
  depositReturnMode: DepositReturnMode.FIXED,
  currency: Currency.ARS,
  currentRent: '130000.00',
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

    it('normaliza el monto devuelto: 0 sí, negativo no', () => {
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

  describe('monto de referencia según el modo (D-226, Micaela #1)', () => {
    // Ejemplo de Micaela: se recibieron 200.000 y el alquiler subió 30 %.
    const raised = {
      ...contract,
      deposit: '200000.00',
      currentRent: '260000.00',
    }

    it('FIXED: lo recibido, aunque el alquiler haya subido; no se actualiza solo', () => {
      expect(DepositReturnPolicy.resolveReference(raised, null)).toEqual({
        mode: DepositReturnMode.FIXED,
        referenceAmount: '200000.00',
      })
    })

    it('FOLLOWS_RENT: el alquiler vigente (último mes), no el depósito recibido', () => {
      const followsRent = {
        ...raised,
        depositReturnMode: DepositReturnMode.FOLLOWS_RENT,
      }
      expect(DepositReturnPolicy.resolveReference(followsRent, null)).toEqual({
        mode: DepositReturnMode.FOLLOWS_RENT,
        referenceAmount: '260000.00',
      })
      expect(
        DepositReturnPolicy.resolveReference(followsRent, '260000'),
      ).toMatchObject({ referenceAmount: '260000.00' })
    })

    it('en un modo automático, un monto distinto del que corresponde es un error', () => {
      expect(() =>
        DepositReturnPolicy.resolveReference(raised, '260000'),
      ).toThrow(InvalidDepositReferenceException)
    })

    it('FOLLOWS_RENT con el alquiler en otra moneda exige indicar el monto (no hay cotización)', () => {
      const usdRent = {
        ...raised,
        depositReturnMode: DepositReturnMode.FOLLOWS_RENT,
        currency: Currency.USD,
      }
      expect(() => DepositReturnPolicy.resolveReference(usdRent, null)).toThrow(
        InvalidDepositReferenceException,
      )
      expect(
        DepositReturnPolicy.resolveReference(usdRent, '250000.00'),
      ).toMatchObject({ referenceAmount: '250000.00' })
    })

    it('MANUAL: el monto es obligatorio y puede ser mayor que lo recibido', () => {
      const manual = { ...raised, depositReturnMode: DepositReturnMode.MANUAL }
      expect(() => DepositReturnPolicy.resolveReference(manual, null)).toThrow(
        InvalidDepositReferenceException,
      )
      expect(() => DepositReturnPolicy.resolveReference(manual, '0')).toThrow(
        InvalidDepositReferenceException,
      )
      expect(DepositReturnPolicy.resolveReference(manual, '310000')).toEqual({
        mode: DepositReturnMode.MANUAL,
        referenceAmount: '310000.00',
      })
    })
  })

  describe('settle: las deducciones se descuentan de la referencia', () => {
    it('devuelve referencia menos deducciones, también cuando supera lo recibido', () => {
      expect(
        DepositReturnPolicy.settle('260000.00', [{ amount: '60000.00' }], null),
      ).toBe('200000.00')
      expect(DepositReturnPolicy.settle('260000.00', [], null)).toBe(
        '260000.00',
      )
    })

    it('si se manda lo devuelto tiene que coincidir', () => {
      expect(
        DepositReturnPolicy.settle(
          '100000.00',
          [{ amount: '20000.00' }],
          '80000.00',
        ),
      ).toBe('80000.00')
      expect(() =>
        DepositReturnPolicy.settle(
          '100000.00',
          [{ amount: '10000.00' }],
          '80000.00',
        ),
      ).toThrow(DepositReturnUnbalancedException)
    })

    it('las deducciones no pueden superar la referencia; igual a la referencia devuelve 0', () => {
      expect(() =>
        DepositReturnPolicy.settle(
          '100000.00',
          [{ amount: '100000.01' }],
          null,
        ),
      ).toThrow(DepositDeductionsExceedReferenceException)
      expect(
        DepositReturnPolicy.settle(
          '100000.00',
          [{ amount: '60000.00' }, { amount: '40000.00' }],
          null,
        ),
      ).toBe('0.00')
    })

    it('el motivo de la deducción es obligatorio (deuda, daño u otro)', () => {
      for (const concept of [
        DepositDeductionConcept.DEBT,
        DepositDeductionConcept.DAMAGE,
        DepositDeductionConcept.OTHER,
      ]) {
        expect(() =>
          DepositReturnPolicy.normalizeDeductions([
            { concept, description: '   ', amount: '1', installmentId: null },
          ]),
        ).toThrow(InvalidDepositDeductionException)
      }
    })
  })
})
