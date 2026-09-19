import { Tenant } from './tenant.entity'

/**
 * Puerto del repositorio de inmobiliarias.
 *
 * `tenants` es la raíz del modelo multi-tenant y no pasa por el filtro de
 * tenant: se puede consultar sin inmobiliaria en el contexto (el login de
 * portal la busca por slug antes de saber quién es el usuario).
 */
export abstract class TenantRepository {
  abstract findById(id: string): Promise<Tenant | null>

  /** El slug se compara normalizado (minúsculas, sin espacios). */
  abstract findBySlug(slug: string): Promise<Tenant | null>
}
