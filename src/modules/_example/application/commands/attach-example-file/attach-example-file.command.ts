export class AttachExampleFileCommand {
  constructor(
    public readonly id: string,
    public readonly file: Buffer,
    public readonly originalName: string,
    public readonly contentType: string,
  ) {}
}
