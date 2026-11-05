-- `reportPayments` filtra (tenant_id, status, paid_at); el planner usaba el
-- índice por (tenant_id, contract_id, paid_at) con paid_at como condición no
-- inicial (auditoría M11: 4,3 ms -> 0,25 ms para un mes del tenant más grande,
-- y crece con los años).
--
-- CREATE INDEX CONCURRENTLY: no bloquea las escrituras mientras se arma. Tiene
-- que ser la ÚNICA sentencia del archivo: Prisma envuelve en una transacción
-- las migraciones con varias, y CONCURRENTLY no corre dentro de una.
-- Si falla a mitad de camino deja un índice INVALID; antes de reintentar:
--   DROP INDEX CONCURRENTLY IF EXISTS "payments_tenant_id_status_paid_at_idx";

CREATE INDEX CONCURRENTLY "payments_tenant_id_status_paid_at_idx" ON "payments"("tenant_id", "status", "paid_at");
