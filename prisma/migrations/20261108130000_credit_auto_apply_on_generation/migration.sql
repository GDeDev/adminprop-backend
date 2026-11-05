-- Saldo a favor: aplicación automática al generar la cuota (D-237).
-- Aditiva: por defecto sigue siendo manual.
ALTER TABLE "tenants"
  ADD COLUMN "auto_apply_credit_on_generation" BOOLEAN NOT NULL DEFAULT false;

-- La aplicación automática corre en el cron, sin usuario: el pago de tipo
-- CREDIT_APPLICATION queda sin "registrado por" en vez de inventar uno.
ALTER TABLE "payments" ALTER COLUMN "registered_by_id" DROP NOT NULL;
