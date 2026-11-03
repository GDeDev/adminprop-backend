import { formatMoney } from '@/shared/money'
import { MarketCurrency, ValuationConfidence } from './market'
import { PriceBasis } from './valuation-policy'

/**
 * Los hechos de una tasación, ya calculados. Es lo único que ve el redactor,
 * sea la plantilla o un modelo de lenguaje: nunca la dirección, el propietario
 * ni nada de la ficha (A-70). Los importes van como string decimal.
 */
export interface ValuationFacts {
  /** Ej. "Palermo, CABA": nombre de la zona usada, no de la propiedad. */
  zoneLabel: string
  zoneWidened: boolean
  currency: MarketCurrency
  used: number
  discarded: number
  maxAgeDays: number
  min: string
  max: string
  suggested: string
  basis: PriceBasis
  /** Sólo con base por m². */
  medianPerM2: string | null
  areaM2: string | null
  rangeIsMinMax: boolean
  confidence: ValuationConfidence
}

const CONFIDENCE_LABEL: Record<ValuationConfidence, string> = {
  [ValuationConfidence.HIGH]: 'alta',
  [ValuationConfidence.MEDIUM]: 'media',
  [ValuationConfidence.LOW]: 'baja',
}

/**
 * Los números que un texto puede mencionar: los de los hechos, redondeados a
 * entero también, y los percentiles que nombra la plantilla. Lo usa el control
 * del redactor con modelo (`LlmNarrator`).
 */
export function factNumbers(facts: ValuationFacts): number[] {
  const raw = [
    facts.used,
    facts.discarded,
    facts.maxAgeDays,
    facts.min,
    facts.max,
    facts.suggested,
    facts.medianPerM2,
    facts.areaM2,
  ]
  const numbers: number[] = [25, 75]
  for (const value of raw) {
    if (value === null) continue
    const n = Number(value)
    numbers.push(n, Math.round(n))
  }
  return numbers
}

/** Plantilla en español armada con los números (rediseño 5, paso 7). */
export function templateNarrative(facts: ValuationFacts): string {
  const money = (value: string) => formatMoney(value, facts.currency)
  const sentences: string[] = []

  const discarded =
    facts.discarded > 0
      ? ` (${facts.discarded} ${facts.discarded === 1 ? 'descartado' : 'descartados'} por precio atípico)`
      : ''
  sentences.push(
    `Basado en ${facts.used} ${facts.used === 1 ? 'aviso' : 'avisos'} de alquiler en ${facts.zoneLabel} de los últimos ${facts.maxAgeDays} días${discarded}.`,
  )

  if (facts.basis === 'PER_M2' && facts.medianPerM2 && facts.areaM2) {
    sentences.push(
      `Mediana de ${money(facts.medianPerM2)} por m² aplicada a ${facts.areaM2} m²: precio sugerido ${money(facts.suggested)}.`,
    )
  } else {
    sentences.push(
      `Mediana de los avisos: precio sugerido ${money(facts.suggested)}.`,
    )
    sentences.push(
      'La propiedad no tiene superficie cargada, así que se compararon los precios de los avisos sin ajustar por tamaño: el resultado es menos preciso.',
    )
  }

  sentences.push(
    facts.rangeIsMinMax
      ? `Con pocos avisos, el rango va del mínimo (${money(facts.min)}) al máximo (${money(facts.max)}) encontrados.`
      : `Rango entre ${money(facts.min)} y ${money(facts.max)} (percentiles 25 y 75).`,
  )

  if (facts.zoneWidened) {
    sentences.push(
      'La zona exacta tenía pocos avisos, por eso se amplió la búsqueda a una zona más grande.',
    )
  }

  sentences.push(`Confianza ${CONFIDENCE_LABEL[facts.confidence]}.`)
  return sentences.join(' ')
}
