import { PrismaClient } from '@prisma/client'
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { Logger } from '@nestjs/common'

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super()
    Logger.log('PrismaService initialized', 'PrismaService')
  }

  async onModuleInit() {
    await this.$connect()
    Logger.log('Connected to database', 'PrismaService')
  }

  async onModuleDestroy() {
    await this.$disconnect()
    Logger.log('Disconnected from database', 'PrismaService')
  }
}
