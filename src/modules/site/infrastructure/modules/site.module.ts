import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'

import { PropertiesModule } from '@/modules/properties/public'
import { TenantsModule } from '@/modules/tenants/public'
import { SiteDraftService } from '../../application/site-draft.service'
import { SiteHostResolver } from '../../application/site-host-resolver'
import { SitePreviewTokenService } from '../../application/site-preview-token.service'
import { SiteUrls } from '../../application/site-urls'
import {
  PublishSiteHandler,
  ResetSiteTemplateHandler,
  UnpublishSiteHandler,
  UpdateSiteSettingsHandler,
  UploadSiteAssetHandler,
} from '../../application/site.handlers'
import {
  CheckSubdomainHandler,
  GetPublicSiteHandler,
  GetSitePreviewTokenHandler,
  GetSiteSettingsHandler,
  ListSiteTemplatesHandler,
  ResolveSiteHostHandler,
} from '../../application/site.query-handlers'
import { SiteViews } from '../../application/site.views'
import {
  SiteAssetRepository,
  SiteSettingsRepository,
} from '../../domain/site.ports'
import { PublicSiteController } from '../http/controllers/public-site.controller'
import { SiteController } from '../http/controllers/site.controller'
import {
  SiteAssetRepositoryImpl,
  SiteSettingsRepositoryImpl,
} from '../repositories/site.repositories.impl'

/**
 * Sitio web de la inmobiliaria (generador de sitios): configuración con
 * borrador y publicado, imágenes, vista previa y lecturas públicas. Habla con
 * propiedades y tenants solo por sus públicos; el storage es un puerto global.
 * Nadie depende de este módulo.
 */
@Module({
  imports: [JwtModule.register({}), PropertiesModule, TenantsModule],
  controllers: [SiteController, PublicSiteController],
  providers: [
    { provide: SiteSettingsRepository, useClass: SiteSettingsRepositoryImpl },
    { provide: SiteAssetRepository, useClass: SiteAssetRepositoryImpl },
    SiteUrls,
    SiteViews,
    SiteDraftService,
    SiteHostResolver,
    SitePreviewTokenService,
    UpdateSiteSettingsHandler,
    ResetSiteTemplateHandler,
    PublishSiteHandler,
    UnpublishSiteHandler,
    UploadSiteAssetHandler,
    ListSiteTemplatesHandler,
    GetSiteSettingsHandler,
    GetSitePreviewTokenHandler,
    CheckSubdomainHandler,
    GetPublicSiteHandler,
    ResolveSiteHostHandler,
  ],
})
export class SiteModule {}
