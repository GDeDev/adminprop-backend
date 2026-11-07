import {
  factNumbers,
  templateNarrative,
  ValuationFacts,
} from '../../domain/valuation-narrative'
import { ValuationEngineKind } from '../../domain/market'
import { Narration, ValuationNarratorPort } from '../../domain/valuation.ports'
import { createLogger } from '@/shared/logging/root-logger'
import { errorMessage } from '@/shared/core/error-message'

const logger = createLogger('ValuationNarrator')

/** La plantilla de siempre: el default (`VALUATION_NARRATOR=template`). */
export class TemplateNarrator extends ValuationNarratorPort {
  async narrate(facts: ValuationFacts): Promise<Narration> {
    return {
      text: templateNarrative(facts),
      engine: ValuationEngineKind.STATISTICAL,
    }
  }
}

/** Para tests: devuelve el texto que se le indique, o lo que dé la plantilla. */
export class FakeNarrator extends ValuationNarratorPort {
  constructor(private readonly output: string | null = null) {
    super()
  }

  async narrate(facts: ValuationFacts): Promise<Narration> {
    return this.output === null
      ? new TemplateNarrator().narrate(facts)
      : { text: this.output, engine: ValuationEngineKind.STATISTICAL_LLM }
  }
}

/** Lo que sabe generar texto a partir de un pedido; el único punto que toca al proveedor. */
export abstract class ValuationTextGenerator {
  abstract generate(prompt: { system: string; user: string }): Promise<string>
}

export const NARRATION_MAX_LENGTH = 700

const SYSTEM_PROMPT =
  'Sos un redactor de una inmobiliaria argentina. Recibís los resultados ya calculados de una estimación de alquiler y los explicás en 2 a 4 oraciones en español rioplatense. ' +
  'Usá únicamente los números que te damos, escritos tal cual (por ejemplo 450.000 o 12). No calcules, no redondees, no agregues cifras ni recomendaciones, no uses listas, enlaces, HTML ni markdown.'

/** El pedido para el modelo: sólo los hechos calculados, jamás datos de la ficha (D-178). */
export function buildPrompt(facts: ValuationFacts): {
  system: string
  user: string
} {
  return {
    system: SYSTEM_PROMPT,
    user: `Resultados calculados (JSON):\n${JSON.stringify(facts)}`,
  }
}

/** Saca HTML, enlaces y markdown, y acota el largo. Devuelve null si no queda texto. */
export function sanitizeNarration(text: string): string | null {
  const clean = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return null
  return clean.length > NARRATION_MAX_LENGTH
    ? `${clean.slice(0, NARRATION_MAX_LENGTH - 1).trimEnd()}…`
    : clean
}

/** Un token numérico en formato argentino ("450.000", "1.234,50", "12") → número. */
export function parseNumberToken(token: string): number | null {
  const trimmed = token.replace(/[.,]+$/, '')
  if (!trimmed) return null
  let normalized = trimmed
  if (trimmed.includes('.') && trimmed.includes(',')) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.')
  } else if (trimmed.includes(',')) {
    normalized = /,\d{1,2}$/.test(trimmed)
      ? trimmed.replace(',', '.')
      : trimmed.replace(/,/g, '')
  } else if (trimmed.includes('.')) {
    normalized = /^\d{1,3}(\.\d{3})+$/.test(trimmed)
      ? trimmed.replace(/\./g, '')
      : trimmed
  }
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

/** Todos los números que menciona un texto. */
export function numbersIn(text: string): number[] {
  return (text.match(/\d[\d.,]*/g) ?? [])
    .map(parseNumberToken)
    .filter((n): n is number => n !== null)
}

/** El texto no menciona ninguna cifra que no esté entre los hechos calculados. */
export function mentionsOnlyKnownNumbers(
  text: string,
  facts: ValuationFacts,
): boolean {
  const allowed = factNumbers(facts)
  return numbersIn(text).every((n) =>
    allowed.some((known) => Math.abs(known - n) < 0.005),
  )
}

/**
 * Redacta con un modelo, a partir de números ya calculados (A-60). Cualquier
 * falla o texto sospechoso (cifras distintas de las calculadas, vacío) se
 * descarta y queda la plantilla: el resultado numérico nunca depende de esto.
 */
export class LlmNarrator extends ValuationNarratorPort {
  constructor(
    private readonly generator: ValuationTextGenerator,
    private readonly fallback: ValuationNarratorPort = new TemplateNarrator(),
  ) {
    super()
  }

  async narrate(facts: ValuationFacts): Promise<Narration> {
    try {
      const raw = await this.generator.generate(buildPrompt(facts))
      const text = sanitizeNarration(raw)
      if (!text) {
        logger.warn('El modelo devolvió un texto vacío: se usa la plantilla')
      } else if (!mentionsOnlyKnownNumbers(text, facts)) {
        logger.warn(
          'El modelo mencionó cifras no calculadas: se usa la plantilla',
        )
      } else {
        return { text, engine: ValuationEngineKind.STATISTICAL_LLM }
      }
    } catch (error) {
      logger.warn(
        { error: errorMessage(error) },
        'El modelo no respondió: se usa la plantilla',
      )
    }
    return this.fallback.narrate(facts)
  }
}

/** Anthropic por HTTP (sin SDK nuevo); la clave viene de la config y nunca se loguea. */
export class AnthropicTextGenerator extends ValuationTextGenerator {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super()
  }

  async generate(prompt: { system: string; user: string }): Promise<string> {
    const response = await this.fetchImpl(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 400,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        }),
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!response.ok) throw new Error(`Anthropic respondió ${response.status}`)
    const body = (await response.json()) as {
      content?: { type: string; text?: string }[]
    }
    return (body.content ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join(' ')
  }
}
