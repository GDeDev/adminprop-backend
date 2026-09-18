import { Injectable } from '@nestjs/common'

import { PaginationMetaDto } from './pagination.dto'
import { buildPaginationMeta, toPageArgs } from './pagination'

/**
 * Metadata de paginación al estilo de siempre.
 *
 * Existe por compatibilidad: es la API que el equipo viene usando en el resto
 * de los servicios, y romperla obligaría a reaprender lo mismo con otro nombre.
 * Por dentro delega en los helpers de `pagination.ts`, así hay una sola
 * implementación de la matemática.
 *
 * ⚠️ **Los nombres de los métodos son los de siempre, pero el objeto devuelto
 * cambió de forma.** Antes era `{ pageNumber, pageSize, totalRecords,
 * totalPages }`; ahora es `{ page, limit, total, totalPages, hasNextPage,
 * hasPreviousPage }`. Se eligió la forma nueva porque el front la necesita para
 * habilitar o deshabilitar los botones del paginador sin recalcular nada. Si
 * algún cliente espera las claves viejas, hay que mapearlas en el borde.
 *
 * Para código nuevo conviene `paginateWith()`, que además resuelve el `skip`/
 * `take` y obliga a pasar un `count()` real. Ver docs/PAGINATION.md.
 */
@Injectable()
export class PaginationService {
  /**
   * @param pageNumber Página actual, empezando en 1
   * @param pageSize   Resultados por página
   * @param totalRecords Total de registros que matchean la consulta.
   *   Tiene que venir de un `count()`, no del largo del array devuelto.
   */
  createPaginationMetadata(
    pageNumber: number,
    pageSize: number,
    totalRecords: number,
  ): PaginationMetaDto {
    return buildPaginationMeta(totalRecords, {
      page: pageNumber,
      limit: pageSize,
    })
  }

  /** Offset para la consulta a la base. */
  calculateOffset(pageNumber: number, pageSize: number): number {
    return toPageArgs({ page: pageNumber, limit: pageSize }).skip
  }
}
