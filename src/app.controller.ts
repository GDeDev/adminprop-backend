import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'

import { IsPublic } from '@/modules/auth/public'

@Controller({
  version: VERSION_NEUTRAL,
})
@ApiExcludeController()
export class AppController {
  @IsPublic()
  @Get()
  getRoot() {
    return { message: 'API is running' }
  }
}
