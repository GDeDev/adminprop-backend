-- La pantalla de auditoría filtra por acción y ordena por fecha; sin este
-- índice cada filtro por una acción poco frecuente recorría toda la tabla
-- (auditoría M3: 166 ms con 1,2 M de filas). No toca los triggers de
-- inmutabilidad de audit_logs.
--
-- CREATE INDEX CONCURRENTLY: no bloquea las escrituras mientras se arma. Tiene
-- que ser la ÚNICA sentencia del archivo: Prisma envuelve en una transacción
-- las migraciones con varias, y CONCURRENTLY no corre dentro de una.
-- Si falla a mitad de camino deja un índice INVALID; antes de reintentar:
--   DROP INDEX CONCURRENTLY IF EXISTS "audit_logs_tenant_id_action_created_at_idx";

CREATE INDEX CONCURRENTLY "audit_logs_tenant_id_action_created_at_idx" ON "audit_logs"("tenant_id", "action", "created_at" DESC);
