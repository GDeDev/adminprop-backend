-- Una corrida programada (job + tenant + día + número de corrida) existe una
-- sola vez, aunque haya varias réplicas del cron. Antes la única barrera era la
-- singletonKey de pg-boss, que en una cola estándar no deduplica nada.
--
-- Las filas anteriores quedan con slot NULL y no entran en el índice.
-- job_executions es chica (unas 365 filas por tenant y año), así que el
-- CREATE INDEX común es seguro; en una tabla grande iría CONCURRENTLY, en su
-- propia migración.
ALTER TABLE "job_executions" ADD COLUMN "slot" INTEGER;

-- tenant_id NULL (jobs globales) se normaliza: en un índice único los NULL
-- son todos distintos entre sí.
CREATE UNIQUE INDEX "job_executions_scheduled_slot_key"
  ON "job_executions" (
    "job",
    COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "scheduled_for",
    "slot"
  )
  WHERE "triggered_by" = 'SCHEDULE' AND "slot" IS NOT NULL;
