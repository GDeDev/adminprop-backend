import { IndexType } from '@/modules/indices/domain/index-value'

export class RegisterIndexValueCommand {
  constructor(
    public readonly indexType: IndexType,
    public readonly period: string,
    public readonly value: string,
  ) {}
}
