/**
 * Normalización de datos de personas: propietarios, inquilinos y garantes
 * comparten nombre, DNI/CUIT, email y la búsqueda sin acentos. Son funciones
 * puras; cada módulo decide qué excepción lanzar cuando algo no cierra.
 */

/** Espacios de más y vacíos → null. */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\s+/g, ' ')
  return trimmed ? trimmed : null
}

export const PersonPolicy = {
  clean,

  normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, ' ')
  },

  /**
   * Texto de búsqueda: minúsculas y sin acentos, así "perez" encuentra a
   * "Pérez" (nadie tipea los acentos en un buscador).
   */
  searchKey(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
  },

  normalizeEmail(value: string | null | undefined): string | null {
    return clean(value)?.toLowerCase() ?? null
  },

  /**
   * DNI (7-8 dígitos) o CUIT/CUIL (11), sin puntos ni guiones: así
   * "20.123.456" y "20123456" son la misma persona para la unicidad. Null si
   * no es un documento válido; quien llama lanza su propia excepción.
   */
  parseNationalId(value: string): string | null {
    const digits = value.replace(/[\s.-]/g, '')
    return /^\d{7,11}$/.test(digits) ? digits : null
  },

  /** Las notas conservan los saltos de línea; sólo se recortan los bordes. */
  normalizeNotes(value: string | null | undefined): string | null {
    return value?.trim() || null
  },
}

export function fullNameOf(person: {
  firstName: string
  lastName: string
}): string {
  return `${person.firstName} ${person.lastName}`
}

/** Lo que se busca en cada palabra tipeada. */
export interface PersonSearchTerm {
  /** Contra `search_name`. */
  nameKey: string
  /** Contra el DNI/CUIT, si la palabra son dígitos (con o sin puntos). */
  digits: string | null
}

/**
 * Cada palabra tiene que aparecer en el nombre completo o en el DNI: así
 * "perez juan" encuentra a Juan Pérez. Los repositorios arman con esto un
 * `AND` de `OR`s.
 */
export function personSearchTerms(
  search: string | undefined,
): PersonSearchTerm[] {
  const words = search?.trim().split(/\s+/).filter(Boolean) ?? []
  return words.map((word) => {
    const digits = word.replace(/[.-]/g, '')
    return {
      nameKey: PersonPolicy.searchKey(word),
      digits: /^\d+$/.test(digits) ? digits : null,
    }
  })
}

/**
 * El `where` de Prisma para esos términos, sobre las columnas `searchName` y
 * `nationalId` que todas las tablas de personas tienen. Sin tipos de Prisma a
 * propósito (`shared` no conoce los modelos): es estructuralmente compatible
 * con el `WhereInput` de cada modelo.
 */
export function personSearchWhere(search: string | undefined): {
  AND?: {
    OR: (
      | { searchName: { contains: string } }
      | { nationalId: { contains: string } }
    )[]
  }[]
} {
  const terms = personSearchTerms(search)
  if (terms.length === 0) return {}
  return {
    AND: terms.map(({ nameKey, digits }) => ({
      OR: [
        { searchName: { contains: nameKey } },
        ...(digits ? [{ nationalId: { contains: digits } }] : []),
      ],
    })),
  }
}
