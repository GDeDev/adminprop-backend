-- D-228: el punitorio diario de la inmobiliaria deja de tener 5 % por defecto.
-- Las inmobiliarias existentes conservan el valor que ya tenían; las nuevas
-- nacen sin uno y lo fijan al crearse o contrato por contrato.
ALTER TABLE "tenants"
  ALTER COLUMN "daily_late_fee_percentage" DROP DEFAULT,
  ALTER COLUMN "daily_late_fee_percentage" DROP NOT NULL;
