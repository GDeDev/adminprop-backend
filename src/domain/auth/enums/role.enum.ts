/**
 * Roles de la aplicación.
 *
 * Se declara acá y no se importa de `@prisma/client` para que el dominio y los
 * controllers no dependan del ORM. Los valores tienen que coincidir con el enum
 * `Role` de `prisma/schema.prisma`.
 */
export enum Role {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export const ALL_ROLES = Object.values(Role)
