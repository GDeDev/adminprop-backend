/**
 * Roles de la aplicación.
 *
 * Se declara acá y no se importa de `@prisma/client` para que el dominio y los
 * controllers no dependan del ORM. Los valores tienen que coincidir con el enum
 * `Role` de `prisma/schema.prisma`.
 *
 * - `ADMIN` y `EMPLOYEE`: operan el backoffice de su inmobiliaria.
 * - `OWNER` y `RENTER`: entran a su portal y sólo ven sus propios datos.
 */
export enum Role {
  ADMIN = 'ADMIN',
  EMPLOYEE = 'EMPLOYEE',
  OWNER = 'OWNER',
  RENTER = 'RENTER',
}

export const ALL_ROLES = Object.values(Role)
