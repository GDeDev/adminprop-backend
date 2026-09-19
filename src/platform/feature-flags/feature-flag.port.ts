/**
 * Feature flags (spec Fase 1, sección 5.3).
 *
 * Hoy Flagsmith; mañana, AWS AppConfig. Se consulta desde un Handler o un
 * Controller, **nunca desde un Domain Service**: el flag decide si se invoca
 * una regla, no cómo se comporta la regla.
 *
 * ```ts
 * if (await this.flags.isEnabled('automatic-appraisal')) { ... }
 * ```
 *
 * Clase abstracta y no interface para usarla como token de inyección.
 */
export abstract class FeatureFlagPort {
  /**
   * Si el flag está activo para el tenant indicado o, sin `context`, para el
   * tenant del request en curso. Sin tenant, se evalúa a nivel entorno.
   *
   * Ante cualquier falla del proveedor devuelve `false`: una funcionalidad
   * nueva se apaga antes que romper el request.
   */
  abstract isEnabled(
    flagKey: string,
    context?: FeatureFlagContext,
  ): Promise<boolean>
}

export interface FeatureFlagContext {
  tenantId: string
}
