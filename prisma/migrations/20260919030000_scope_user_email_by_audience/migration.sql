-- Email único según por dónde entra el usuario (Fase 4, login de portal).
--
-- Los internos (admin y empleado) se loguean sólo con email + contraseña, así
-- que su email tiene que ser único en todo el sistema. Los de portal
-- (propietario e inquilino) se loguean contra una inmobiliaria: su email es
-- único dentro de ella y por rol, para que la misma persona pueda ser
-- propietaria en dos inmobiliarias, o propietaria e inquilina en una.
--
-- Prisma no puede declarar índices parciales en el schema. Tampoco los borra
-- al generar migraciones nuevas: los ignora al comparar.

DROP INDEX "users_email_key";

CREATE UNIQUE INDEX "users_internal_email_key"
  ON "users" ("email")
  WHERE "role" IN ('ADMIN', 'EMPLOYEE');

CREATE UNIQUE INDEX "users_portal_email_key"
  ON "users" ("tenant_id", "role", "email")
  WHERE "role" IN ('OWNER', 'RENTER');
