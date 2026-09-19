import { Module } from '@nestjs/common'

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
import { PropertiesController } from '../http/controllers/properties.controller'
import { NoContractsYet } from '../repositories/no-contracts-yet'
import { PropertyRepositoryImpl } from '../repositories/property.repository.impl'

/** Propiedades (spec Fase 6, PRD 5.1). */
@Module({
  imports: [MasterDataModule],
  controllers: [PropertiesController],
  providers: [
    { provide: PropertyRepository, useClass: PropertyRepositoryImpl },
    // Fase 9: reemplazar por la implementación que consulta contratos.
    { provide: PropertyContracts, useClass: NoContractsYet },
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
  ],
})
export class PropertiesModule {}
