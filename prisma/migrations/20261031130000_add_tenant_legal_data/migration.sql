-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "address" VARCHAR(250),
ADD COLUMN     "bank_account_holder" VARCHAR(150),
ADD COLUMN     "bank_alias" VARCHAR(60),
ADD COLUMN     "bank_cbu" VARCHAR(22),
ADD COLUMN     "bank_name" VARCHAR(100),
ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "document_footer" VARCHAR(500),
ADD COLUMN     "email" VARCHAR(255),
ADD COLUMN     "legal_name" VARCHAR(200),
ADD COLUMN     "logo_key" VARCHAR(500),
ADD COLUMN     "phone" VARCHAR(40),
ADD COLUMN     "receipt_sequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tax_id" VARCHAR(20),
ADD COLUMN     "updated_by_id" UUID,
ADD COLUMN     "whatsapp" VARCHAR(20);

