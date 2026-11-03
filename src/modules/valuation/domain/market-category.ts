import { MarketCategory } from './market'
import { slugify } from './zone-key'

/**
 * Sinónimos del nombre del tipo de propiedad (A-61): el tipo es por
 * inmobiliaria, la categoría de mercado es global. Se compara el nombre
 * normalizado y se elige la primera categoría cuya lista lo contenga.
 */
const SYNONYMS: [MarketCategory, string[]][] = [
  [MarketCategory.PH, ['ph', 'propiedad horizontal']],
  [
    MarketCategory.APARTMENT,
    [
      'departamento',
      'depto',
      'dpto',
      'monoambiente',
      'duplex',
      'loft',
      'piso',
      'semipiso',
      'apartment',
      'flat',
    ],
  ],
  [
    MarketCategory.HOUSE,
    ['casa', 'chalet', 'quinta', 'casaquinta', 'house', 'cabana', 'cabaña'],
  ],
  [MarketCategory.OFFICE, ['oficina', 'consultorio', 'office', 'coworking']],
  [
    MarketCategory.COMMERCIAL,
    [
      'local',
      'comercial',
      'galpon',
      'deposito',
      'fondo de comercio',
      'negocio',
    ],
  ],
  [MarketCategory.GARAGE, ['cochera', 'garage', 'garaje', 'estacionamiento']],
  [MarketCategory.LAND, ['terreno', 'lote', 'campo', 'land']],
]

/** La categoría de mercado de un tipo de propiedad; lo que no se reconoce es `OTHER`. */
export function categoryOfPropertyType(typeName: string): MarketCategory {
  const words = slugify(typeName).split('-').filter(Boolean)
  const whole = words.join(' ')
  for (const [category, names] of SYNONYMS) {
    for (const name of names) {
      const slug = slugify(name).replace(/-/g, ' ')
      if (
        whole === slug ||
        words.includes(slug) ||
        whole.startsWith(`${slug} `)
      )
        return category
    }
  }
  return MarketCategory.OTHER
}

/** Texto libre de una comodidad → clave comparable: `"Balcón"` → `"balcon"`. */
export function normalizeAmenity(text: string): string {
  return slugify(text).replace(/-/g, ' ')
}
