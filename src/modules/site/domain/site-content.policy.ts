import { contrastRatio, HEX_COLOR } from './color'
import {
  SITE_LIMITS as L,
  SITE_SECTION_KEYS,
  SITE_TEMPLATE_KEYS,
  SOCIAL_NETWORKS,
  STEP_ICONS,
  SiteContent,
  SiteSectionKey,
  SiteSettingsDraft,
  SiteTemplateKey,
  SiteTheme,
  SocialNetwork,
  THEME_RADII,
} from './site.types'

export interface SiteFieldError {
  field: string
  message: string
}

/** Lo que la validación necesita saber del entorno (tenant, template). */
export interface SiteValidationContext {
  /** Claves de fuente que admite el template elegido. */
  fontKeys: string[]
  /** Secciones que admite el template elegido. */
  supportedSections: SiteSectionKey[]
  /** ¿La URL de imagen es nuestra (assets del tenant, logo) o de un host permitido? */
  isAllowedImageUrl: (url: string) => boolean
}

export type SiteValidation =
  | { ok: true; value: SiteSettingsDraft }
  | { ok: false; errors: SiteFieldError[] }

/** Etiqueta HTML (`<b`, `</`, `<!--`, `<?`): el contenido es texto plano. */
const TAG = /<\s*[a-zA-Z/!?]/
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
/**
 * Caracteres invisibles o que cambian el sentido de lectura: espacios de ancho
 * cero, marcas de dirección y controles bidi. Sirven para disfrazar un texto (un
 * link que "dice" otra cosa) y nadie los escribe a propósito en un sitio.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/
const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/
const PHONE = /^[0-9+()\-.\s]{6,30}$/
const WHATSAPP = /^\d{8,15}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Dominios aceptados por red social: evita que un "Instagram" apunte a otro sitio. */
const SOCIAL_HOSTS: Record<SocialNetwork, string[]> = {
  FACEBOOK: ['facebook.com', 'fb.com', 'fb.me'],
  INSTAGRAM: ['instagram.com', 'instagr.am'],
  LINKEDIN: ['linkedin.com', 'lnkd.in'],
  YOUTUBE: ['youtube.com', 'youtu.be'],
  TIKTOK: ['tiktok.com'],
  X: ['x.com', 'twitter.com'],
}

const CONTENT_KEYS = [
  'brand',
  'contact',
  'hero',
  'steps',
  'featured',
  'metrics',
  'services',
  'testimonials',
  'faqs',
  'about',
  'seo',
  'sections',
] as const

const THEME_KEYS = [
  'primary',
  'secondary',
  'background',
  'surface',
  'text',
  'fontKey',
  'radius',
] as const

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Valida y normaliza un borrador completo. Nada de lo que no esté en la forma
 * del contrato pasa (claves de más son error), todo texto es plano y las URLs
 * son https de hosts conocidos (spec 4.2).
 *
 * Con `forPublish` se exige además que el sitio esté completo y legible: ninguna
 * sección visible vacía y contraste AA entre el texto y sus fondos.
 */
export function validateSiteDraft(
  input: unknown,
  ctx: SiteValidationContext,
  options: { forPublish?: boolean } = {},
): SiteValidation {
  const errors: SiteFieldError[] = []
  const err = (field: string, message: string) =>
    errors.push({ field, message })
  const forPublish = options.forPublish === true

  // ------------------------------------------------------------ primitivos
  function exact(path: string, o: Obj, keys: readonly string[]): boolean {
    let ok = true
    for (const key of Object.keys(o)) {
      if (!keys.includes(key)) {
        err(`${path}.${key}`, 'Este campo no existe.')
        ok = false
      }
    }
    return ok
  }

  function str(
    path: string,
    v: unknown,
    max: number,
    opts: { nullable?: boolean; required?: boolean; multiline?: boolean } = {},
  ): string | null {
    if (v === null || v === undefined || v === '') {
      if (opts.required) err(path, 'Es obligatorio.')
      else if (!opts.nullable && v === undefined) err(path, 'Falta este campo.')
      return null
    }
    if (typeof v !== 'string') {
      err(path, 'Tiene que ser un texto.')
      return null
    }
    const text = v.replace(/\r\n?/g, '\n').trim()
    if (!text) {
      if (opts.required) err(path, 'Es obligatorio.')
      return null
    }
    if (text.length > max) {
      err(path, `Tiene que tener como máximo ${max} caracteres.`)
      return null
    }
    if (TAG.test(text) || CONTROL.test(text)) {
      err(path, 'Solo se admite texto plano, sin código ni etiquetas.')
      return null
    }
    if (INVISIBLE.test(text)) {
      err(
        path,
        'El texto tiene caracteres invisibles o de dirección: borralos.',
      )
      return null
    }
    if (!opts.multiline && text.includes('\n')) {
      err(path, 'No admite saltos de línea.')
      return null
    }
    return text
  }

  function req(path: string, v: unknown, max: number, multiline = false) {
    return str(path, v, max, { required: true, multiline }) ?? ''
  }

  function httpsUrl(path: string, v: unknown): URL | null {
    const text = str(path, v, L.url, { required: true })
    if (text === null) return null
    try {
      const url = new URL(text)
      if (url.protocol !== 'https:' || url.username || url.password) throw 0
      return url
    } catch {
      err(path, 'Tiene que ser un link https:// válido.')
      return null
    }
  }

  function image(path: string, v: unknown): string | null {
    const text = str(path, v, L.url, { nullable: true })
    if (text === null) return null
    if (!ctx.isAllowedImageUrl(text)) {
      err(
        path,
        'La imagen tiene que subirse desde el editor (o ser de un sitio habilitado).',
      )
      return null
    }
    return text
  }

  function list(path: string, v: unknown, max: number): unknown[] {
    if (!Array.isArray(v)) {
      err(path, 'Tiene que ser una lista.')
      return []
    }
    if (v.length > max) {
      err(path, `Admite como máximo ${max} elementos.`)
      return []
    }
    return v
  }

  function item(path: string, v: unknown, keys: readonly string[]): Obj | null {
    if (!isObj(v)) {
      err(path, 'Tiene que ser un objeto.')
      return null
    }
    return exact(path, v, keys) ? v : null
  }

  // ---------------------------------------------------------------- raíz
  if (!isObj(input)) {
    return { ok: false, errors: [{ field: '', message: 'Borrador inválido.' }] }
  }
  exact('', input, ['template', 'theme', 'content'])

  const template = input.template as SiteTemplateKey
  if (!SITE_TEMPLATE_KEYS.includes(template)) {
    err('template', 'El template no es válido.')
  }

  // --------------------------------------------------------------- tema
  const theme = {} as SiteTheme
  const t = input.theme
  if (!isObj(t)) {
    err('theme', 'Falta el tema.')
  } else if (exact('theme', t, THEME_KEYS)) {
    for (const key of [
      'primary',
      'secondary',
      'background',
      'surface',
      'text',
    ] as const) {
      const v = t[key]
      if (typeof v !== 'string' || !HEX_COLOR.test(v)) {
        err(`theme.${key}`, 'Tiene que ser un color #RRGGBB.')
      } else {
        theme[key] = v.toUpperCase()
      }
    }
    if (typeof t.fontKey !== 'string' || !ctx.fontKeys.includes(t.fontKey)) {
      err(
        'theme.fontKey',
        'Esa tipografía no está disponible en este template.',
      )
    } else {
      theme.fontKey = t.fontKey
    }
    if (!THEME_RADII.includes(t.radius as 0)) {
      err(
        'theme.radius',
        `Las esquinas pueden ser ${THEME_RADII.join(', ')} px.`,
      )
    } else {
      theme.radius = t.radius as number
    }
  }

  // ----------------------------------------------------------- contenido
  const c = input.content
  const content = {} as SiteContent
  if (!isObj(c)) {
    err('content', 'Falta el contenido.')
  } else if (exact('content', c, CONTENT_KEYS)) {
    // brand
    if (
      isObj(c.brand) &&
      exact('content.brand', c.brand, [
        'displayName',
        'tagline',
        'logoUrl',
        'faviconUrl',
      ])
    ) {
      content.brand = {
        displayName: req(
          'content.brand.displayName',
          c.brand.displayName,
          L.displayName,
        ),
        tagline: str('content.brand.tagline', c.brand.tagline, L.tagline, {
          nullable: true,
        }),
        logoUrl: image('content.brand.logoUrl', c.brand.logoUrl),
        faviconUrl: image('content.brand.faviconUrl', c.brand.faviconUrl),
      }
    } else if (!isObj(c.brand)) err('content.brand', 'Falta este bloque.')

    // contact
    const k = c.contact
    if (
      isObj(k) &&
      exact('content.contact', k, [
        'address',
        'hours',
        'phone',
        'whatsapp',
        'whatsappMessage',
        'email',
        'socials',
      ])
    ) {
      const phone = str('content.contact.phone', k.phone, 30, {
        nullable: true,
      })
      if (phone && !PHONE.test(phone))
        err('content.contact.phone', 'El teléfono no es válido.')
      const whatsapp = str('content.contact.whatsapp', k.whatsapp, 15, {
        nullable: true,
      })
      if (whatsapp && !WHATSAPP.test(whatsapp)) {
        err(
          'content.contact.whatsapp',
          'Ingresá solo dígitos, con código de país (ej. 5492215551234).',
        )
      }
      const email = str('content.contact.email', k.email, L.email, {
        nullable: true,
      })
      if (email && !EMAIL.test(email))
        err('content.contact.email', 'El email no es válido.')
      const socials: SiteContent['contact']['socials'] = []
      list('content.contact.socials', k.socials, L.maxSocials).forEach(
        (raw, i) => {
          const path = `content.contact.socials[${i}]`
          const s = item(path, raw, ['network', 'url'])
          if (!s) return
          if (!SOCIAL_NETWORKS.includes(s.network as SocialNetwork)) {
            err(`${path}.network`, 'La red social no es válida.')
            return
          }
          const network = s.network as SocialNetwork
          const url = httpsUrl(`${path}.url`, s.url)
          if (!url) return
          const host = url.hostname.toLowerCase()
          if (
            !SOCIAL_HOSTS[network].some(
              (d) => host === d || host.endsWith(`.${d}`),
            )
          ) {
            err(
              `${path}.url`,
              `El link tiene que ser de ${SOCIAL_HOSTS[network][0]}.`,
            )
            return
          }
          socials.push({ network, url: url.toString() })
        },
      )
      content.contact = {
        address: str('content.contact.address', k.address, L.address, {
          nullable: true,
        }),
        hours: str('content.contact.hours', k.hours, L.hours, {
          nullable: true,
        }),
        phone,
        whatsapp,
        whatsappMessage: str(
          'content.contact.whatsappMessage',
          k.whatsappMessage,
          L.whatsappMessage,
          { nullable: true, multiline: true },
        ),
        email,
        socials,
      }
    } else if (!isObj(k)) err('content.contact', 'Falta este bloque.')

    // hero
    const h = c.hero
    if (
      isObj(h) &&
      exact('content.hero', h, [
        'title',
        'subtitle',
        'ctaLabel',
        'backgroundImageUrl',
        'showSearch',
      ])
    ) {
      if (typeof h.showSearch !== 'boolean')
        err('content.hero.showSearch', 'Tiene que ser sí o no.')
      content.hero = {
        title: req('content.hero.title', h.title, L.heroTitle),
        subtitle: str('content.hero.subtitle', h.subtitle, L.heroSubtitle, {
          nullable: true,
        }),
        ctaLabel: str('content.hero.ctaLabel', h.ctaLabel, L.ctaLabel, {
          nullable: true,
        }),
        backgroundImageUrl: image(
          'content.hero.backgroundImageUrl',
          h.backgroundImageUrl,
        ),
        showSearch: h.showSearch === true,
      }
    } else if (!isObj(h)) err('content.hero', 'Falta este bloque.')

    // steps
    content.steps = []
    list('content.steps', c.steps, L.maxSteps).forEach((raw, i) => {
      const path = `content.steps[${i}]`
      const s = item(path, raw, ['title', 'description', 'icon'])
      if (!s) return
      if (!STEP_ICONS.includes(s.icon as (typeof STEP_ICONS)[number])) {
        err(`${path}.icon`, 'Ese ícono no está en la lista.')
      }
      content.steps.push({
        title: req(`${path}.title`, s.title, L.stepTitle),
        description: req(
          `${path}.description`,
          s.description,
          L.stepDescription,
          true,
        ),
        icon: String(s.icon),
      })
    })

    // featured
    const f = c.featured
    if (
      isObj(f) &&
      exact('content.featured', f, [
        'title',
        'subtitle',
        'count',
        'mode',
        'propertyIds',
      ])
    ) {
      if (
        !Number.isInteger(f.count) ||
        (f.count as number) < L.minFeatured ||
        (f.count as number) > L.maxFeatured
      ) {
        err(
          'content.featured.count',
          `Tiene que ser un número entre ${L.minFeatured} y ${L.maxFeatured}.`,
        )
      }
      if (f.mode !== 'LATEST' && f.mode !== 'MANUAL')
        err('content.featured.mode', 'El modo no es válido.')
      const ids: string[] = []
      list(
        'content.featured.propertyIds',
        f.propertyIds,
        L.maxFeatured,
      ).forEach((id, i) => {
        if (typeof id !== 'string' || !UUID.test(id))
          err(
            `content.featured.propertyIds[${i}]`,
            'No es una propiedad válida.',
          )
        else if (!ids.includes(id.toLowerCase())) ids.push(id.toLowerCase())
      })
      content.featured = {
        title: req('content.featured.title', f.title, L.sectionTitle),
        subtitle: str(
          'content.featured.subtitle',
          f.subtitle,
          L.sectionSubtitle,
          { nullable: true },
        ),
        count: Number(f.count),
        mode: f.mode as 'LATEST' | 'MANUAL',
        propertyIds: ids,
      }
    } else if (!isObj(f)) err('content.featured', 'Falta este bloque.')

    // metrics
    content.metrics = []
    list('content.metrics', c.metrics, L.maxMetrics).forEach((raw, i) => {
      const path = `content.metrics[${i}]`
      const m = item(path, raw, ['value', 'label'])
      if (m)
        content.metrics.push({
          value: req(`${path}.value`, m.value, L.metricValue),
          label: req(`${path}.label`, m.label, L.metricLabel),
        })
    })

    // services
    content.services = []
    list('content.services', c.services, L.maxServices).forEach((raw, i) => {
      const path = `content.services[${i}]`
      const s = item(path, raw, ['title', 'description', 'imageUrl'])
      if (s) {
        content.services.push({
          title: req(`${path}.title`, s.title, L.serviceTitle),
          description: req(
            `${path}.description`,
            s.description,
            L.serviceDescription,
            true,
          ),
          imageUrl: image(`${path}.imageUrl`, s.imageUrl),
        })
      }
    })

    // testimonials
    content.testimonials = []
    list('content.testimonials', c.testimonials, L.maxTestimonials).forEach(
      (raw, i) => {
        const path = `content.testimonials[${i}]`
        const s = item(path, raw, ['name', 'text', 'role', 'photoUrl'])
        if (s) {
          content.testimonials.push({
            name: req(`${path}.name`, s.name, L.testimonialName),
            text: req(`${path}.text`, s.text, L.testimonialText, true),
            role: str(`${path}.role`, s.role, L.testimonialRole, {
              nullable: true,
            }),
            photoUrl: image(`${path}.photoUrl`, s.photoUrl),
          })
        }
      },
    )

    // faqs
    content.faqs = []
    list('content.faqs', c.faqs, L.maxFaqs).forEach((raw, i) => {
      const path = `content.faqs[${i}]`
      const s = item(path, raw, ['question', 'answer'])
      if (s)
        content.faqs.push({
          question: req(`${path}.question`, s.question, L.faqQuestion),
          answer: req(`${path}.answer`, s.answer, L.faqAnswer, true),
        })
    })

    // about
    const a = c.about
    if (isObj(a) && exact('content.about', a, ['title', 'body', 'imageUrl'])) {
      content.about = {
        title: req('content.about.title', a.title, L.sectionTitle),
        body: str('content.about.body', a.body, L.aboutBody, {
          nullable: true,
          multiline: true,
        }),
        imageUrl: image('content.about.imageUrl', a.imageUrl),
      }
    } else if (!isObj(a)) err('content.about', 'Falta este bloque.')

    // seo
    const s = c.seo
    if (
      isObj(s) &&
      exact('content.seo', s, ['title', 'description', 'ogImageUrl'])
    ) {
      content.seo = {
        title: forPublish
          ? req('content.seo.title', s.title, L.seoTitle)
          : (str('content.seo.title', s.title, L.seoTitle, {
              nullable: true,
            }) ?? ''),
        description: forPublish
          ? req(
              'content.seo.description',
              s.description,
              L.seoDescription,
              true,
            )
          : (str('content.seo.description', s.description, L.seoDescription, {
              nullable: true,
              multiline: true,
            }) ?? ''),
        ogImageUrl: image('content.seo.ogImageUrl', s.ogImageUrl),
      }
    } else if (!isObj(s)) err('content.seo', 'Falta este bloque.')

    // sections
    content.sections = []
    const seen = new Set<string>()
    list('content.sections', c.sections, SITE_SECTION_KEYS.length).forEach(
      (raw, i) => {
        const path = `content.sections[${i}]`
        const s = item(path, raw, ['key', 'visible'])
        if (!s) return
        const key = s.key as SiteSectionKey
        if (!ctx.supportedSections.includes(key))
          err(`${path}.key`, 'Ese template no tiene esa sección.')
        else if (seen.has(key)) err(`${path}.key`, 'La sección está repetida.')
        else seen.add(key)
        if (typeof s.visible !== 'boolean')
          err(`${path}.visible`, 'Tiene que ser sí o no.')
        content.sections.push({ key, visible: s.visible === true })
      },
    )
  }

  // También con otros errores: el editor muestra todo lo que falta de una vez.
  // Solo si el tema y el contenido llegaron enteros (si no, ya hay errores de forma).
  if (
    forPublish &&
    Object.keys(theme).length === THEME_KEYS.length &&
    CONTENT_KEYS.every((key) => key in content)
  ) {
    publishChecks(theme, content, err)
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: { template, theme, content } }
}

/** Un sitio publicado tiene que estar completo y poder leerse (AA). */
function publishChecks(
  theme: SiteTheme,
  content: SiteContent,
  err: (field: string, message: string) => void,
): void {
  const visible = new Set(
    content.sections.filter((s) => s.visible).map((s) => s.key),
  )
  const empty = (field: string, label: string) =>
    err(
      field,
      `La sección "${label}" está visible pero vacía: completala o ocultala.`,
    )

  if (visible.has('steps') && content.steps.length === 0)
    empty('content.steps', 'Pasos')
  if (visible.has('metrics') && content.metrics.length === 0)
    empty('content.metrics', 'Números')
  if (visible.has('services') && content.services.length === 0)
    empty('content.services', 'Servicios')
  if (visible.has('testimonials') && content.testimonials.length === 0)
    empty('content.testimonials', 'Testimonios')
  if (visible.has('faqs') && content.faqs.length === 0)
    empty('content.faqs', 'Preguntas frecuentes')
  if (visible.has('about') && !content.about.body)
    empty('content.about.body', 'Nosotros')
  if (
    visible.has('featured') &&
    content.featured.mode === 'MANUAL' &&
    content.featured.propertyIds.length === 0
  ) {
    err(
      'content.featured.propertyIds',
      'Elegí al menos una propiedad o usá "Las últimas".',
    )
  }
  const k = content.contact
  if (
    visible.has('contact') &&
    !(k.phone || k.whatsapp || k.email || k.address)
  ) {
    empty('content.contact', 'Contacto')
  }

  if (contrastRatio(theme.text, theme.background) < 4.5) {
    err(
      'theme.text',
      'El texto no se lee bien sobre el fondo (contraste AA mínimo 4,5:1).',
    )
  }
  if (contrastRatio(theme.text, theme.surface) < 4.5) {
    err(
      'theme.surface',
      'El texto no se lee bien sobre las tarjetas (contraste AA mínimo 4,5:1).',
    )
  }
  if (contrastRatio(theme.primary, theme.background) < 3) {
    err(
      'theme.primary',
      'El color principal casi no se distingue del fondo (contraste mínimo 3:1).',
    )
  }
}

/**
 * Aplica un cambio parcial al borrador: `template` se reemplaza; `theme` se
 * mezcla campo a campo; en `content` cada bloque (brand, hero, steps…) se
 * reemplaza entero. El resultado se valida completo afuera.
 */
export function mergeDraft(
  current: SiteSettingsDraft,
  patch: { template?: unknown; theme?: unknown; content?: unknown },
): unknown {
  const merged: Obj = {
    template: patch.template ?? current.template,
    theme: isObj(patch.theme)
      ? { ...current.theme, ...patch.theme }
      : (patch.theme ?? current.theme),
    content: isObj(patch.content)
      ? { ...current.content, ...patch.content }
      : (patch.content ?? current.content),
  }
  return merged
}

/** Comparación estable de dos borradores (el orden de las claves no cuenta). */
export function sameDraft(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b)
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (isObj(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
