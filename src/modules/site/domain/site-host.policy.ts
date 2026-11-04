/** Subdominios que nunca se le dan a una inmobiliaria. */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www',
  'api',
  'app',
  'admin',
  'portal',
  'sites',
  'site',
  'mail',
  'email',
  'smtp',
  'ftp',
  'static',
  'assets',
  'cdn',
  'dev',
  'qa',
  'staging',
  'test',
  'demo',
  'status',
  'help',
  'support',
  'soporte',
  'backoffice',
  'dashboard',
  'login',
  'adminprop',
])

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

export type HostCheck =
  { ok: true; value: string } | { ok: false; reason: string }

/** Reglas puras de subdominios y dominios propios. */
export const SiteHostPolicy = {
  /** "  Mi-Inmo " → "mi-inmo". */
  normalizeSubdomain(raw: string): string {
    return raw.trim().toLowerCase()
  },

  checkSubdomain(raw: string): HostCheck {
    const value = SiteHostPolicy.normalizeSubdomain(raw)
    if (value.length < 3 || value.length > 63) {
      return { ok: false, reason: 'Tiene que tener entre 3 y 63 caracteres.' }
    }
    if (!SUBDOMAIN.test(value) || value.includes('--')) {
      return {
        ok: false,
        reason:
          'Usá solo letras minúsculas, números y guiones, sin empezar ni terminar con guion.',
      }
    }
    if (RESERVED_SUBDOMAINS.has(value)) {
      return { ok: false, reason: 'Ese nombre está reservado. Probá con otro.' }
    }
    return { ok: true, value }
  },

  /** Host de un pedido: minúsculas, sin puerto ni punto final. */
  normalizeHost(raw: string): string {
    return raw.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
  },

  /**
   * Dominio propio válido: nombre de dominio completo (al menos dos etiquetas),
   * sin esquema ni ruta, que no sea una IP ni cuelgue del dominio base del
   * sistema (ese espacio se reparte con subdominios).
   */
  checkCustomDomain(raw: string, baseDomain: string | null): HostCheck {
    const value = SiteHostPolicy.normalizeHost(raw)
    const labels = value.split('.')
    if (
      value.length > 253 ||
      labels.length < 2 ||
      !labels.every((l) => LABEL.test(l)) ||
      IPV4.test(value) ||
      /^\d+$/.test(labels[labels.length - 1])
    ) {
      return {
        ok: false,
        reason:
          'Ingresá solo el dominio, por ejemplo www.tuinmobiliaria.com.ar (sin https:// ni barras).',
      }
    }
    if (
      baseDomain &&
      (value === baseDomain || value.endsWith(`.${baseDomain}`))
    ) {
      return {
        ok: false,
        reason: 'Ese dominio pertenece a Adminprop. Usá el subdominio.',
      }
    }
    if (value === 'localhost' || value.endsWith('.localhost')) {
      return { ok: false, reason: 'Ese dominio no es válido.' }
    }
    return { ok: true, value }
  },

  /**
   * ¿El host es `<sub>.<baseDomain>`? Devuelve la etiqueta, o null si es otro
   * dominio (propio) o el apex.
   */
  subdomainOf(host: string, baseDomain: string | null): string | null {
    if (!baseDomain || !host.endsWith(`.${baseDomain}`)) return null
    const label = host.slice(0, -(baseDomain.length + 1))
    return label && !label.includes('.') ? label : null
  },
}
