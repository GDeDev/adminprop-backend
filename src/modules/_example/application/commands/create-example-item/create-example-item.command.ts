export class CreateExampleItemCommand {
  constructor(
    public readonly name: string,
    /** Dinero como string ("1500.50"), validado por @IsMoneyAmount en el DTO. */
    public readonly price: string,
  ) {}
}
