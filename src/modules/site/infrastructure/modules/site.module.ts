import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'

import { AuditRecorderModule } from '@/modules/audit/public'
import { PropertiesModule } from '@/modules/properties/public'
import { TenantsModule } from '@/modules/tenants/public'
import { SiteDraftService } from '../../application/site-draft.service'
import { SiteDomainVerification } from '../../application/site-domain-verification'
import { SiteHostResolver } from '../../application/site-host-resolver'
import { SitePreviewTokenService } from '../../application/site-preview-token.service'
import { SiteUrls } from '../../application/site-urls'
import {
  PublishSiteHandler,
  ResetSiteTemplateHandler,
  UnpublishSiteHandler,
  UpdateSiteSettingsHandler,
  UploadSiteAssetHandler,
  VerifySiteDomainHandler,
} from '../../application/site.handlers'
import {
  CheckSubdomainHandler,
  GetPublicSiteHandler,
  GetSiteDomainHandler,
  GetSitePreviewTokenHandler,
  GetSiteSettingsHandler,
  ListSiteTemplatesHandler,
  ResolveSiteHostHandler,
} from '../../application/site.query-handlers'
import { SiteViews } from '../../application/site.views'
import {
  DnsTxtPort,
  SiteAssetRepository,
  SiteRevalidationPort,
  SiteSettingsRepository,
} from '../../domain/site.ports'
import { PublicSiteController } from '../http/controllers/public-site.controller'
import { SiteController } from '../http/controllers/site.controller'
import { HttpSiteRevalidation } from '../services/http-site-revalidation'
import { NodeDnsTxt } from '../services/node-dns-txt'
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
  imports: [
    JwtModule.register({}),
    PropertiesModule,
    TenantsModule,
    AuditRecorderModule,
  ],
  controllers: [SiteController, PublicSiteController],
  providers: [
    { provide: SiteSettingsRepository, useClass: SiteSettingsRepositoryImpl },
    { provide: SiteAssetRepository, useClass: SiteAssetRepositoryImpl },
    { provide: DnsTxtPort, useClass: NodeDnsTxt },
    { provide: SiteRevalidationPort, useClass: HttpSiteRevalidation },
    SiteDomainVerification,
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
    VerifySiteDomainHandler,
    GetSiteDomainHandler,
    ListSiteTemplatesHandler,
    GetSiteSettingsHandler,
    GetSitePreviewTokenHandler,
    CheckSubdomainHandler,
    GetPublicSiteHandler,
    ResolveSiteHostHandler,
  ],
})
export class SiteModule {}
