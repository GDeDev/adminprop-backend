import {
  BillingTerms,
  CollectionMode,
  ContractStatus,
  FeeMode,
  RentUpdateFrequency,
} from './contract'
import {
  BillingTermsNotAfterLatestException,
  BillingTermsOutOfRangeException,
  ContractDatesInvalidException,
  InvalidBillingTermsException,
  InvalidContractDateException,
  LateFeePercentageRequiredException,
  NewRentRequiredException,
  RenewalStartInvalidException,
  SuretyEmailRequiredException,
  TerminationDateInvalidException,
} from './contract.exceptions'
import { ContractPolicy } from './contract.policy'

const FEES = { standardFeePercentage: '5.00', reducedFeePercentage: '3.00' }

describe('ContractPolicy', () => {
  describe('fechas (spec 3.1)', () => {
    it('acepta fechas del calendario y rechaza las que no existen', () => {
      expect(ContractPolicy.normalizeDate(' 2026-03-01 ', 'startDate')).toBe(
        '2026-03-01',
      )
      expect(() =>
        ContractPolicy.normalizeDate('2026-02-30', 'startDate'),
      ).toThrow(InvalidContractDateException)
    })

    it('el fin tiene que ser posterior al inicio', () => {
      expect(() =>
        ContractPolicy.assertDates('2026-03-01', '2028-02-28'),
      ).not.toThrow()
      expect(() =>
        ContractPolicy.assertDates('2026-03-01', '2026-03-01'),
      ).toThrow(ContractDatesInvalidException)
      expect(() =>
        ContractPolicy.assertDates('2026-03-01', '2026-02-28'),
      ).toThrow(ContractDatesInvalidException)
    })
  })

  it('con caución exige el email de la aseguradora (spec 3.1)', () => {
    expect(() => ContractPolicy.assertSurety(true, null)).toThrow(
      SuretyEmailRequiredException,
    )
    expect(() =>
      ContractPolicy.assertSurety(true, 'alertas@finaer.com'),
    ).not.toThrow()
    expect(() => ContractPolicy.assertSurety(false, null)).not.toThrow()
  })

  it('elige el honorario reducido o el estándar (RN-06, RN-07)', () => {
    expect(ContractPolicy.feePercentage(false, FEES)).toBe('5.00')
    expect(ContractPolicy.feePercentage(true, FEES)).toBe('3.00')
    expect(
      ContractPolicy.feePercentage(true, {
        ...FEES,
        reducedFeePercentage: '2.5',
      }),
    ).toBe('2.50')
  })

  describe('próximo aumento', () => {
    it.each([
      [RentUpdateFrequency.MONTHLY, '2026-02-15'],
      [RentUpdateFrequency.QUARTERLY, '2026-04-15'],
      [RentUpdateFrequency.FOUR_MONTHLY, '2026-05-15'],
      [RentUpdateFrequency.SEMIANNUAL, '2026-07-15'],
      [RentUpdateFrequency.ANNUAL, '2027-01-15'],
    ])('con frecuencia %s, desde el 15/1 cae el %s', (frequency, expected) => {
      expect(ContractPolicy.nextRentUpdateOn('2026-01-15', frequency)).toBe(
        expected,
      )
    })

    it('desde fin de mes se queda en el último día del mes destino', () => {
      expect(
        ContractPolicy.nextRentUpdateOn(
          '2026-01-31',
          RentUpdateFrequency.MONTHLY,
        ),
      ).toBe('2026-02-28')
    })
  })

  describe('aumento por índice (RN-15)', () => {
    it('multiplica por la variación del índice y redondea a centavos una vez', () => {
      // 100.000 × 1.654321 / 1.500000 = 110.288,0666… → 110.288,07
      expect(
        ContractPolicy.indexedRent('100000.00', '1.500000', '1.654321'),
      ).toBe('110288.07')
    })

    it('con el mismo índice el alquiler no cambia', () => {
      expect(ContractPolicy.indexedRent('150333.33', '1500', '1500')).toBe(
        '150333.33',
      )
    })
  })

  describe('aumento por % fijo (Micaela #8)', () => {
    it('aplica el % con un solo redondeo', () => {
      expect(ContractPolicy.fixedIncreaseRent('100000.00', '10')).toBe(
        '110000.00',
      )
      // 150.333,33 × 1,075 = 161.608,32975 → 161.608,33
      expect(ContractPolicy.fixedIncreaseRent('150333.33', '7.5')).toBe(
        '161608.33',
      )
      expect(ContractPolicy.fixedIncreaseRent('100000.00', '0')).toBe(
        '100000.00',
      )
    })
  })

  describe('términos de cobro (D-70)', () => {
    const terms = (
      effectiveFrom: string,
      overrides: Partial<BillingTerms> = {},
    ): BillingTerms => ({
      id: effectiveFrom,
      effectiveFrom,
      collectionMode: CollectionMode.AGENCY,
      feeMode: FeeMode.DEDUCTED,
      feePercentage: '5.00',
      feeAmount: null,
      lateFeePercentage: null,
      lateFeeGraceDays: null,
      notes: null,
      changedById: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    })
    const DEFAULTS = { dailyLateFeePercentage: '5', paymentGraceDays: 10 }

    it('valida porcentajes, importe fijo y gracia', () => {
      expect(ContractPolicy.normalizePercentage('7.5', 'x')).toBe('7.50')
      expect(() => ContractPolicy.normalizePercentage('101', 'x')).toThrow(
        InvalidBillingTermsException,
      )
      expect(() => ContractPolicy.normalizePercentage('-1', 'x')).toThrow(
        InvalidBillingTermsException,
      )
      expect(() => ContractPolicy.normalizePercentage('abc', 'x')).toThrow(
        InvalidBillingTermsException,
      )
      expect(ContractPolicy.normalizeFeeAmount(null)).toBeNull()
      expect(ContractPolicy.normalizeFeeAmount('25000')).toBe('25000.00')
      expect(() => ContractPolicy.normalizeFeeAmount('0')).toThrow(
        InvalidBillingTermsException,
      )
      expect(ContractPolicy.normalizeGraceDays(null)).toBeNull()
      expect(ContractPolicy.normalizeGraceDays(0)).toBe(0)
      expect(() => ContractPolicy.normalizeGraceDays(-1)).toThrow(
        InvalidBillingTermsException,
      )
      expect(() => ContractPolicy.normalizeGraceDays(1.5)).toThrow(
        InvalidBillingTermsException,
      )
    })

    it('la fecha de los términos nuevos va dentro del contrato y no antes de los vigentes', () => {
      const assert = (date: string) =>
        ContractPolicy.assertBillingTermsEffectiveFrom(
          date,
          '2026-06-01',
          '2026-01-01',
          '2027-12-31',
        )
      expect(() => assert('2026-06-01')).not.toThrow()
      expect(() => assert('2026-09-01')).not.toThrow()
      expect(() => assert('2026-05-31')).toThrow(
        BillingTermsNotAfterLatestException,
      )
      expect(() => assert('2025-12-31')).toThrow(
        BillingTermsOutOfRangeException,
      )
      expect(() => assert('2028-01-01')).toThrow(
        BillingTermsOutOfRangeException,
      )
    })

    it('resuelve el punitorio contra el tenant sólo donde el contrato no lo fijó', () => {
      expect(
        ContractPolicy.resolveBillingTerms(terms('2026-01-01'), DEFAULTS),
      ).toMatchObject({
        lateFeePercentage: '5.00',
        lateFeeGraceDays: 10,
        lateFeeStartDay: 11,
        inheritedLateFeePercentage: true,
        inheritedLateFeeGraceDays: true,
      })
      expect(
        ContractPolicy.resolveBillingTerms(
          terms('2026-01-01', {
            lateFeePercentage: '2.00',
            lateFeeGraceDays: 5,
          }),
          DEFAULTS,
        ),
      ).toMatchObject({
        lateFeePercentage: '2.00',
        lateFeeGraceDays: 5,
        lateFeeStartDay: 6,
        inheritedLateFeePercentage: false,
        inheritedLateFeeGraceDays: false,
      })
    })

    it('sin punitorio propio ni de la inmobiliaria no hay valor por defecto: se exige uno (D-227)', () => {
      const noDefault = { ...DEFAULTS, dailyLateFeePercentage: null }
      expect(() => ContractPolicy.assertLateFeeSource(null, noDefault)).toThrow(
        LateFeePercentageRequiredException,
      )
      expect(() =>
        ContractPolicy.assertLateFeeSource('0.00', noDefault),
      ).not.toThrow()
      expect(() =>
        ContractPolicy.assertLateFeeSource(null, DEFAULTS),
      ).not.toThrow()
    })

    it('el día de inicio es la gracia dicha al revés y no se combina con ella', () => {
      expect(ContractPolicy.resolveGraceInput(undefined, 11)).toBe(10)
      expect(ContractPolicy.resolveGraceInput(null, 1)).toBe(0)
      expect(ContractPolicy.resolveGraceInput(7, undefined)).toBe(7)
      expect(ContractPolicy.resolveGraceInput(undefined, undefined)).toBe(
        undefined,
      )
      expect(() => ContractPolicy.resolveGraceInput(5, 11)).toThrow(
        InvalidBillingTermsException,
      )
      expect(() => ContractPolicy.resolveGraceInput(null, 0)).toThrow(
        InvalidBillingTermsException,
      )
      expect(() => ContractPolicy.resolveGraceInput(null, 32)).toThrow(
        InvalidBillingTermsException,
      )
    })

    it('si falta el punitorio en ambos lados, la resolución no inventa uno (0)', () => {
      expect(
        ContractPolicy.resolveBillingTerms(terms('2026-01-01'), {
          ...DEFAULTS,
          dailyLateFeePercentage: null,
        }),
      ).toMatchObject({ lateFeePercentage: '0.00' })
    })
  })

  it('un aumento a mano exige un monto mayor que cero', () => {
    expect(ContractPolicy.normalizeNewRent('120000')).toBe('120000.00')
    expect(() => ContractPolicy.normalizeNewRent(undefined)).toThrow(
      NewRentRequiredException,
    )
    expect(() => ContractPolicy.normalizeNewRent('0')).toThrow(
      NewRentRequiredException,
    )
  })

  describe('rescisión anticipada (RN-09)', () => {
    it('la notificación va desde el inicio hasta el día anterior al fin (spec 7)', () => {
      const assert = (date: string) =>
        ContractPolicy.assertTerminationDate(date, '2026-01-01', '2027-12-31')
      expect(() => assert('2026-01-01')).not.toThrow()
      expect(() => assert('2027-12-30')).not.toThrow()
      expect(() => assert('2025-12-31')).toThrow(
        TerminationDateInvalidException,
      )
      expect(() => assert('2027-12-31')).toThrow(
        TerminationDateInvalidException,
      )
    })

    it('ejemplo numérico: 12 meses y 30 días de 100.000 → canon futuro 1.300.000, multa 130.000', () => {
      // Contrato del 1/1/2026 al 31/12/2027, notificado el 1/12/2026: quedan
      // 12 meses enteros (hasta el 1/12/2027) y 30 días sueltos hasta el fin.
      // Canon futuro = 12 × 100.000 + 30 × (100.000 / 30) = 1.300.000.
      expect(
        ContractPolicy.termination('100000.00', '2026-12-01', '2027-12-31'),
      ).toEqual({
        currentRent: '100000.00',
        remainingMonths: 12,
        remainingDays: 30,
        totalDays: 395,
        futureRent: '1300000.00',
        penalty: '130000.00',
      })
    })

    it('ejemplo con días que no dan un mes: 9 meses y 16 días', () => {
      // Notificado el 15/3/2026, fin el 31/12/2026: 9 meses hasta el 15/12 y
      // 16 días sueltos. 16 días = 100.000 × 16 / 30 = 53.333,33.
      expect(
        ContractPolicy.termination('100000.00', '2026-03-15', '2026-12-31'),
      ).toMatchObject({
        remainingMonths: 9,
        remainingDays: 16,
        futureRent: '953333.33',
        penalty: '95333.33',
      })
    })

    it('notificado el día anterior al fin debe un día', () => {
      expect(
        ContractPolicy.termination('90000.00', '2026-12-30', '2026-12-31'),
      ).toMatchObject({
        remainingMonths: 0,
        remainingDays: 1,
        futureRent: '3000.00',
        penalty: '300.00',
      })
    })
  })

  it('una renovación no empieza antes que el original', () => {
    expect(() =>
      ContractPolicy.assertRenewalStart('2028-01-01', '2026-01-01'),
    ).not.toThrow()
    expect(() =>
      ContractPolicy.assertRenewalStart('2025-12-31', '2026-01-01'),
    ).toThrow(RenewalStartInvalidException)
  })

  it('póliza vencida: con caución y fecha anterior a hoy (RN-16)', () => {
    expect(
      ContractPolicy.isSuretyExpired(true, '2026-03-01', '2026-03-02'),
    ).toBe(true)
    expect(
      ContractPolicy.isSuretyExpired(true, '2026-03-02', '2026-03-02'),
    ).toBe(false)
    expect(
      ContractPolicy.isSuretyExpired(false, '2026-01-01', '2026-03-02'),
    ).toBe(false)
    expect(ContractPolicy.isSuretyExpired(true, null, '2026-03-02')).toBe(false)
  })

  describe('por vencer y vencido (RN-12, PRD 9.1)', () => {
    const { ACTIVE, FINISHED } = ContractStatus

    it('por vencer: activo y termina dentro de los días de aviso, hoy inclusive', () => {
      expect(
        ContractPolicy.isExpiringSoon(ACTIVE, '2026-04-30', '2026-03-01', 60),
      ).toBe(true)
      expect(
        ContractPolicy.isExpiringSoon(ACTIVE, '2026-03-01', '2026-03-01', 60),
      ).toBe(true)
      expect(
        ContractPolicy.isExpiringSoon(ACTIVE, '2026-05-01', '2026-03-01', 60),
      ).toBe(false)
      expect(
        ContractPolicy.isExpiringSoon(ACTIVE, '2026-02-28', '2026-03-01', 60),
      ).toBe(false)
      expect(
        ContractPolicy.isExpiringSoon(FINISHED, '2026-03-10', '2026-03-01', 60),
      ).toBe(false)
    })

    it('vencido: activo y con el fin ya pasado', () => {
      expect(ContractPolicy.isExpired(ACTIVE, '2026-02-28', '2026-03-01')).toBe(
        true,
      )
      expect(ContractPolicy.isExpired(ACTIVE, '2026-03-01', '2026-03-01')).toBe(
        false,
      )
      expect(
        ContractPolicy.isExpired(FINISHED, '2026-02-28', '2026-03-01'),
      ).toBe(false)
    })
  })

  describe('línea de tiempo (spec 3.3)', () => {
    it('un contrato de dos años, a mitad de camino', () => {
      expect(
        ContractPolicy.timeline('2026-01-01', '2027-12-31', '2027-01-01'),
      ).toEqual({ totalMonths: 24, elapsedMonths: 12, progressPercent: 50 })
    })

    it('antes de empezar está en cero y después del fin en cien', () => {
      expect(
        ContractPolicy.timeline('2026-01-01', '2027-12-31', '2025-12-01'),
      ).toEqual({ totalMonths: 24, elapsedMonths: 0, progressPercent: 0 })
      expect(
        ContractPolicy.timeline('2026-01-01', '2027-12-31', '2028-06-01'),
      ).toEqual({ totalMonths: 24, elapsedMonths: 24, progressPercent: 100 })
    })

    it('el primer día apenas avanza', () => {
      expect(
        ContractPolicy.timeline('2026-01-01', '2026-12-31', '2026-01-01'),
      ).toEqual({ totalMonths: 12, elapsedMonths: 0, progressPercent: 0 })
    })
  })
})
