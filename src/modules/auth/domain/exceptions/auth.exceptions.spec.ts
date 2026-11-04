import { ErrorCode } from '@/shared/errors/error-codes'
import { AuthErrors } from './auth.exceptions'

describe('AuthErrors.emailAlreadyRegistered', () => {
  // El email de staff es único global: el mensaje no debe confirmar que existe
  // "una cuenta registrada" (podría ser de otra inmobiliaria).
  it('usa un mensaje genérico y conserva el código estable', () => {
    const error = AuthErrors.emailAlreadyRegistered()
    expect(error.message).not.toMatch(/cuenta|registrad/i)
    expect(JSON.stringify(error.getResponse())).toContain(
      ErrorCode.EMAIL_ALREADY_REGISTERED,
    )
  })
})
