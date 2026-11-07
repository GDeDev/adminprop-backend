import { toDecimal } from '@/shared/money'
import { Comparable, MarketSource, ValuationConfidence } from './market'
import {
  quantile,
  ValuationPolicy,
  ValuationSubject,
  weightedQuantile,
} from './valuation-policy'

const NOW = new Date('2026-11-03T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000)

let counter = 0
const comparable = (
  price: string,
  overrides: Partial<Comparable> = {},
): Comparable => ({
  id: `c-${++counter}`,
  source: MarketSource.FAKE,
  zoneKey: 'caba/palermo',
  price,
  currency: 'ARS',
  areaM2: null,
  bedrooms: null,
  amenities: [],
  lastSeenAt: daysAgo(1),
  ...overrides,
})

const noArea: ValuationSubject = { areaM2: null, bedrooms: null, amenities: [] }
const options = { now: NOW, minComparables: 3 }

describe('ValuationPolicy.compute', () => {
  describe('por precio absoluto (la propiedad no tiene superficie)', () => {
    it('con 3 comparables da la mediana y el rango mínimo–máximo', () => {
      const result = ValuationPolicy.compute(
        noArea,
        [comparable('100000'), comparable('120000'), comparable('150000')],
        options,
      )

      expect(result).toMatchObject({
        used: 3,
        discarded: 0,
        basis: 'ABSOLUTE',
        rangeIsMinMax: true,
        medianPerM2: null,
      })
      expect(result?.suggested.toFixed(2)).toBe('120000.00')
      expect(result?.min.toFixed(2)).toBe('100000.00')
      expect(result?.max.toFixed(2)).toBe('150000.00')
    })

    it('con cantidad par y pesos iguales promedia los dos del medio', () => {
      const result = ValuationPolicy.compute(
        noArea,
        [
          comparable('100000'),
          comparable('110000'),
          comparable('130000'),
          comparable('140000'),
        ],
        options,
      )
      expect(result?.suggested.toFixed(2)).toBe('120000.00')
    })

    it('con 5 o más usa los percentiles 25 y 75 en vez de mínimo y máximo', () => {
      const prices = ['100000', '110000', '120000', '130000', '140000']
      const result = ValuationPolicy.compute(
        noArea,
        prices.map((p) => comparable(p)),
        options,
      )

      expect(result?.rangeIsMinMax).toBe(false)
      expect(result?.suggested.toFixed(2)).toBe('120000.00')
      expect(result?.min.toFixed(2)).toBe('110000.00')
      expect(result?.max.toFixed(2)).toBe('130000.00')
    })

    it('devuelve null si hay menos comparables que el mínimo', () => {
      expect(
        ValuationPolicy.compute(
          noArea,
          [comparable('100000'), comparable('120000')],
          options,
        ),
      ).toBeNull()
      expect(ValuationPolicy.compute(noArea, [], options)).toBeNull()
    })
  })

  describe('atípicos', () => {
    const base = ['100000', '105000', '110000', '115000', '120000', '125000']

    it('descarta por rango intercuartil los precios fuera de la cerca', () => {
      const result = ValuationPolicy.compute(
        noArea,
        [...base, '900000', '5000'].map((p) => comparable(p)),
        options,
      )

      expect(result?.discarded).toBe(2)
      expect(result?.used).toBe(6)
      expect(result?.max.lte('125000')).toBe(true)
      expect(result?.min.gte('100000')).toBe(true)
    })

    it('descarta los precios en cero o negativos aunque haya pocos avisos', () => {
      const result = ValuationPolicy.compute(
        noArea,
        [
          comparable('0'),
          comparable('-5'),
          comparable('100000'),
          comparable('110000'),
          comparable('120000'),
        ],
        options,
      )
      expect(result?.discarded).toBe(2)
      expect(result?.used).toBe(3)
    })

    it('con menos de 5 avisos no descarta atípicos (no hay con qué compararlos)', () => {
      const result = ValuationPolicy.compute(
        noArea,
        [
          comparable('100000'),
          comparable('110000'),
          comparable('120000'),
          comparable('900000'),
        ],
        options,
      )
      expect(result?.discarded).toBe(0)
      expect(result?.used).toBe(4)
    })

    it('si al descartar quedan menos que el mínimo, no hay resultado', () => {
      const result = ValuationPolicy.compute(
        noArea,
        [comparable('0'), comparable('0'), comparable('100000')],
        options,
      )
      expect(result).toBeNull()
    })
  })

  describe('por m²', () => {
    const subject: ValuationSubject = {
      areaM2: '50',
      bedrooms: null,
      amenities: [],
    }

    it('lleva cada aviso al tamaño de la propiedad y devuelve la mediana por m²', () => {
      // 2000, 2400 y 3000 por m² sobre 50 m² → 100.000, 120.000 y 150.000.
      const result = ValuationPolicy.compute(
        subject,
        [
          comparable('80000', { areaM2: '40' }),
          comparable('144000', { areaM2: '60' }),
          comparable('150000', { areaM2: '50' }),
        ],
        options,
      )

      expect(result?.basis).toBe('PER_M2')
      expect(result?.suggested.toFixed(2)).toBe('120000.00')
      expect(result?.medianPerM2?.toFixed(2)).toBe('2400.00')
    })

    it('ignora los avisos sin superficie o de tamaño muy distinto (±35 %)', () => {
      const result = ValuationPolicy.compute(
        subject,
        [
          comparable('100000', { areaM2: '50' }),
          comparable('110000', { areaM2: '50' }),
          comparable('120000', { areaM2: '50' }),
          comparable('500000', { areaM2: '200' }),
          comparable('20000', { areaM2: '10' }),
          comparable('90000', { areaM2: null }),
        ],
        options,
      )
      expect(result?.used).toBe(3)
      // No cuentan como descartados por precio: simplemente no son comparables.
      expect(result?.discarded).toBe(0)
    })

    it('el borde de ±35 % entra y lo que lo supera no', () => {
      const result = ValuationPolicy.compute(
        subject,
        [
          comparable('100000', { areaM2: '67.5' }),
          comparable('100000', { areaM2: '32.5' }),
          comparable('100000', { areaM2: '67.6' }),
        ],
        options,
      )
      expect(result).toBeNull()
    })
  })

  describe('pesos', () => {
    it('suma 0,25 por comodidad que coincide, con tope de 1', () => {
      const subject: ValuationSubject = {
        areaM2: null,
        bedrooms: null,
        amenities: [
          'balcon',
          'cochera',
          'pileta',
          'parrilla',
          'sum',
          'gimnasio',
        ],
      }
      expect(
        ValuationPolicy.weightOf(
          subject,
          comparable('1', { amenities: ['balcon'] }),
          NOW,
        ).toFixed(2),
      ).toBe('1.25')
      expect(
        ValuationPolicy.weightOf(
          subject,
          comparable('1', { amenities: subject.amenities }),
          NOW,
        ).toFixed(2),
      ).toBe('2.00')
    })

    it('suma por ambientes iguales o con uno de diferencia, y nada si difieren más', () => {
      const subject: ValuationSubject = {
        areaM2: null,
        bedrooms: 2,
        amenities: [],
      }
      const weight = (bedrooms: number | null) =>
        ValuationPolicy.weightOf(subject, comparable('1', { bedrooms }), NOW)
      expect(weight(2).toFixed(2)).toBe('1.50')
      expect(weight(3).toFixed(2)).toBe('1.25')
      expect(weight(1).toFixed(2)).toBe('1.25')
      expect(weight(4).toFixed(2)).toBe('1.00')
      expect(weight(null).toFixed(2)).toBe('1.00')
    })

    it('resta 0,02 por día pasados los 15, con piso de 0,3', () => {
      const weight = (days: number) =>
        ValuationPolicy.weightOf(
          noArea,
          comparable('1', { lastSeenAt: daysAgo(days) }),
          NOW,
        )
      expect(weight(10).toFixed(2)).toBe('1.00')
      expect(weight(15).toFixed(2)).toBe('1.00')
      expect(weight(25).toFixed(2)).toBe('0.80')
      expect(weight(44).toFixed(2)).toBe('0.42')
      expect(weight(200).toFixed(2)).toBe('0.30')
    })

    it('un aviso con más peso arrastra la mediana hacia su precio', () => {
      const subject: ValuationSubject = {
        areaM2: null,
        bedrooms: null,
        amenities: ['balcon', 'cochera', 'pileta', 'sum'],
      }
      const equal = ValuationPolicy.compute(
        noArea,
        [comparable('100'), comparable('200'), comparable('300')],
        options,
      )
      const weighted = ValuationPolicy.compute(
        subject,
        [
          comparable('100'),
          comparable('200'),
          comparable('300', {
            amenities: ['balcon', 'cochera', 'pileta', 'sum'],
          }),
        ],
        options,
      )
      expect(equal?.suggested.toFixed(0)).toBe('200')
      // 300 pesa 2 de 4: el acumulado iguala la mitad justo en 200.
      expect(weighted?.suggested.toFixed(0)).toBe('250')
    })
  })

  it('el aviso más viejo de los usados queda registrado', () => {
    const result = ValuationPolicy.compute(
      noArea,
      [
        comparable('100', { lastSeenAt: daysAgo(3) }),
        comparable('110', { lastSeenAt: daysAgo(30) }),
        comparable('120', { lastSeenAt: daysAgo(10) }),
      ],
      options,
    )
    expect(result?.oldestSeenAt).toEqual(daysAgo(30))
  })

  it('los importes salen con 2 decimales exactos (ROUND_HALF_UP)', () => {
    const result = ValuationPolicy.compute(
      { areaM2: '33', bedrooms: null, amenities: [] },
      [
        comparable('100000', { areaM2: '30' }),
        comparable('100000', { areaM2: '30' }),
        comparable('100000', { areaM2: '30' }),
      ],
      options,
    )
    // 100000 / 30 * 33 = 110000 exacto; con otro tamaño habría periódicos.
    expect(result?.suggested.toFixed(2)).toBe('110000.00')
    const odd = ValuationPolicy.compute(
      { areaM2: '7', bedrooms: null, amenities: [] },
      [
        comparable('1000', { areaM2: '7' }),
        comparable('1000', { areaM2: '7' }),
        comparable('1000', { areaM2: '7' }),
      ],
      options,
    )
    expect(odd?.medianPerM2?.toFixed(2)).toBe('142.86')
  })
})

describe('ValuationPolicy.confidenceOf', () => {
  it.each([
    [12, false, ValuationConfidence.HIGH],
    [10, false, ValuationConfidence.HIGH],
    [9, false, ValuationConfidence.MEDIUM],
    [5, false, ValuationConfidence.MEDIUM],
    [4, false, ValuationConfidence.LOW],
    [3, false, ValuationConfidence.LOW],
  ])('%i avisos en la zona exacta: %s -> %s', (used, widened, expected) => {
    expect(ValuationPolicy.confidenceOf(used, widened)).toBe(expected)
  })

  it('ampliar la zona baja un nivel', () => {
    expect(ValuationPolicy.confidenceOf(12, true)).toBe(
      ValuationConfidence.MEDIUM,
    )
    expect(ValuationPolicy.confidenceOf(7, true)).toBe(ValuationConfidence.LOW)
    expect(ValuationPolicy.confidenceOf(3, true)).toBe(ValuationConfidence.LOW)
  })
})

describe('ValuationPolicy.roundForDisplay', () => {
  it('redondea a la centena en pesos y a la decena en dólares', () => {
    expect(
      ValuationPolicy.roundForDisplay(toDecimal('123456.78'), 'ARS').toFixed(2),
    ).toBe('123500.00')
    expect(
      ValuationPolicy.roundForDisplay(toDecimal('123450.00'), 'ARS').toFixed(2),
    ).toBe('123500.00')
    expect(
      ValuationPolicy.roundForDisplay(toDecimal('652.00'), 'USD').toFixed(2),
    ).toBe('650.00')
  })
})

describe('cuantiles', () => {
  it('el cuantil sin pesos interpola', () => {
    const sorted = ['10', '20', '30', '40'].map((v) => toDecimal(v))
    expect(quantile(sorted, '0.5').toFixed(2)).toBe('25.00')
    expect(quantile(sorted, '0.25').toFixed(2)).toBe('17.50')
  })

  it('el cuantil ponderado respeta los pesos', () => {
    const entries = [
      { value: toDecimal('10'), weight: toDecimal('1'), seenAt: NOW },
      { value: toDecimal('20'), weight: toDecimal('1'), seenAt: NOW },
      { value: toDecimal('30'), weight: toDecimal('5'), seenAt: NOW },
    ]
    expect(weightedQuantile(entries, '0.5').toFixed(0)).toBe('30')
    expect(weightedQuantile(entries, '0.1').toFixed(0)).toBe('10')
  })
})
