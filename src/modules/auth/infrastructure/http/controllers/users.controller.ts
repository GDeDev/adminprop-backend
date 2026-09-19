import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import { CreateUserCommand } from '@/modules/auth/application/commands/create-user/create-user.command'
import { ResetUserPasswordCommand } from '@/modules/auth/application/commands/reset-user-password/reset-user-password.command'
import { ResetUserPasswordResult } from '@/modules/auth/application/commands/reset-user-password/reset-user-password.handler'
import { SetUserActiveCommand } from '@/modules/auth/application/commands/set-user-active/set-user-active.command'
import { UpdateUserCommand } from '@/modules/auth/application/commands/update-user/update-user.command'
import { GetUserQuery } from '@/modules/auth/application/queries/get-user/get-user.query'
import { ListUsersQuery } from '@/modules/auth/application/queries/list-users/list-users.query'
import { PublicUser } from '@/modules/auth/domain/entities/user.entity'
import { Role } from '@/modules/auth/domain/enums/role.enum'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import { CurrentUser } from '../../decorators/current-user.decorator'
import { Roles } from '../../decorators/roles.decorator'
import { PublicUserDto, RevokedSessionsDto } from '../dtos/auth-response.dto'
import {
  CreateUserDto,
  ListUsersQueryDto,
  ResetUserPasswordDto,
  UpdateUserDto,
} from '../dtos/users.dtos'

/**
 * Gestión de usuarios internos: admins y empleados de la inmobiliaria del
 * admin logueado (spec Fase 4, 3.6). Propietarios e inquilinos no pasan por
 * acá: sus accesos se gestionan desde su ficha (Fases 7 y 8).
 */
@ApiTags('Users')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller({ path: 'users' })
@ApiResponse({
  status: 403,
  description: 'Sólo un admin gestiona usuarios',
  type: ApiErrorDto,
})
export class UsersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar admins y empleados' })
  @ApiPaginatedResponse(PublicUserDto, 'Usuarios de la inmobiliaria')
  async list(
    @Query() query: ListUsersQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<PublicUser>>> {
    const result = await this.queryBus.execute<
      ListUsersQuery,
      PaginatedResult<PublicUser>
    >(
      new ListUsersQuery(
        { role: query.role, isActive: query.isActive },
        { page: query.page, limit: query.limit },
      ),
    )

    return { success: true, message: null, data: result }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver un usuario' })
  @ApiResponse({ status: 200, type: PublicUserDto })
  @ApiResponse({
    status: 404,
    description: 'No existe, es de otra inmobiliaria o es de portal',
    type: ApiErrorDto,
  })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<PublicUser>> {
    const user = await this.queryBus.execute<GetUserQuery, PublicUser>(
      new GetUserQuery(id),
    )

    return { success: true, message: null, data: user }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear un admin o empleado',
    description:
      'El admin define la contraseña inicial y se la pasa a la persona, que después la puede cambiar.',
  })
  @ApiResponse({ status: 201, type: PublicUserDto })
  @ApiResponse({
    status: 409,
    description:
      'Ya hay un usuario interno con ese email (en cualquier inmobiliaria)',
    type: ApiErrorDto,
  })
  async create(@Body() dto: CreateUserDto): Promise<ApiSuccessDto<PublicUser>> {
    const user = await this.commandBus.execute<CreateUserCommand, PublicUser>(
      new CreateUserCommand(
        dto.email,
        dto.firstName,
        dto.lastName,
        dto.role,
        dto.password,
      ),
    )

    return { success: true, message: 'Usuario creado', data: user }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar datos o rol' })
  @ApiResponse({ status: 200, type: PublicUserDto })
  @ApiResponse({
    status: 422,
    description: 'Intentó cambiarse su propio rol',
    type: ApiErrorDto,
  })
  async update(
    @CurrentUser('id') actorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<ApiSuccessDto<PublicUser>> {
    const user = await this.commandBus.execute<UpdateUserCommand, PublicUser>(
      new UpdateUserCommand(actorId, id, {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
      }),
    )

    return { success: true, message: 'Usuario actualizado', data: user }
  }

  @Patch(':id/deactivate')
  @ApiOperation({
    summary: 'Desactivar (no borra)',
    description:
      'Cierra sus sesiones en el acto. No puede loguearse hasta que se reactive.',
  })
  @ApiResponse({ status: 200, type: PublicUserDto })
  @ApiResponse({
    status: 422,
    description: 'Intentó desactivarse a sí mismo',
    type: ApiErrorDto,
  })
  async deactivate(
    @CurrentUser('id') actorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<PublicUser>> {
    const user = await this.commandBus.execute<
      SetUserActiveCommand,
      PublicUser
    >(new SetUserActiveCommand(actorId, id, false))

    return { success: true, message: 'Usuario desactivado', data: user }
  }

  @Patch(':id/activate')
  @ApiOperation({ summary: 'Reactivar un usuario desactivado' })
  @ApiResponse({ status: 200, type: PublicUserDto })
  async activate(
    @CurrentUser('id') actorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<PublicUser>> {
    const user = await this.commandBus.execute<
      SetUserActiveCommand,
      PublicUser
    >(new SetUserActiveCommand(actorId, id, true))

    return { success: true, message: 'Usuario reactivado', data: user }
  }

  @Patch(':id/password')
  @ApiOperation({
    summary: 'Resetear la contraseña de otro usuario',
    description:
      'Cierra todas sus sesiones y le desbloquea la cuenta. Para la propia, usá POST /auth/change-password.',
  })
  @ApiResponse({ status: 200, type: RevokedSessionsDto })
  @ApiResponse({
    status: 422,
    description: 'Intentó resetear su propia contraseña',
    type: ApiErrorDto,
  })
  async resetPassword(
    @CurrentUser('id') actorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResetUserPasswordDto,
  ): Promise<ApiSuccessDto<ResetUserPasswordResult>> {
    const result = await this.commandBus.execute<
      ResetUserPasswordCommand,
      ResetUserPasswordResult
    >(new ResetUserPasswordCommand(actorId, id, dto.newPassword))

    return { success: true, message: 'Contraseña actualizada', data: result }
  }
}
