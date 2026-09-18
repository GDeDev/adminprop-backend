import { ApiProperty } from '@nestjs/swagger'

export class PaginationMetadata {
  @ApiProperty({ description: 'The page number' })
  pageNumber: number

  @ApiProperty({ description: 'The page size' })
  pageSize: number

  @ApiProperty({ description: 'The total number of records' })
  totalRecords: number

  @ApiProperty({ description: 'The total number of pages' })
  totalPages: number
}

export class ResponseWithPagination<T> {
  @ApiProperty({ description: 'The data returned by the operation' })
  data: T

  @ApiProperty({ type: PaginationMetadata, description: 'Pagination metadata' })
  pagination: PaginationMetadata
}
