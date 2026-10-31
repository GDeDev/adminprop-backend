import { Tenant, TenantSettingsPatch } from './tenant.entity'

/**
 * Puerto del repositorio de inmobiliarias.
 *
 * `tenants` es la raíz del modelo multi-tenant y no pasa por el filtro de
 * tenant: se puede consultar sin inmobiliaria en el contexto (el login de
 * portal la busca por slug antes de saber quién es el usuario).
 */
export abstract class TenantRepository {
  abstract findById(id: string): Promise<Tenant | null>

  /** Las inmobiliarias habilitadas, para los jobs de la Fase 13 (sin tenant en el contexto). */
  abstract listActive(): Promise<Tenant[]>

  /** El slug se compara normalizado (minúsculas, sin espacios). */
  abstract findBySlug(slug: string): Promise<Tenant | null>
  /** Aplica sólo los campos presentes (`null` borra el dato). */
  abstract updateSettings(
    id: string,
    patch: TenantSettingsPatch,
  ): Promise<Tenant>

  /** Guarda (o, con `null`, quita) el logo de la inmobiliaria. */
  abstract setLogo(
    id: string,
    logo: { key: string; url: string } | null,
  ): Promise<Tenant>

  /**
   * Incrementa y devuelve el contador de recibos, de forma atómica. Corre en
   * la transacción en curso: si se revierte, el número no se pierde (A-33).
   */
  abstract nextReceiptNumber(id: string): Promise<number>
}
