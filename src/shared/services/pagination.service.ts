import { Injectable } from '@nestjs/common'
import { PaginationMetadata } from '../dtos/pagination.dto'

@Injectable()
export class PaginationService {
  /**
   * Creates pagination metadata for API responses
   * @param pageNumber Current page number
   * @param pageSize Items per page
   * @param totalRecords Total number of records
   * @returns PaginationMetadata object
   */
  createPaginationMetadata(
    pageNumber: number,
    pageSize: number,
    totalRecords: number,
  ): PaginationMetadata {
    return {
      pageNumber,
      pageSize,
      totalRecords,
      totalPages: Math.ceil(totalRecords / pageSize),
    }
  }

  /**
   * Calculates the database offset for pagination queries
   * @param pageNumber Current page number
   * @param pageSize Items per page
   * @returns Offset value for database queries
   */
  calculateOffset(pageNumber: number, pageSize: number): number {
    return (pageNumber - 1) * pageSize
  }
}
