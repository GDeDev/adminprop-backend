export class ResetUserPasswordCommand {
  constructor(
    public readonly actorId: string,
    public readonly userId: string,
    public readonly newPassword: string,
  ) {}
}
