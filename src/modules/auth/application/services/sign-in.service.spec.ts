import { ConfigService } from '@nestjs/config'

import { AuditFacade } from '@/modules/audit/public'
import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { AuthTokenIssuer } from '@/modules/auth/infrastructure/services/auth-token-issuer.service'
import { PasswordService } from '@/modules/auth/infrastructure/services/password.service'
import { SignInService } from './sign-in.service'

describe('SignInService.rejectUnknown', () => {
  const record = jest.fn()
  const countGlobalSince = jest.fn()
  const service = new SignInService(
    {} as UserRepository,
    { burnCompare: jest.fn() } as unknown as PasswordService,
    {} as AuthTokenIssuer,
    { record, countGlobalSince } as unknown as AuditFacade,
    {
      get: () => ({ maxFailedAttempts: 5, lockDurationMs: 900_000 }),
    } as unknown as ConfigService<never, true>,
  )

  const attempt = {
    email: 'nadie@nada.com',
    context: { ip: '1.2.3.4' },
  } as never

  beforeEach(() => {
    record.mockReset()
    countGlobalSince.mockReset()
  })

  it('registra el intento mientras la IP no pasó el tope', async () => {
    countGlobalSince.mockResolvedValue(9)
    await expect(
      service.rejectUnknown('x', 'unknown_user', {}, attempt),
    ).rejects.toBeDefined()
    expect(record).toHaveBeenCalledTimes(1)
    expect(countGlobalSince).toHaveBeenCalledWith(
      'LOGIN_FAILED',
      '1.2.3.4',
      expect.any(Date),
    )
  })

  // Antes cada intento con un email inexistente escribía una fila: una IP
  // podía llenar audit_logs con emails ajenos sin límite.
  it('no persiste más filas de la misma IP pasado el tope, pero igual rechaza', async () => {
    countGlobalSince.mockResolvedValue(10)
    await expect(
      service.rejectUnknown('x', 'unknown_user', {}, attempt),
    ).rejects.toBeDefined()
    expect(record).not.toHaveBeenCalled()
  })

  it('si no se puede contar, registra igual', async () => {
    countGlobalSince.mockRejectedValue(new Error('db'))
    await expect(
      service.rejectUnknown('x', 'unknown_user', {}, attempt),
    ).rejects.toBeDefined()
    expect(record).toHaveBeenCalledTimes(1)
  })
})
