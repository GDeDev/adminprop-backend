import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { AuditRecorderModule } from '@/modules/audit/public'
import { JobsModule } from '@/modules/jobs/public'
import { MasterDataModule } from '@/modules/master-data/public'
import { PropertiesModule } from '@/modules/properties/public'
import { TenantsModule } from '@/modules/tenants/public'
import { Configuration } from '@/shared/config/configuration'
import { ValuationNarratorProvider } from '@/shared/config/env.validation'
import { createLogger } from '@/shared/logging/root-logger'
import { ComparablesRefreshService } from '../../application/comparables-refresh.service'
import {
  AppraisePropertyHandler,
  GetMarketCoverageHandler,
  GetMarketStatusHandler,
  ListAppraisalsHandler,
  RefreshZoneHandler,
} from '../../application/valuation.handlers'
import {
  ValuationSettings,
  ZoneResolver,
} from '../../application/valuation.support'
import { ValuationViews } from '../../application/valuation.views'
import {
  ComparableRepository,
  ComparableSourceRegistry,
  SourceStateRepository,
  ValuationNarratorPort,
  ValuationRequestRepository,
  ValuationZoneRepository,
} from '../../domain/valuation.ports'
import { ValuationFacade } from '../../public/valuation.facade'
import { ValuationConsumer } from '../consumers/valuation.consumer'
import {
  AnthropicTextGenerator,
  LlmNarrator,
  TemplateNarrator,
} from '../engines/narrators'
import { ValuationController } from '../http/controllers/valuation.controller'
import {
  ComparableRepositoryImpl,
  SourceStateRepositoryImpl,
  ValuationRequestRepositoryImpl,
  ValuationZoneRepositoryImpl,
} from '../repositories/valuation.repositories.impl'
import { ConfiguredSourceRegistry } from '../sources/comparable-source.registry'

const logger = createLogger('ValuationModule')

/**
 * Tasación automática (spec Fase 24, rediseño). Depende por sus públicos de
 * propiedades, maestros, tenants y trabajos. Quien la usa es automatizaciones
 * (el job global de refresco), por `ValuationFacade`.
 */
@Module({
  imports: [
    PropertiesModule,
    MasterDataModule,
    TenantsModule,
    JobsModule,
    AuditRecorderModule,
  ],
  controllers: [ValuationController],
  providers: [
    { provide: ComparableRepository, useClass: ComparableRepositoryImpl },
    { provide: ValuationZoneRepository, useClass: ValuationZoneRepositoryImpl },
    { provide: SourceStateRepository, useClass: SourceStateRepositoryImpl },
    {
      provide: ValuationRequestRepository,
      useClass: ValuationRequestRepositoryImpl,
    },
    {
      provide: ComparableSourceRegistry,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Configuration, true>) =>
        new ConfiguredSourceRegistry(config),
    },
    {
      provide: ValuationNarratorPort,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<Configuration, true>,
      ): ValuationNarratorPort => {
        const { narrator, anthropicApiKey, llmModel } = config.get(
          'valuation',
          {
            infer: true,
          },
        )
        if (narrator !== ValuationNarratorProvider.Llm) {
          return new TemplateNarrator()
        }
        if (!anthropicApiKey) {
          logger.warn(
            'VALUATION_NARRATOR=llm sin ANTHROPIC_API_KEY: se usa la plantilla',
          )
          return new TemplateNarrator()
        }
        return new LlmNarrator(
          new AnthropicTextGenerator(anthropicApiKey, llmModel),
        )
      },
    },
    ValuationSettings,
    ZoneResolver,
    ValuationViews,
    ComparablesRefreshService,
    ValuationConsumer,
    AppraisePropertyHandler,
    ListAppraisalsHandler,
    GetMarketStatusHandler,
    GetMarketCoverageHandler,
    RefreshZoneHandler,
    ValuationFacade,
  ],
  exports: [ValuationFacade],
})
export class ValuationModule {}
