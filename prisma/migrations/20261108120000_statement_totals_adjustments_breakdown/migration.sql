-- Consolidado: retenciones, adelantos y otros ajustes por separado (D-236).
-- Aditiva: `adjustments_total` se conserva (es la suma de los tres).
ALTER TABLE "owner_statement_totals"
  ADD COLUMN "withholdings_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "advances_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "other_adjustments_total" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Los consolidados ya cerrados congelaron sólo el total: se reconstruye el
-- desglose con los ajustes vigentes de sus liquidaciones (misma regla de signo
-- que SettlementPolicy.signedAmount: sólo OTHER_CREDIT suma).
UPDATE "owner_statement_totals" t
SET
  "withholdings_total" = COALESCE(b.withholdings, 0),
  "advances_total" = COALESCE(b.advances, 0),
  "other_adjustments_total" = COALESCE(b.other_adjustments, 0)
FROM (
  SELECT
    s."statement_id" AS statement_id,
    s."currency" AS currency,
    SUM(CASE WHEN a."concept" = 'WITHHOLDING' THEN -a."amount" ELSE 0 END) AS withholdings,
    SUM(CASE WHEN a."concept" = 'OWNER_ADVANCE' THEN -a."amount" ELSE 0 END) AS advances,
    SUM(CASE
      WHEN a."concept" = 'OTHER_DEDUCTION' THEN -a."amount"
      WHEN a."concept" = 'OTHER_CREDIT' THEN a."amount"
      ELSE 0 END) AS other_adjustments
  FROM "settlements" s
  JOIN "settlement_adjustments" a ON a."settlement_id" = s."id" AND a."voided_at" IS NULL
  WHERE s."statement_id" IS NOT NULL
  GROUP BY s."statement_id", s."currency"
) b
WHERE t."statement_id" = b.statement_id AND t."currency" = b.currency;
