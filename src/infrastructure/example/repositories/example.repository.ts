import { Injectable } from '@nestjs/common'
import { IExampleRepository } from '../../../domain/feature/repositories/example.repository'
import { Example } from '../../../domain/feature/entities/example.entity'

@Injectable()
export class ExampleRepository implements IExampleRepository {
  async findAll(): Promise<Example[]> {
    try {
      return [new Example('1'), new Example('2')]
    } catch (error) {
      throw new Error(`Failed to fetch examples: ${error.message}`)
    }
  }

  async findById(id: string): Promise<Example> {
    try {
      console.log({ id })
      return new Example('1')
    } catch (error) {
      throw new Error(`Failed to fetch example: ${error.message}`)
    }
  }

  async create(data: Example): Promise<void> {
    try {
      console.log('Creating ', { data })
      return
    } catch (error) {
      throw new Error(`Failed to create example: ${error.message}`)
    }
  }
}
