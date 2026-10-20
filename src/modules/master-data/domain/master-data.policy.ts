import { LEVEL_DEPTH, Location, LocationLevel, LocationNode } from './location'
import { InvalidLocationParentException } from './master-data.exceptions'

const LEVEL_LABELS: Record<LocationLevel, string> = {
  [LocationLevel.COUNTRY]: 'un país',
  [LocationLevel.PROVINCE]: 'una provincia',
  [LocationLevel.CITY]: 'una localidad',
  [LocationLevel.NEIGHBORHOOD]: 'un barrio',
}

/**
 * Reglas de los maestros (spec Fase 5, 4). Puras: sin NestJS ni Prisma.
 */
export const MasterDataPolicy = {
  /** "  Villa   Crespo " → "Villa Crespo". Los nombres se comparan así. */
  normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ')
  },

  /**
   * La jerarquía: un país no tiene padre; todo lo demás sí, y el padre tiene
   * que ser de un nivel más general. Se permite saltear niveles (una
   * localidad directo bajo un país) porque los datos que vienen de Tokko no
   * siempre tienen los cuatro.
   *
   * La falta de padre para un no-país ya la rechaza el DTO con 400 (spec 7);
   * esta regla la vuelve a chequear para cualquier otro camino de entrada.
   */
  assertValidParent(level: LocationLevel, parent: Location | null): void {
    if (level === LocationLevel.COUNTRY) {
      if (parent) {
        throw new InvalidLocationParentException(
          'Un país no puede estar dentro de otra ubicación',
        )
      }
      return
    }

    if (!parent) {
      throw new InvalidLocationParentException(
        `Para crear ${LEVEL_LABELS[level]} hay que elegir dónde está`,
      )
    }

    if (LEVEL_DEPTH[parent.level] >= LEVEL_DEPTH[level]) {
      throw new InvalidLocationParentException(
        `${capitalize(LEVEL_LABELS[level])} no puede estar dentro de ${LEVEL_LABELS[parent.level]}`,
      )
    }
  },

  /**
   * Arma el árbol a partir de la lista plana, ordenando cada nivel por nombre.
   * Un nodo cuyo padre no vino en la lista (no debería pasar) queda en la raíz
   * para no perderlo de vista.
   */
  buildTree(locations: Location[]): LocationNode[] {
    const nodes = new Map<string, LocationNode>()
    for (const location of locations) {
      nodes.set(location.id, { ...location, children: [] })
    }

    const roots: LocationNode[] = []
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined
      if (parent) parent.children.push(node)
      else roots.push(node)
    }

    const sortRecursively = (list: LocationNode[]): LocationNode[] => {
      list.sort((a, b) => a.name.localeCompare(b.name, 'es'))
      for (const node of list) sortRecursively(node.children)
      return list
    }
    return sortRecursively(roots)
  },
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
