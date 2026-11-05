-- Únicos que el negocio da por sentados y la base no hacía cumplir (auditoría
-- de datos, M7). Cada uno cierra una carrera que hoy sólo tapa la ausencia de
-- concurrencia:
--   contract_rent_updates (contract_id, effective_from)   aumento duplicado
--   renter_credits (tenant_id, origin_payment_id)         saldo a favor duplicado
--   settlements (tenant_id, contract_id, period, sequence) `maxSequence + 1` es una carrera
--   fee_payment_allocations (fee_payment_id, fee_receivable_id)
--   owners / renters (portal_user_id) parcial             un usuario de portal, un titular
--
-- NO se agrega contract_billing_terms (contract_id, effective_from): la regla
-- D-70 permite cargar dos veces la misma fecha ("corrige la fila del día; la
-- más nueva manda"), un único la rompería.
--
-- Si ya hay filas repetidas, un CREATE UNIQUE INDEX falla a mitad del deploy
-- con un mensaje que no dice cuáles. Por eso el bloque de abajo mira primero
-- todos los casos y, si encuentra alguno, aborta SIN crear nada y con la lista
-- completa. Todo corre en una transacción: o quedan los seis únicos o ninguno.
-- Las mismas consultas se pueden correr antes de desplegar:
--   npm run db:check-duplicates  (o --sql para verlas)
--
-- Los índices comunes (no CONCURRENTLY): son tablas chicas o medianas y el
-- lock de escritura dura lo que tarda en armarse el índice. Las tablas grandes
-- (payments, installments, audit_logs) llevan los suyos aparte.

DO $$
DECLARE
  report text := '';
  dup record;
BEGIN
  FOR dup IN
    SELECT 'contract_rent_updates (contract_id, effective_from)' AS label, count(*) AS groups
    FROM (SELECT 1 FROM "contract_rent_updates"
          GROUP BY "contract_id", "effective_from" HAVING count(*) > 1) g
    UNION ALL
    SELECT 'renter_credits (tenant_id, origin_payment_id)', count(*)
    FROM (SELECT 1 FROM "renter_credits"
          GROUP BY "tenant_id", "origin_payment_id" HAVING count(*) > 1) g
    UNION ALL
    SELECT 'settlements (tenant_id, contract_id, period, sequence)', count(*)
    FROM (SELECT 1 FROM "settlements"
          GROUP BY "tenant_id", "contract_id", "period", "sequence" HAVING count(*) > 1) g
    UNION ALL
    SELECT 'fee_payment_allocations (fee_payment_id, fee_receivable_id)', count(*)
    FROM (SELECT 1 FROM "fee_payment_allocations"
          GROUP BY "fee_payment_id", "fee_receivable_id" HAVING count(*) > 1) g
    UNION ALL
    SELECT 'owners (portal_user_id)', count(*)
    FROM (SELECT 1 FROM "owners" WHERE "portal_user_id" IS NOT NULL
          GROUP BY "portal_user_id" HAVING count(*) > 1) g
    UNION ALL
    SELECT 'renters (portal_user_id)', count(*)
    FROM (SELECT 1 FROM "renters" WHERE "portal_user_id" IS NOT NULL
          GROUP BY "portal_user_id" HAVING count(*) > 1) g
  LOOP
    IF dup.groups > 0 THEN
      report := report || format(E'\n  - %s: %s combinaciones repetidas', dup.label, dup.groups);
    END IF;
  END LOOP;

  IF report <> '' THEN
    RAISE EXCEPTION E'No se pueden crear los índices únicos: hay filas repetidas.%\nLimpiar los duplicados y volver a migrar. Para ver cuáles: npm run db:check-duplicates -- --sql'
      , report;
  END IF;
END
$$;

CREATE UNIQUE INDEX "contract_rent_updates_contract_id_effective_from_key" ON "contract_rent_updates"("contract_id", "effective_from");

-- Reemplaza al índice común por el mismo par de columnas.
DROP INDEX "renter_credits_tenant_id_origin_payment_id_idx";
CREATE UNIQUE INDEX "renter_credits_tenant_id_origin_payment_id_key" ON "renter_credits"("tenant_id", "origin_payment_id");

CREATE UNIQUE INDEX "settlements_tenant_id_contract_id_period_sequence_key" ON "settlements"("tenant_id", "contract_id", "period", "sequence");

CREATE UNIQUE INDEX "fee_payment_allocations_fee_payment_id_fee_receivable_id_key" ON "fee_payment_allocations"("fee_payment_id", "fee_receivable_id");

CREATE UNIQUE INDEX "owners_portal_user_id_key" ON "owners"("portal_user_id") WHERE "portal_user_id" IS NOT NULL;

CREATE UNIQUE INDEX "renters_portal_user_id_key" ON "renters"("portal_user_id") WHERE "portal_user_id" IS NOT NULL;
