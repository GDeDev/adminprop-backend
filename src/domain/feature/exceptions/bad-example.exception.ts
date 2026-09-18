import { BadRequestException } from '@nestjs/common'

export class BadExampleException extends BadRequestException {
  constructor(exampleId: number) {
    super(`Bad example with ID ${exampleId} provided. Please check the input.`)
  }
}
