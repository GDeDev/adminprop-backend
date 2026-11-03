import { Money, roundMoney, toDecimal } from '@/shared/money'
import { Comparable, MarketCurrency, ValuationConfidence } from './market'

/**
 * Cálculo de la tasación (Fase 24, rediseño 5). Puro: sin base, sin red ni
 * reloj propio. Los números los calcula este código y nadie más (A-60); los
 * pesos son constantes con nombre para poder probarlos y ajustarlos.
 */

/** Los comparables con superficie sólo cuentan si difieren menos de esto de la propiedad. */
export const AREA_TOLERANCE = '0.35'
/** Desde cuántos comparables se descartan los atípicos por rango intercuartil. */
export const OUTLIER_MIN_SAMPLE = 5
export const IQR_FACTOR = '1.5'
/** Peso por cada comodidad que coincide, con tope. */
export const AMENITY_WEIGHT = '0.25'
export const AMENITY_WEIGHT_CAP = '1'
/** Peso extra si tienen los mismos ambientes, o uno de diferencia. */
export const BEDROOMS_EXACT_WEIGHT = '0.5'
export const BEDROOMS_NEAR_WEIGHT = '0.25'
/** A partir de cuántos días un aviso empieza a pesar menos, y cuánto por día. */
export const AGE_GRACE_DAYS = 15
export const AGE_PENALTY_PER_DAY = '0.02'
export const MIN_WEIGHT = '0.3'
/** Con menos de esto se informa mínimo–máximo en lugar de percentiles. */
export const PERCENTILE_MIN_SAMPLE = 5
/** Confianza por cantidad de comparables en la zona exacta. */
export const HIGH_CONFIDENCE_FROM = 10
export const MEDIUM_CONFIDENCE_FROM = 5

const DAY_MS = 86_400_000

export type PriceBasis = 'PER_M2' | 'ABSOLUTE'

export interface ValuationSubject {
  /** Decimal como string; null si no se conoce. */
  areaM2: string | null
  bedrooms: number | null
  /** Ya normalizadas (`balcon`, `cochera`). */
  amenities: string[]
}

export interface ValuationComputation {
  suggested: Money
  min: Money
  max: Money
  used: number
  /** Atípicos y precios inválidos. */
  discarded: number
  /** El aviso visto hace más tiempo de los usados. */
  oldestSeenAt: Date
  basis: PriceBasis
  /** Mediana ponderada por m², sólo con base `PER_M2`. */
  medianPerM2: Money | null
  /** Con pocos avisos el rango es mínimo–máximo. */
  rangeIsMinMax: boolean
}

interface Weighted {
  value: Money
  weight: Money
  seenAt: Date
}

/** Cuantil sin pesos con interpolación lineal (lo usa la cerca de atípicos). */
export function quantile(sortedAsc: Money[], q: string): Money {
  const position = toDecimal(q).times(sortedAsc.length - 1)
  const lower = position.floor()
  const upper = position.ceil()
  const low = sortedAsc[lower.toNumber()]
  const high = sortedAsc[upper.toNumber()]
  return low.plus(high.minus(low).times(position.minus(lower)))
}

/**
 * Cuantil ponderado: el primer valor cuyo peso acumulado supera `q` del total;
 * si lo iguala justo, el promedio con el siguiente (así la mediana de pesos
 * parejos coincide con la mediana de siempre).
 */
export function weightedQuantile(sortedAsc: Weighted[], q: string): Money {
  const total = sortedAsc.reduce((sum, w) => sum.plus(w.weight), toDecimal('0'))
  const target = total.times(q)
  let cumulative = toDecimal('0')
  for (let i = 0; i < sortedAsc.length; i += 1) {
    cumulative = cumulative.plus(sortedAsc[i].weight)
    if (cumulative.gt(target)) return sortedAsc[i].value
    if (cumulative.eq(target)) {
      const next = sortedAsc[i + 1]
      return next
        ? sortedAsc[i].value.plus(next.value).div(2)
        : sortedAsc[i].value
    }
  }
  return sortedAsc[sortedAsc.length - 1].value
}

export const ValuationPolicy = {
  /**
   * Lo que pesa cada aviso: base 1, más por comodidades y ambientes que
   * coinciden, menos por antigüedad (con piso).
   */
  weightOf(
    subject: ValuationSubject,
    comparable: Pick<Comparable, 'amenities' | 'bedrooms' | 'lastSeenAt'>,
    now: Date,
  ): Money {
    const matches = subject.amenities.filter((a) =>
      comparable.amenities.includes(a),
    ).length
    const amenityBonus = toDecimal(AMENITY_WEIGHT).times(matches)
    const cappedAmenity = amenityBonus.gt(AMENITY_WEIGHT_CAP)
      ? toDecimal(AMENITY_WEIGHT_CAP)
      : amenityBonus

    let bedroomBonus = toDecimal('0')
    if (subject.bedrooms !== null && comparable.bedrooms !== null) {
      const difference = Math.abs(subject.bedrooms - comparable.bedrooms)
      if (difference === 0) bedroomBonus = toDecimal(BEDROOMS_EXACT_WEIGHT)
      else if (difference === 1) bedroomBonus = toDecimal(BEDROOMS_NEAR_WEIGHT)
    }

    const ageDays = Math.max(
      0,
      Math.floor((now.getTime() - comparable.lastSeenAt.getTime()) / DAY_MS),
    )
    const agePenalty = toDecimal(AGE_PENALTY_PER_DAY).times(
      Math.max(0, ageDays - AGE_GRACE_DAYS),
    )

    const weight = toDecimal('1')
      .plus(cappedAmenity)
      .plus(bedroomBonus)
      .minus(agePenalty)
    return weight.lt(MIN_WEIGHT) ? toDecimal(MIN_WEIGHT) : weight
  },

  /**
   * Calcula el rango con los avisos dados (ya filtrados por zona, categoría,
   * moneda y antigüedad). Devuelve null si después de descartar quedan menos
   * de `minComparables`: el caso de "no hay datos suficientes".
   */
  compute(
    subject: ValuationSubject,
    comparables: Comparable[],
    options: { now: Date; minComparables: number },
  ): ValuationComputation | null {
    const subjectArea =
      subject.areaM2 !== null && toDecimal(subject.areaM2).gt(0)
        ? toDecimal(subject.areaM2)
        : null
    const basis: PriceBasis = subjectArea ? 'PER_M2' : 'ABSOLUTE'

    let discarded = 0
    const candidates: { value: Money; comparable: Comparable }[] = []
    for (const comparable of comparables) {
      const price = toDecimal(comparable.price)
      if (price.lte(0)) {
        discarded += 1
        continue
      }
      if (subjectArea) {
        // Sin superficie no hay cómo llevarlo al tamaño de la propiedad, y uno
        // de tamaño muy distinto no es comparable: no suman ni se informan
        // como descartados por precio.
        if (comparable.areaM2 === null) continue
        const area = toDecimal(comparable.areaM2)
        if (area.lte(0)) continue
        const gap = area.minus(subjectArea).abs().div(subjectArea)
        if (gap.gt(AREA_TOLERANCE)) continue
        candidates.push({
          value: price.div(area).times(subjectArea),
          comparable,
        })
      } else {
        candidates.push({ value: price, comparable })
      }
    }

    let kept = candidates
    if (candidates.length >= OUTLIER_MIN_SAMPLE) {
      const sorted = candidates.map((c) => c.value).sort((a, b) => a.cmp(b))
      const q1 = quantile(sorted, '0.25')
      const q3 = quantile(sorted, '0.75')
      const spread = q3.minus(q1).times(IQR_FACTOR)
      const low = q1.minus(spread)
      const high = q3.plus(spread)
      kept = candidates.filter((c) => c.value.gte(low) && c.value.lte(high))
      discarded += candidates.length - kept.length
    }

    if (kept.length < options.minComparables || kept.length === 0) return null

    const weighted: Weighted[] = kept
      .map((c) => ({
        value: c.value,
        weight: ValuationPolicy.weightOf(subject, c.comparable, options.now),
        seenAt: c.comparable.lastSeenAt,
      }))
      .sort((a, b) => a.value.cmp(b.value))

    const rangeIsMinMax = weighted.length < PERCENTILE_MIN_SAMPLE
    const suggested = weightedQuantile(weighted, '0.5')
    const min = rangeIsMinMax
      ? weighted[0].value
      : weightedQuantile(weighted, '0.25')
    const max = rangeIsMinMax
      ? weighted[weighted.length - 1].value
      : weightedQuantile(weighted, '0.75')

    const oldestSeenAt = weighted.reduce(
      (oldest, w) => (w.seenAt < oldest ? w.seenAt : oldest),
      weighted[0].seenAt,
    )

    return {
      suggested: roundMoney(suggested),
      min: roundMoney(min),
      max: roundMoney(max),
      used: weighted.length,
      discarded,
      oldestSeenAt,
      basis,
      medianPerM2: subjectArea ? roundMoney(suggested.div(subjectArea)) : null,
      rangeIsMinMax,
    }
  },

  /** HIGH desde 10 avisos en la zona exacta, MEDIUM desde 5, LOW debajo; ampliar la zona baja un nivel. */
  confidenceOf(used: number, zoneWidened: boolean): ValuationConfidence {
    const base =
      used >= HIGH_CONFIDENCE_FROM
        ? ValuationConfidence.HIGH
        : used >= MEDIUM_CONFIDENCE_FROM
          ? ValuationConfidence.MEDIUM
          : ValuationConfidence.LOW
    if (!zoneWidened) return base
    return base === ValuationConfidence.HIGH
      ? ValuationConfidence.MEDIUM
      : ValuationConfidence.LOW
  },

  /** Para mostrar: a la centena en pesos y a la decena en dólares (D-176). */
  roundForDisplay(value: Money, currency: MarketCurrency): Money {
    const step = currency === 'USD' ? 10 : 100
    return roundMoney(value.div(step).toDecimalPlaces(0).times(step))
  },
}
