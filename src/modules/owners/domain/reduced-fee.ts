/**
 * Honorario reducido (PRD RN-07, spec Fase 7, 4): aplica si el propietario
 * tiene al menos `threshold` propiedades activas.
 *
 * Es la ÚNICA implementación de la regla. Las fichas de propietarios la usan
 * para mostrar el badge y la Fase 12 la va a usar al generar cada
 * liquidación; se exporta desde `owners/public` para eso.
 */
export function appliesReducedFee(
  activeProperties: number,
  threshold: number,
): boolean {
  return threshold > 0 && activeProperties >= threshold
}
