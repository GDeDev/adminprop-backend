import { Module } from '@nestjs/common'

import {
  CreateCatalogItemHandler,
  SetCatalogItemActiveHandler,
  UpdateCatalogItemHandler,
} from '@/modules/master-data/application/commands/catalog.handlers'
import {
  CreateLocationHandler,
  RenameLocationHandler,
  SetLocationActiveHandler,
} from '@/modules/master-data/application/commands/location.handlers'
import {
  GetCatalogItemHandler,
  ListCatalogItemsHandler,
} from '@/modules/master-data/application/queries/catalog.queries'
import {
  GetLocationHandler,
  GetLocationTreeHandler,
  ListLocationsHandler,
} from '@/modules/master-data/application/queries/location.queries'
import {
  CatalogRepository,
  LocationRepository,
} from '@/modules/master-data/domain/master-data.repositories'
import { MasterDataFacade } from '@/modules/master-data/public/master-data.facade'
import {
  AmenitiesController,
  OperationTypesController,
  PropertyTypesController,
  ServiceTypesController,
} from '../http/controllers/catalog.controller'
import { LocationsController } from '../http/controllers/locations.controller'
import { CatalogRepositoryImpl } from '../repositories/catalog.repository.impl'
import { LocationRepositoryImpl } from '../repositories/location.repository.impl'

/**
 * Maestros (spec Fase 5, PRD 5.8): tipos de propiedad, amenities, tipos de
 * operación, tipos de servicio y ubicaciones. Por inmobiliaria (D-26).
 */
@Module({
  controllers: [
    PropertyTypesController,
    AmenitiesController,
    OperationTypesController,
    ServiceTypesController,
    LocationsController,
  ],
  providers: [
    { provide: CatalogRepository, useClass: CatalogRepositoryImpl },
    { provide: LocationRepository, useClass: LocationRepositoryImpl },
    CreateCatalogItemHandler,
    UpdateCatalogItemHandler,
    SetCatalogItemActiveHandler,
    ListCatalogItemsHandler,
    GetCatalogItemHandler,
    CreateLocationHandler,
    RenameLocationHandler,
    SetLocationActiveHandler,
    ListLocationsHandler,
    GetLocationHandler,
    GetLocationTreeHandler,
    MasterDataFacade,
  ],
  exports: [MasterDataFacade],
})
export class MasterDataModule {}
