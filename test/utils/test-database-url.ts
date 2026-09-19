/**
 * URL de la base que usan los tests.
 *
 * Nunca se hereda `DATABASE_URL` del entorno: si alguien corre los tests
 * dentro de `doppler run`, esa variable apunta a la base de desarrollo y los
 * e2e la vaciarían. Se usa `TEST_DATABASE_URL` o, por defecto, la base de tests
 * del docker-compose (credenciales de desarrollo, no secretos).
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://adminprop:adminprop@localhost:5432/adminprop_test'

/** Los e2e truncan tablas: sólo se aceptan bases cuyo nombre termina en _test. */
export function assertIsTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '')
  if (!name.endsWith('_test')) {
    throw new Error(
      `Los tests se niegan a correr contra la base "${name}": ` +
        'el nombre tiene que terminar en _test.',
    )
  }
}
