-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "updated_by_id" UUID;

-- AlterTable
ALTER TABLE "notification_templates" ADD COLUMN     "created_by_id" UUID;

-- AlterTable
ALTER TABLE "whatsapp_templates" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "updated_by_id" UUID;

