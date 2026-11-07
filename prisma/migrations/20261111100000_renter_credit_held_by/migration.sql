-- Quién tiene la plata de un saldo a favor (revisión 2026-11-06, crítico 3):
-- la inmobiliaria o el propietario, según quién cobró el pago que lo generó.
-- Aditiva: las filas viejas toman el receptor de su pago de origen.
ALTER TABLE "renter_credits"
  ADD COLUMN "held_by" "PaymentReceiver" NOT NULL DEFAULT 'AGENCY';

UPDATE "renter_credits" AS rc
SET "held_by" = p."received_by"
FROM "payments" AS p
WHERE p."id" = rc."origin_payment_id"
  AND p."tenant_id" = rc."tenant_id";
