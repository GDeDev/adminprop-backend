import { ExampleItem } from '@/modules/_example/domain/example-item.entity'

/**
 * Lo que devuelven los casos de uso: nunca la fila de Prisma ni la entidad
 * con campos internos (la `attachmentKey` no sale).
 */
export interface ExampleItemView {
  id: string
  name: string
  price: string
  attachmentUrl: string | null
  createdAt: Date
}

export function toExampleItemView(item: ExampleItem): ExampleItemView {
  return {
    id: item.id,
    name: item.name,
    price: item.price,
    attachmentUrl: item.attachmentUrl,
    createdAt: item.createdAt,
  }
}
