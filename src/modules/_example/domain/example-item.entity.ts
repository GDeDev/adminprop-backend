/**
 * Ítem de ejemplo tal como lo ve el dominio.
 *
 * El precio es un `string` con dos decimales, nunca un `number`: así viaja
 * por toda la app y sólo se convierte a `Decimal` para operar (spec Fase 1,
 * 2.1). El dominio no conoce el `Decimal` de Prisma.
 */
export interface ExampleItem {
  id: string
  tenantId: string
  name: string
  price: string
  attachmentKey: string | null
  attachmentUrl: string | null
  createdAt: Date
}
