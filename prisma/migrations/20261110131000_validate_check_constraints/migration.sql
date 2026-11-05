-- Valida los CHECK de la migración anterior contra las filas que ya existían.
-- VALIDATE CONSTRAINT sólo toma SHARE UPDATE EXCLUSIVE: no frena las
-- escrituras mientras escanea.
--
-- Si alguna fila vieja no cumple, un VALIDATE común tira el deploy entero. Acá
-- no: la constraint queda NOT VALID (igual rechaza toda escritura nueva),
-- se avisa con un WARNING que dice cuál y se sigue. Para cerrarla después:
--   1) buscar las filas:  SELECT * FROM <tabla> WHERE NOT (<condición>);
--   2) corregirlas;
--   3) ALTER TABLE <tabla> VALIDATE CONSTRAINT <nombre>;
-- Las que sigan sin validar se listan con:
--   SELECT conrelid::regclass, conname FROM pg_constraint
--   WHERE contype = 'c' AND NOT convalidated;
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'c'
      AND NOT convalidated
      AND connamespace = 'public'::regnamespace
    ORDER BY conrelid::regclass::text, conname
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname);
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'CHECK % de % no se pudo validar: hay filas existentes que no lo cumplen. Sigue activo para las escrituras nuevas; corregir las filas y correr VALIDATE CONSTRAINT.', c.conname, c.tbl;
    END;
  END LOOP;
END
$$;
