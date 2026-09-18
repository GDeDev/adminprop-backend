import { Module } from '@nestjs/common'

import { CommandHandlers } from '../../../application/feature/commands'
import { Repositories } from '../repositories'
import { ExampleController } from '../http/controllers/example.controller'
import { QueryHandlers } from '../../../application/feature/queries'

@Module({
  controllers: [ExampleController],
  providers: [...Repositories, ...CommandHandlers, ...QueryHandlers],
})
export class ExampleModule {}
