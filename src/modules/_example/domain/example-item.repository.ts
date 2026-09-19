import { ExampleItem } from './example-item.entity'

export interface CreateExampleItemData {
  name: string
  price: string
}

/**
 * Puerto del repositorio: lo que el dominio necesita, sin decir cómo. La
 * implementación con Prisma vive en `infrastructure/repositories/`.
 *
 * Todas las operaciones corren dentro del tenant del contexto: el filtro de
 * tenant de Prisma lo garantiza, este puerto ni lo menciona.
 */
export abstract class ExampleItemRepository {
  abstract create(data: CreateExampleItemData): Promise<ExampleItem>

  abstract findById(id: string): Promise<ExampleItem | null>

  abstract existsByName(name: string): Promise<boolean>

  abstract listIds(): Promise<string[]>

  abstract count(): Promise<number>

  abstract updatePrice(id: string, price: string): Promise<void>

  abstract setAttachment(
    id: string,
    attachment: { key: string; url: string },
  ): Promise<ExampleItem>
}
