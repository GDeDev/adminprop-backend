-- CHECK de bajo riesgo (auditoría de datos, M7): el último seguro en la base
-- para lo que hoy sólo validan los DTOs y las políticas. Sólo reglas que el
-- dominio ya hace cumplir (un CHECK más estricto que el código convertiría un
-- 422 en un 500) o que son intrínsecas (montos no negativos, período AAAA-MM).
--
-- NOT VALID: se aplican a toda fila que se escriba desde ahora, pero no
-- escanean las existentes (el lock es instantáneo). La migración siguiente las
-- valida (VALIDATE CONSTRAINT sólo toma SHARE UPDATE EXCLUSIVE: no bloquea
-- escrituras).
--
-- Quedan afuera, a propósito: porcentajes de `tenants`, `installments` y
-- `contract_billing_terms.late_fee_percentage` (los DTOs aceptan hasta 999,99
-- y la regla de negocio no está cerrada), días de `tenants` (no se editan por
-- la API), identidad de la imputación del pago (necesita revisar datos
-- históricos), `confirmed_at` de liquidaciones y `voided_at` de pagos.

-- Contratos
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_dates_check" CHECK ("end_date" > "start_date") NOT VALID,
  ADD CONSTRAINT "contracts_amounts_check" CHECK ("initial_rent" >= 0 AND "deposit" >= 0) NOT VALID,
  ADD CONSTRAINT "contracts_fee_percentage_check" CHECK ("fee_percentage" BETWEEN 0 AND 100) NOT VALID,
  ADD CONSTRAINT "contracts_fixed_increase_percentage_check" CHECK ("fixed_increase_percentage" IS NULL OR "fixed_increase_percentage" BETWEEN 0 AND 100) NOT VALID;

ALTER TABLE "contract_rent_updates"
  ADD CONSTRAINT "contract_rent_updates_new_rent_check" CHECK ("new_rent" >= 0) NOT VALID;

ALTER TABLE "contract_billing_terms"
  ADD CONSTRAINT "contract_billing_terms_fee_percentage_check" CHECK ("fee_percentage" BETWEEN 0 AND 100) NOT VALID,
  ADD CONSTRAINT "contract_billing_terms_fee_amount_check" CHECK ("fee_amount" IS NULL OR "fee_amount" > 0) NOT VALID;

-- Cuotas, cargos, punitorio
ALTER TABLE "installments"
  ADD CONSTRAINT "installments_period_check" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') NOT VALID,
  ADD CONSTRAINT "installments_base_amount_check" CHECK ("base_amount" >= 0) NOT VALID;

ALTER TABLE "installment_charges"
  ADD CONSTRAINT "installment_charges_amount_check" CHECK ("amount" > 0) NOT VALID;

ALTER TABLE "installment_late_fee_days"
  ADD CONSTRAINT "installment_late_fee_days_values_check" CHECK ("day_number" >= 1 AND "amount" >= 0) NOT VALID;

ALTER TABLE "late_fee_adjustments"
  ADD CONSTRAINT "late_fee_adjustments_amount_check" CHECK ("amount" >= 0) NOT VALID;

-- Pagos
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check" CHECK ("amount" > 0 AND "amount_in_contract_currency" >= 0) NOT VALID,
  ADD CONSTRAINT "payments_applied_check" CHECK ("late_fee_applied" >= 0 AND "rent_applied" >= 0 AND "charges_applied" >= 0 AND "credit_generated" >= 0) NOT VALID,
  ADD CONSTRAINT "payments_exchange_rate_check" CHECK (("exchange_rate" IS NULL) = ("exchange_rate_source" IS NULL)) NOT VALID;

ALTER TABLE "renter_credits"
  ADD CONSTRAINT "renter_credits_remaining_check" CHECK ("remaining" >= 0 AND "remaining" <= "amount") NOT VALID;

-- Liquidaciones y honorarios
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_period_check" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') NOT VALID,
  ADD CONSTRAINT "settlements_sequence_check" CHECK ("sequence" >= 1) NOT VALID;

ALTER TABLE "fee_receivables"
  ADD CONSTRAINT "fee_receivables_period_check" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') NOT VALID,
  ADD CONSTRAINT "fee_receivables_paid_amount_check" CHECK ("paid_amount" >= 0 AND "paid_amount" <= "amount") NOT VALID;
