import { Body, Controller, Get, Post } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { CreateExampleCommand } from '@/application/feature/commands/create-example/create-example.command'
import { CreateExampleResult } from '@/application/feature/commands/create-example/create-example.handler'
import { CreateExampleDto } from '../dtos/create-example.dto'
import { ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { ResponseWithPagination } from '@/shared/dtos/pagination.dto'
import { Example } from '@/domain/feature/entities/example.entity'
import { GetExamplesQuery } from '@/application/feature/queries/get-examples/get-examples.query'
import { GetExamplesResponse } from '@/application/feature/queries/get-examples/get-examples.handler'

@ApiTags('Example')
@ApiBearerAuth()
@Controller({ path: 'example' })
export class ExampleController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get examples',
  })
  @ApiResponse({
    status: 200,
    description: 'List of examples',
  })
  async getExamples(): Promise<
    ApiSuccessDto<ResponseWithPagination<Example[]>>
  > {
    const result = await this.queryBus.execute<
      GetExamplesQuery,
      GetExamplesResponse
    >(new GetExamplesQuery())

    return {
      success: true,
      message: null,
      data: result,
    }
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new example',
  })
  @ApiResponse({
    status: 201,
    description: 'Example created',
  })
  async createExample(
    @Body() data: CreateExampleDto,
  ): Promise<ApiSuccessDto<{ id: string }>> {
    const result = await this.commandBus.execute<
      CreateExampleCommand,
      CreateExampleResult
    >(new CreateExampleCommand(data))

    return {
      success: true,
      message: result.isSuccess ? 'Example created successfully' : result.error,
      data: result.isSuccess ? { id: 'generated-id' } : undefined,
    }
  }
}
