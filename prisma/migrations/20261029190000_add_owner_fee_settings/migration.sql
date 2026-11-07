-- Honorarios y modo de envío por propietario (Fase 12, rediseño 2.1): override
-- del % por umbral, conceptos que entran en la base y qué se le manda al
-- cerrar el consolidado.

-- CreateEnum
CREATE TYPE "StatementSendMode" AS ENUM ('SUMMARY', 'RECEIPTS', 'BOTH');

-- AlterTable
ALTER TABLE "owners" ADD COLUMN     "fee_includes_charges" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fee_includes_late_fees" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fee_percentage" DECIMAL(5,2),
ADD COLUMN     "statement_send_mode" "StatementSendMode" NOT NULL DEFAULT 'BOTH';
