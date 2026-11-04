-- D-230: el ajuste manual del alquiler guarda su motivo y quién lo autorizó.
-- Nullable: los aumentos automáticos y los anteriores no los tienen.
ALTER TABLE "contract_rent_updates"
  ADD COLUMN "adjustment_reason" VARCHAR(500),
  ADD COLUMN "authorized_by" VARCHAR(150);
