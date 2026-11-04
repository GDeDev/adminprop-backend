-- Índices de búsqueda que faltaban (auditoría de datos, M1 y M11).
--
-- CREATE INDEX común (con lock de escritura mientras se arma) y no
-- CONCURRENTLY: las tres tablas son chicas (job_executions ~365 filas por
-- tenant y año; owners y renters, miles de filas). Un índice nuevo sobre una
-- tabla grande (audit_logs, payments, installments, notification_log) va con
-- CONCURRENTLY y en su propia migración de una sola sentencia.

-- `countScheduled` (cada 10 min, en cada instancia) filtra por día y por
-- origen; los índices existentes empiezan por tenant_id o por job.
CREATE INDEX "job_executions_scheduled_for_idx" ON "job_executions"("scheduled_for");

-- `findByPortalUser` en cada request del portal.
CREATE INDEX "owners_portal_user_id_idx" ON "owners"("portal_user_id");

CREATE INDEX "renters_portal_user_id_idx" ON "renters"("portal_user_id");
