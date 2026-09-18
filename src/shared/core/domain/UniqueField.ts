import { Identifier } from './Identifier'

export class UniqueField<
  T extends string | number = string,
> extends Identifier<T> {
  constructor(value: T) {
    super(value)
  }
}
