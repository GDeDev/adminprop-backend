import { Example } from '../entities/example.entity'

export interface IExampleRepository {
  findAll(): Promise<Example[]>
  findById(id: string): Promise<Example>
  create(data: Example): Promise<void>
}
