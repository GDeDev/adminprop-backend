-- AlterTable
ALTER TABLE `users` ADD COLUMN `createdById` VARCHAR(36) NULL,
    ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `deletedById` VARCHAR(36) NULL,
    ADD COLUMN `updatedById` VARCHAR(36) NULL;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(36) NOT NULL,
    `entidad` VARCHAR(64) NOT NULL,
    `entidadId` VARCHAR(64) NOT NULL,
    `accion` ENUM('CREATE', 'UPDATE', 'DELETE', 'RESTORE') NOT NULL,
    `cambios` JSON NULL,
    `usuarioId` VARCHAR(36) NULL,
    `usuarioEmail` VARCHAR(255) NULL,
    `correlationId` VARCHAR(128) NULL,
    `ip` VARCHAR(45) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entidad_entidadId_idx`(`entidad`, `entidadId`),
    INDEX `audit_logs_usuarioId_idx`(`usuarioId`),
    INDEX `audit_logs_creadoEn_idx`(`creadoEn`),
    INDEX `audit_logs_correlationId_idx`(`correlationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `users_deletedAt_idx` ON `users`(`deletedAt`);

