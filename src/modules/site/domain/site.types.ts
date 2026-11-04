/**
 * Forma del contenido del sitio web. Espeja `packages/shared-types/src/site.ts`
 * del frontend (spec web-inmobiliaria, 5.1): si cambia uno, cambia el otro.
 */
export const SITE_TEMPLATE_KEYS = ['CLASSIC', 'MODERN'] as const
export type SiteTemplateKey = (typeof SITE_TEMPLATE_KEYS)[number]

export const SITE_SECTION_KEYS = [
  'hero',
  'steps',
  'featured',
  'metrics',
  'services',
  'testimonials',
  'faqs',
  'about',
  'contact',
] as const
export type SiteSectionKey = (typeof SITE_SECTION_KEYS)[number]

export const SOCIAL_NETWORKS = [
  'FACEBOOK',
  'INSTAGRAM',
  'LINKEDIN',
  'YOUTUBE',
  'TIKTOK',
  'X',
] as const
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]

export interface SiteTheme {
  primary: string
  secondary: string
  background: string
  surface: string
  text: string
  fontKey: string
  radius: number
}

export interface SiteContent {
  brand: {
    displayName: string
    tagline: string | null
    logoUrl: string | null
    faviconUrl: string | null
  }
  contact: {
    address: string | null
    hours: string | null
    phone: string | null
    whatsapp: string | null
    whatsappMessage: string | null
    email: string | null
    socials: { network: SocialNetwork; url: string }[]
  }
  hero: {
    title: string
    subtitle: string | null
    ctaLabel: string | null
    backgroundImageUrl: string | null
    showSearch: boolean
  }
  steps: { title: string; description: string; icon: string }[]
  featured: {
    title: string
    subtitle: string | null
    count: number
    mode: 'LATEST' | 'MANUAL'
    propertyIds: string[]
  }
  metrics: { value: string; label: string }[]
  services: { title: string; description: string; imageUrl: string | null }[]
  testimonials: {
    name: string
    text: string
    role: string | null
    photoUrl: string | null
  }[]
  faqs: { question: string; answer: string }[]
  about: { title: string; body: string | null; imageUrl: string | null }
  seo: { title: string; description: string; ogImageUrl: string | null }
  sections: { key: SiteSectionKey; visible: boolean }[]
}

export interface SiteSettingsDraft {
  template: SiteTemplateKey
  theme: SiteTheme
  content: SiteContent
}

export interface SiteTemplateInfo {
  key: SiteTemplateKey
  name: string
  description: string
  previewImageUrl: string | null
  defaultTheme: SiteTheme
  supportedSections: SiteSectionKey[]
  fontOptions: { key: string; label: string }[]
}

/** Claves de la lista cerrada de íconos de los pasos. */
export const STEP_ICONS = [
  'search',
  'home',
  'key',
  'handshake',
  'file-text',
  'calendar',
  'phone',
  'map-pin',
  'shield',
  'star',
  'camera',
  'smile',
] as const

/** Largos y cantidades máximas (spec 4.2 / 5.1). */
export const SITE_LIMITS = {
  displayName: 80,
  tagline: 120,
  address: 200,
  hours: 200,
  whatsappMessage: 300,
  email: 200,
  heroTitle: 120,
  heroSubtitle: 240,
  ctaLabel: 40,
  stepTitle: 80,
  stepDescription: 300,
  sectionTitle: 120,
  sectionSubtitle: 240,
  metricValue: 24,
  metricLabel: 80,
  serviceTitle: 80,
  serviceDescription: 500,
  testimonialName: 80,
  testimonialText: 600,
  testimonialRole: 80,
  faqQuestion: 200,
  faqAnswer: 1500,
  aboutBody: 3000,
  seoTitle: 70,
  seoDescription: 200,
  url: 1000,
  maxSocials: 6,
  maxSteps: 6,
  maxMetrics: 4,
  maxServices: 6,
  maxTestimonials: 12,
  maxFaqs: 20,
  maxFeatured: 12,
  minFeatured: 3,
} as const

export const THEME_RADII = [0, 8, 16, 24] as const
