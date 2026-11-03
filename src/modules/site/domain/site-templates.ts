import { contrastRatio, HEX_COLOR } from './color'
import {
  SITE_SECTION_KEYS,
  SiteContent,
  SiteSettingsDraft,
  SiteTemplateInfo,
  SiteTemplateKey,
  SiteTheme,
} from './site.types'

/** Lo que el sitio sabe de la inmobiliaria para armar su contenido inicial. */
export interface SiteTenantData {
  name: string
  logoUrl: string | null
  primaryColor: string | null
  phone: string | null
  whatsapp: string | null
  address: string | null
  email: string | null
}

/**
 * Pilas de fuentes del sistema: cero descargas (rendimiento y privacidad). El
 * sitio las traduce a CSS por `fontKey`.
 */
const FONT_OPTIONS = {
  CLASSIC: [
    { key: 'system', label: 'Moderna (sans del sistema)' },
    { key: 'serif', label: 'Clásica (serif)' },
    { key: 'humanist', label: 'Humanista' },
  ],
  MODERN: [
    { key: 'system', label: 'Moderna (sans del sistema)' },
    { key: 'humanist', label: 'Humanista' },
    { key: 'rounded', label: 'Redondeada' },
  ],
} as const

const DEFAULT_THEMES: Record<SiteTemplateKey, SiteTheme> = {
  // Tierra/oscuro, como el sitio de referencia.
  CLASSIC: {
    primary: '#B6A28E',
    secondary: '#5F6F65',
    background: '#181C14',
    surface: '#3C3D37',
    text: '#F4F1EC',
    fontKey: 'system',
    radius: 8,
  },
  // Claro y limpio, un solo acento.
  MODERN: {
    primary: '#1D4ED8',
    secondary: '#475569',
    background: '#FFFFFF',
    surface: '#F1F5F9',
    text: '#0F172A',
    fontKey: 'system',
    radius: 16,
  },
}

const INFO: Record<
  SiteTemplateKey,
  Omit<SiteTemplateInfo, 'defaultTheme' | 'fontOptions'>
> = {
  CLASSIC: {
    key: 'CLASSIC',
    name: 'Clásico',
    description:
      'Oscuro y cálido. Hero a pantalla completa con el buscador en una tarjeta translúcida y secciones que aparecen con suavidad.',
    previewImageUrl: null,
    supportedSections: [...SITE_SECTION_KEYS],
  },
  MODERN: {
    key: 'MODERN',
    name: 'Moderno',
    description:
      'Claro y limpio. Barra de búsqueda horizontal, tipografía grande y tarjetas con aire. Muy legible en el celular.',
    previewImageUrl: null,
    supportedSections: [...SITE_SECTION_KEYS],
  },
}

export function templateInfo(key: SiteTemplateKey): SiteTemplateInfo {
  return {
    ...INFO[key],
    defaultTheme: { ...DEFAULT_THEMES[key] },
    fontOptions: FONT_OPTIONS[key].map((o) => ({ ...o })),
  }
}

export function allTemplates(): SiteTemplateInfo[] {
  return (['CLASSIC', 'MODERN'] as const).map(templateInfo)
}

export function defaultTheme(key: SiteTemplateKey): SiteTheme {
  return { ...DEFAULT_THEMES[key] }
}

/**
 * Tema inicial: el del template, con el color de marca de la inmobiliaria si
 * se lee bien sobre el fondo del template (contraste mínimo 3:1, el piso de
 * AA para elementos de interfaz). Un color que no se ve no se aplica.
 */
export function themeFor(
  key: SiteTemplateKey,
  brandColor: string | null,
): SiteTheme {
  const theme = defaultTheme(key)
  if (
    brandColor &&
    HEX_COLOR.test(brandColor) &&
    contrastRatio(brandColor, theme.background) >= 3
  ) {
    theme.primary = brandColor.toUpperCase()
  }
  return theme
}

/** Contenido inicial: genérico y editable; nada propio de ninguna inmobiliaria. */
export function defaultContent(tenant: SiteTenantData): SiteContent {
  const name = tenant.name.trim().slice(0, 80) || 'Mi inmobiliaria'
  const whatsapp =
    tenant.whatsapp && /^\d{8,15}$/.test(tenant.whatsapp)
      ? tenant.whatsapp
      : null
  const hasContact = Boolean(
    whatsapp || tenant.phone || tenant.email || tenant.address,
  )
  return {
    brand: {
      displayName: name,
      tagline: null,
      logoUrl: null,
      faviconUrl: null,
    },
    contact: {
      address: tenant.address?.slice(0, 200) ?? null,
      hours: null,
      phone: tenant.phone?.slice(0, 40) ?? null,
      whatsapp,
      whatsappMessage: whatsapp
        ? `Hola ${name}, quiero hacerles una consulta.`.slice(0, 300)
        : null,
      email: tenant.email?.slice(0, 200) ?? null,
      socials: [],
    },
    hero: {
      title: 'Propiedades a tu medida.',
      subtitle:
        'Descubrí las mejores oportunidades de compra y alquiler que tenemos para vos.',
      ctaLabel: whatsapp ? 'Contactanos hoy' : null,
      backgroundImageUrl: null,
      showSearch: true,
    },
    steps: [
      {
        title: 'Buscá',
        description:
          'Explorá nuestras propiedades y filtrá por operación, tipo, zona y precio.',
        icon: 'search',
      },
      {
        title: 'Encontrá',
        description: 'Mirá las fotos y los detalles de cada propiedad.',
        icon: 'home',
      },
      {
        title: 'Consultanos',
        description: 'Escribinos y te acompañamos en cada paso.',
        icon: 'phone',
      },
      {
        title: 'Disfrutá',
        description: 'Mudate y empezá esta nueva etapa.',
        icon: 'key',
      },
    ],
    featured: {
      title: 'Propiedades destacadas',
      subtitle: 'Las últimas que sumamos a nuestra cartera.',
      count: 6,
      mode: 'LATEST',
      propertyIds: [],
    },
    metrics: [],
    services: [
      {
        title: 'Alquiler',
        description:
          'Te ayudamos a encontrar la propiedad ideal y nos ocupamos del contrato.',
        imageUrl: null,
      },
      {
        title: 'Venta',
        description:
          'Acompañamos todo el proceso de compra o de venta, con asesoramiento personalizado.',
        imageUrl: null,
      },
      {
        title: 'Tasaciones',
        description:
          'Conocé el valor de tu propiedad con una tasación profesional.',
        imageUrl: null,
      },
    ],
    testimonials: [],
    faqs: [
      {
        question: '¿Qué documentación necesito para alquilar?',
        answer:
          'Te pedimos tus datos personales, comprobantes de ingresos y la información de tu garantía. Consultanos y te pasamos el detalle completo.',
      },
      {
        question: '¿Cómo pongo mi propiedad en alquiler o en venta?',
        answer:
          'Escribinos por WhatsApp o desde el formulario de contacto y coordinamos una visita para tasar y publicar tu propiedad.',
      },
      {
        question: '¿Puedo coordinar una visita?',
        answer:
          'Sí. Elegí la propiedad que te interesa y consultanos: te proponemos días y horarios.',
      },
    ],
    about: { title: 'Sobre nosotros', body: null, imageUrl: null },
    seo: {
      title: `${name} | Propiedades en venta y alquiler`.slice(0, 70),
      description:
        `Encontrá tu próxima propiedad con ${name}. Alquileres y ventas con atención personalizada.`.slice(
          0,
          200,
        ),
      ogImageUrl: null,
    },
    sections: [
      { key: 'hero', visible: true },
      { key: 'steps', visible: true },
      { key: 'featured', visible: true },
      { key: 'services', visible: true },
      { key: 'metrics', visible: false },
      { key: 'testimonials', visible: false },
      { key: 'faqs', visible: true },
      { key: 'about', visible: false },
      // Sin ningún dato de contacto la sección quedaría vacía y no se podría publicar.
      { key: 'contact', visible: hasContact },
    ],
  }
}

export function defaultDraft(
  template: SiteTemplateKey,
  tenant: SiteTenantData,
): SiteSettingsDraft {
  return {
    template,
    theme: themeFor(template, tenant.primaryColor),
    content: defaultContent(tenant),
  }
}
