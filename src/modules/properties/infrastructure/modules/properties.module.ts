import { forwardRef, Module } from '@nestjs/common'

import {
  AddPropertyPhotosHandler,
  ChangePropertyStatusHandler,
  CreatePropertyHandler,
  DeletePropertyHandler,
  DeletePropertyPhotoHandler,
  UpdatePropertyHandler,
} from '@/modules/properties/application/commands/property.handlers'
import { MasterDataReferences } from '@/modules/properties/application/master-data-references'
import { PropertyViews } from '@/modules/properties/application/property.views'
import {
  GetPropertyHandler,
  ListPropertiesHandler,
} from '@/modules/properties/application/queries/property.queries'
import {
  PropertyContracts,
  PropertyRepository,
} from '@/modules/properties/domain/property.ports'
import { MasterDataModule } from '@/modules/master-data/public'
import { OwnersModule } from '@/modules/owners/public'
import { PropertiesFacade } from '@/modules/properties/public/properties.facade'
import { PropertiesController } from '../http/controllers/properties.controller'
import { PropertyContractsImpl } from '../repositories/property-contracts.impl'
import { PropertyRepositoryImpl } from '../repositories/property.repository.impl'

/**
 * Propiedades (spec Fase 6, PRD 5.1). El `forwardRef` con propietarios está
 * explicado en `OwnersModule`.
 */
@Module({
  imports: [MasterDataModule, forwardRef(() => OwnersModule)],
  controllers: [PropertiesController],
  providers: [
    { provide: PropertyRepository, useClass: PropertyRepositoryImpl },
    { provide: PropertyContracts, useClass: PropertyContractsImpl },
    PropertyViews,
    MasterDataReferences,
    CreatePropertyHandler,
    UpdatePropertyHandler,
    ChangePropertyStatusHandler,
    AddPropertyPhotosHandler,
    DeletePropertyPhotoHandler,
    DeletePropertyHandler,
    ListPropertiesHandler,
    GetPropertyHandler,
    PropertiesFacade,
  ],
  exports: [PropertiesFacade],
})
export class PropertiesModule {}
