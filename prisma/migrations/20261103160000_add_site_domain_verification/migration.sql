-- El dominio propio deja de ser único a secas: se reserva con un registro TXT.
-- Solo los dominios verificados son únicos y solo ellos resuelven el sitio.
DROP INDEX "site_settings_custom_domain_key";

ALTER TABLE "site_settings" ADD COLUMN "custom_domain_verified_at" TIMESTAMPTZ(3);

-- Los dominios que ya estaban cargados se consideran verificados: no hay forma
-- de comprobarlos ahora y cortar sitios publicados sería peor que el riesgo.
UPDATE "site_settings" SET "custom_domain_verified_at" = now() WHERE "custom_domain" IS NOT NULL;

CREATE INDEX "site_settings_custom_domain_idx" ON "site_settings"("custom_domain");

CREATE UNIQUE INDEX "site_settings_custom_domain_verified_key"
  ON "site_settings"("custom_domain")
  WHERE "custom_domain_verified_at" IS NOT NULL;
