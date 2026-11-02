import { Module } from '@nestjs/common'

import { AuditRecorderModule } from '@/modules/audit/public'
import { ContractsModule } from '@/modules/contracts/public'
import {
  AddInventoryPhotosHandler,
  ConfirmInventoryHandler,
  CorrectInventoryHandler,
  CreateInventoryHandler,
  DeleteInventoryPhotoHandler,
  UpdateInventoryHandler,
} from '@/modules/inventory/application/inventory.handlers'
import {
  CompareInventoriesHandler,
  GetInventoryHandler,
  ListContractInventoriesHandler,
} from '@/modules/inventory/application/inventory.queries'
import { InventoryViews } from '@/modules/inventory/application/inventory.views'
import { InventoryRepository } from '@/modules/inventory/domain/inventory.ports'
import { InventoryController } from '../http/controllers/inventory.controller'
import { InventoryRepositoryImpl } from '../repositories/inventory.repository.impl'

/**
 * Inventario del inmueble (spec Fase 25). Depende de contratos y de la
 * auditoría por sus públicos, y de auth (global) para nombrar a quien lo hizo.
 * Nadie depende de inventario todavía.
 */
@Module({
  imports: [ContractsModule, AuditRecorderModule],
  controllers: [InventoryController],
  providers: [
    { provide: InventoryRepository, useClass: InventoryRepositoryImpl },
    InventoryViews,
    CreateInventoryHandler,
    UpdateInventoryHandler,
    AddInventoryPhotosHandler,
    DeleteInventoryPhotoHandler,
    ConfirmInventoryHandler,
    CorrectInventoryHandler,
    ListContractInventoriesHandler,
    GetInventoryHandler,
    CompareInventoriesHandler,
  ],
})
export class InventoryModule {}
