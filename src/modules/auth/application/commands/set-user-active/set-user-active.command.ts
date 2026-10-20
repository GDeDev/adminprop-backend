export class SetUserActiveCommand {
  constructor(
    public readonly actorId: string,
    public readonly userId: string,
    public readonly isActive: boolean,
  ) {}
}
