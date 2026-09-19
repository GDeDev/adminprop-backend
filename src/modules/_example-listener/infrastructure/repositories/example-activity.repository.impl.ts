import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
  ExampleActivity,
  ExampleActivityRepository,
} from '@/modules/_example-listener/domain/example-activity.repository'
import { PrismaService } from '@/shared/prisma/prisma.service'

@Injectable()
export class ExampleActivityRepositoryImpl extends ExampleActivityRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  record(exampleItemId: string, description: string): Promise<ExampleActivity> {
    // Sin tenantId: lo completa el filtro de tenant (el consumidor corre dentro
    // del tenant del mensaje).
    return this.prisma.db.exampleActivity.create({
      data: {
        exampleItemId,
        description,
      } as Prisma.ExampleActivityUncheckedCreateInput,
      select: {
        id: true,
        exampleItemId: true,
        description: true,
        createdAt: true,
      },
    })
  }

  listFor(exampleItemId: string): Promise<ExampleActivity[]> {
    return this.prisma.db.exampleActivity.findMany({
      where: { exampleItemId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        exampleItemId: true,
        description: true,
        createdAt: true,
      },
    })
  }
}
