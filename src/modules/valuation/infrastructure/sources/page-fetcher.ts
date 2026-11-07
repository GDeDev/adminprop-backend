import { MarketSource } from '../../domain/market'
import { SourceBlockedError } from '../../domain/valuation.ports'

/** Una request cada 2,5 s por dominio (rediseño 4). */
export const MIN_INTERVAL_MS = 2_500
const ROBOTS_TTL_MS = 24 * 3_600_000
/** Reintentos ante 429/403 antes de dar la fuente por bloqueada. */
const MAX_BLOCK_RETRIES = 1
const BACKOFF_MS = 10_000
const ROBOTS_TOKEN = 'adminpropbot'

export interface PageFetcherOptions {
  contact: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

interface RobotsRules {
  rules: { allow: boolean; path: string }[]
  fetchedAt: number
}

/**
 * Lo que hace cortés a un scraper (rediseño 4): se identifica con un contacto,
 * lee robots.txt antes de pedir una ruta, espera entre requests al mismo
 * dominio y no insiste contra un 403/429 ni contra un captcha.
 */
export class PageFetcher {
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly lastRequestAt = new Map<string, number>()
  private readonly robots = new Map<string, RobotsRules>()

  constructor(private readonly options: PageFetcherOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.now = options.now ?? Date.now
  }

  get userAgent(): string {
    return `AdminpropBot/1.0 (+${this.options.contact})`
  }

  async get(source: MarketSource, url: string): Promise<string> {
    const target = new URL(url)
    if (!(await this.isAllowed(source, target))) {
      throw new SourceBlockedError(
        source,
        `robots.txt no permite ${target.pathname}`,
      )
    }

    for (let attempt = 0; ; attempt += 1) {
      await this.throttle(target.host)
      const response = await this.fetchImpl(url, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept-Language': 'es-AR,es;q=0.9',
          Accept: 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      })
      this.lastRequestAt.set(target.host, this.now())

      if (response.status === 403 || response.status === 429) {
        if (attempt >= MAX_BLOCK_RETRIES) {
          throw new SourceBlockedError(source, `HTTP ${response.status}`)
        }
        await this.sleep(BACKOFF_MS * 2 ** attempt)
        continue
      }
      if (!response.ok) {
        throw new Error(`${source}: HTTP ${response.status}`)
      }
      const body = await response.text()
      if (
        /captcha|cf-challenge|are you a robot/i.test(body) &&
        body.length < 20_000
      ) {
        throw new SourceBlockedError(source, 'captcha')
      }
      return body
    }
  }

  private async throttle(host: string): Promise<void> {
    const last = this.lastRequestAt.get(host)
    if (last === undefined) return
    const wait = last + MIN_INTERVAL_MS - this.now()
    if (wait > 0) await this.sleep(wait)
  }

  private async isAllowed(source: MarketSource, target: URL): Promise<boolean> {
    let robots = this.robots.get(target.origin)
    if (!robots || this.now() - robots.fetchedAt > ROBOTS_TTL_MS) {
      robots = await this.loadRobots(source, target.origin)
      this.robots.set(target.origin, robots)
    }
    return isPathAllowed(robots.rules, target.pathname + target.search)
  }

  private async loadRobots(
    source: MarketSource,
    origin: string,
  ): Promise<RobotsRules> {
    await this.throttle(new URL(origin).host)
    let text = ''
    try {
      const response = await this.fetchImpl(`${origin}/robots.txt`, {
        headers: { 'User-Agent': this.userAgent },
      })
      this.lastRequestAt.set(new URL(origin).host, this.now())
      // Sin robots.txt (404) se puede leer; si el sitio nos corta, es bloqueo.
      if (response.status === 401 || response.status === 403) {
        throw new SourceBlockedError(
          source,
          `robots.txt devolvió ${response.status}`,
        )
      }
      if (response.ok) text = await response.text()
    } catch (error) {
      if (error instanceof SourceBlockedError) throw error
      // Sin red no hay forma de saber qué permite: no se scrapea.
      throw new SourceBlockedError(source, 'no se pudo leer robots.txt')
    }
    return { rules: parseRobots(text), fetchedAt: this.now() }
  }
}

/** Reglas del grupo que nos nombra, o las de `*` si ninguno lo hace. */
export function parseRobots(text: string): { allow: boolean; path: string }[] {
  const groups: {
    agents: string[]
    rules: { allow: boolean; path: string }[]
  }[] = []
  let current: (typeof groups)[number] | null = null
  let lastWasAgent = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim()
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else if ((key === 'allow' || key === 'disallow') && current) {
      lastWasAgent = false
      if (value) current.rules.push({ allow: key === 'allow', path: value })
    } else {
      lastWasAgent = false
    }
  }
  const own = groups.find((g) => g.agents.includes(ROBOTS_TOKEN))
  const star = groups.find((g) => g.agents.includes('*'))
  return (own ?? star)?.rules ?? []
}

/** La regla más larga que coincide gana; a igual largo, `Allow`. */
export function isPathAllowed(
  rules: { allow: boolean; path: string }[],
  path: string,
): boolean {
  let best: { allow: boolean; length: number } | null = null
  for (const rule of rules) {
    const pattern = rule.path.replace(/\$$/, '')
    const anchored = rule.path.endsWith('$')
    const regex = new RegExp(
      '^' +
        pattern.split('*').map(escapeRegex).join('.*') +
        (anchored ? '$' : ''),
    )
    if (!regex.test(path)) continue
    if (
      !best ||
      rule.path.length > best.length ||
      (rule.path.length === best.length && rule.allow)
    ) {
      best = { allow: rule.allow, length: rule.path.length }
    }
  }
  return best ? best.allow : true
}

function escapeRegex(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}
