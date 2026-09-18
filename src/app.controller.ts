import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'

import { IsPublic } from './infrastructure/auth/decorators/is-public.decorator'
import { SkipLogger } from './shared/infra/interceptors/app-logger.interceptor'

@Controller({
  version: VERSION_NEUTRAL,
})
@ApiExcludeController()
export class AppController {
  @IsPublic()
  @SkipLogger()
  @Get()
  getRoot() {
    return { message: 'API is running' }
  }
}
