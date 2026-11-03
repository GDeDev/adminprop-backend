const isEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value.trim() === '')

/**
 * Lo que una migración puede completar de un registro que ya existe (Fase 21,
 * A-72): sólo los campos que hoy están vacíos y para los que el archivo trae un
 * valor. Un campo con valor nunca se pisa.
 */
export function fillEmptyFields<T extends object>(
  current: T,
  incoming: Partial<Record<keyof T, unknown>>,
  fields: (keyof T)[],
): Partial<T> {
  const patch: Partial<T> = {}
  for (const field of fields) {
    if (isEmpty(current[field]) && !isEmpty(incoming[field])) {
      patch[field] = incoming[field] as T[keyof T]
    }
  }
  return patch
}
