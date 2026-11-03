import { ValuationEngineKind, ValuationConfidence } from '../../domain/market'
import { ValuationFacts } from '../../domain/valuation-narrative'
import {
  buildPrompt,
  FakeNarrator,
  LlmNarrator,
  mentionsOnlyKnownNumbers,
  numbersIn,
  parseNumberToken,
  sanitizeNarration,
  TemplateNarrator,
  ValuationTextGenerator,
} from './narrators'

const facts: ValuationFacts = {
  zoneLabel: 'Palermo, CABA',
  zoneWidened: false,
  currency: 'ARS',
  used: 8,
  discarded: 2,
  maxAgeDays: 45,
  min: '420000.00',
  max: '510000.50',
  suggested: '455000.00',
  basis: 'PER_M2',
  medianPerM2: '9100.00',
  areaM2: '50',
  rangeIsMinMax: false,
  confidence: ValuationConfidence.MEDIUM,
}

class StubGenerator extends ValuationTextGenerator {
  prompts: { system: string; user: string }[] = []
  constructor(private readonly reply: string | Error) {
    super()
  }
  async generate(prompt: { system: string; user: string }): Promise<string> {
    this.prompts.push(prompt)
    if (this.reply instanceof Error) throw this.reply
    return this.reply
  }
}

describe('TemplateNarrator', () => {
  it('arma el texto en español con los números calculados', async () => {
    const { text, engine } = await new TemplateNarrator().narrate(facts)

    expect(engine).toBe(ValuationEngineKind.STATISTICAL)
    expect(text).toContain('8 avisos de alquiler en Palermo, CABA')
    expect(text).toContain('últimos 45 días')
    expect(text).toContain('2 descartados por precio atípico')
    expect(text).toContain('$ 455.000,00')
    expect(text).toContain('$ 420.000,00')
    expect(text).toContain('Confianza media')
  })

  it('avisa cuando falta la superficie, cuando amplió la zona y cuando el rango es mín–máx', async () => {
    const { text } = await new TemplateNarrator().narrate({
      ...facts,
      basis: 'ABSOLUTE',
      medianPerM2: null,
      areaM2: null,
      zoneWidened: true,
      rangeIsMinMax: true,
      used: 3,
      discarded: 0,
    })
    expect(text).toContain('no tiene superficie cargada')
    expect(text).toContain('se amplió la búsqueda')
    expect(text).toContain('del mínimo')
    expect(text).toContain('3 avisos')
    expect(text).not.toContain('descartado')
  })
})

describe('control de cifras', () => {
  it('lee números en formato argentino', () => {
    expect(parseNumberToken('450.000')).toBe(450000)
    expect(parseNumberToken('1.234,50')).toBe(1234.5)
    expect(parseNumberToken('12,5')).toBe(12.5)
    expect(parseNumberToken('45.')).toBe(45)
    expect(numbersIn('entre $ 420.000 y $ 510.000,50 en 8 avisos')).toEqual([
      420000, 510000.5, 8,
    ])
  })

  it('acepta las cifras calculadas y rechaza cualquier otra', () => {
    expect(
      mentionsOnlyKnownNumbers(
        'Mediana de $ 455.000 sobre 8 avisos de 45 días, percentiles 25 y 75.',
        facts,
      ),
    ).toBe(true)
    expect(
      mentionsOnlyKnownNumbers('El alquiler sugerido es $ 480.000.', facts),
    ).toBe(false)
  })
})

describe('sanitizeNarration', () => {
  it('saca HTML, enlaces y markdown', () => {
    expect(
      sanitizeNarration(
        '<b>Hola</b> mirá [esto](http://malo.test) **y** https://x.test/y www.z.test',
      ),
    ).toBe('Hola mirá esto y')
  })

  it('devuelve null si no queda texto y acota el largo', () => {
    expect(sanitizeNarration('  <i></i> ')).toBeNull()
    expect(sanitizeNarration('a'.repeat(2000))?.length).toBe(700)
  })
})

describe('LlmNarrator', () => {
  it('usa el texto del modelo si sólo menciona cifras calculadas', async () => {
    const generator = new StubGenerator(
      'Con 8 avisos de los últimos 45 días, la mediana es de $ 455.000.',
    )
    const result = await new LlmNarrator(generator).narrate(facts)

    expect(result.engine).toBe(ValuationEngineKind.STATISTICAL_LLM)
    expect(result.text).toContain('455.000')
  })

  it('descarta el texto si el modelo devuelve cifras distintas de las calculadas', async () => {
    const result = await new LlmNarrator(
      new StubGenerator('Yo diría que ronda los $ 600.000.'),
    ).narrate(facts)

    expect(result.engine).toBe(ValuationEngineKind.STATISTICAL)
    expect(result.text).toContain('Basado en 8 avisos')
  })

  it('descarta el texto vacío y vuelve a la plantilla si el modelo falla', async () => {
    const empty = await new LlmNarrator(new StubGenerator('   ')).narrate(facts)
    const failed = await new LlmNarrator(
      new StubGenerator(new Error('timeout')),
    ).narrate(facts)

    expect(empty.engine).toBe(ValuationEngineKind.STATISTICAL)
    expect(failed.engine).toBe(ValuationEngineKind.STATISTICAL)
  })

  it('el pedido al modelo lleva sólo los hechos calculados, nada de la ficha ni de personas', async () => {
    const generator = new StubGenerator('Con 8 avisos.')
    await new LlmNarrator(generator).narrate(facts)

    const [prompt] = generator.prompts
    expect(prompt).toEqual(buildPrompt(facts))
    const sent = JSON.parse(prompt.user.split('\n')[1]) as Record<
      string,
      unknown
    >
    expect(Object.keys(sent).sort()).toEqual(Object.keys(facts).sort())
    expect(prompt.user).not.toMatch(
      /address|direccion|owner|propietario|email|phone/i,
    )
  })
})

describe('FakeNarrator', () => {
  it('devuelve el texto configurado como si fuera del modelo', async () => {
    const result = await new FakeNarrator('Texto fijo').narrate(facts)
    expect(result).toEqual({
      text: 'Texto fijo',
      engine: ValuationEngineKind.STATISTICAL_LLM,
    })
  })
})
