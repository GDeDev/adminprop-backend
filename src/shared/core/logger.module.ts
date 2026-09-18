import { Global, Module } from '@nestjs/common'
import { CustomLoggerService } from '@/shared/core/logger.service'

@Global()
@Module({
  providers: [
    {
      provide: 'LOGGER_SERVICE',
      useClass: CustomLoggerService,
    },
    CustomLoggerService,
  ],
  exports: [CustomLoggerService, 'LOGGER_SERVICE'],
})
export class LoggerModule {}
