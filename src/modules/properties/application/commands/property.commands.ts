import { PropertyStatus } from '@/modules/properties/domain/property'
import { PropertyData } from '@/modules/properties/domain/property.ports'

export class CreatePropertyCommand {
  constructor(public readonly data: PropertyData) {}
}

export class UpdatePropertyCommand {
  constructor(
    public readonly id: string,
    public readonly changes: Partial<PropertyData>,
  ) {}
}

export class ChangePropertyStatusCommand {
  constructor(
    public readonly id: string,
    public readonly status: PropertyStatus,
  ) {}
}

export interface UploadedPhoto {
  buffer: Buffer
  mimeType: string
}

export class AddPropertyPhotosCommand {
  constructor(
    public readonly propertyId: string,
    public readonly files: UploadedPhoto[],
  ) {}
}

export class DeletePropertyPhotoCommand {
  constructor(
    public readonly propertyId: string,
    public readonly photoId: string,
  ) {}
}

export class DeletePropertyCommand {
  constructor(public readonly id: string) {}
}
