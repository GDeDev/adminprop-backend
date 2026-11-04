-- D-226: la devolución del depósito guarda el modo y el monto de referencia.
-- Las devoluciones existentes cerraron contra el depósito entero (FIXED).
ALTER TABLE "deposit_returns"
  ADD COLUMN "mode" "DepositReturnMode" NOT NULL DEFAULT 'FIXED',
  ADD COLUMN "reference_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

UPDATE "deposit_returns" SET "reference_amount" = "deposit_amount";
