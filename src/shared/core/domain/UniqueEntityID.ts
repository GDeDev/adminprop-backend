import { v4 as uuidv4 } from 'uuid'
import { Identifier } from './Identifier'

export class UniqueEntityID<
  T extends string | number | null = string,
> extends Identifier<T> {
  constructor(id?: T) {
    super(id ?? (uuidv4() as T))
  }
}
