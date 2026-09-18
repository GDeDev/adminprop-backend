import { Module } from '@nestjs/common'

import { CommandHandlers } from './commands'
import { Interceptors } from './interceptors'
import { Services } from './external-services'

@Module({
  providers: [...Services, ...Interceptors, ...CommandHandlers],
  exports: [...Services],
})
export class InfraModule {}
