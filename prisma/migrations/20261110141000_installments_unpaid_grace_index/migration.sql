-- Parcial: las cuotas impagas son una fracción chica de la tabla y
-- `listOverdue` (status <> 'PAID' AND grace_end_date < hoy) sólo mira esas
-- (auditoría M11). Vive sólo en SQL: Prisma no declara índices parciales.
--
-- CREATE INDEX CONCURRENTLY: no bloquea las escrituras mientras se arma. Tiene
-- que ser la ÚNICA sentencia del archivo: Prisma envuelve en una transacción
-- las migraciones con varias, y CONCURRENTLY no corre dentro de una.
-- Si falla a mitad de camino deja un índice INVALID; antes de reintentar:
--   DROP INDEX CONCURRENTLY IF EXISTS "installments_tenant_id_grace_end_date_unpaid_idx";

CREATE INDEX CONCURRENTLY "installments_tenant_id_grace_end_date_unpaid_idx" ON "installments"("tenant_id", "grace_end_date") WHERE "status" <> 'PAID';
