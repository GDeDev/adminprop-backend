import { DomainErrorKind, DomainException } from '@/shared/errors'

/**
 * Reglas de la gestión de usuarios internos (spec Fase 4, 3.6) que puede
 * romper un admin. Los errores de login siguen en `auth.exceptions.ts`.
 */

/** Inexistente, de otra inmobiliaria o de portal: para `/users` es lo mismo. */
export class UserNotFoundException extends DomainException {
  constructor(id: string) {
    super('USER_NOT_FOUND', 'El usuario no existe', DomainErrorKind.NotFound, {
      id,
    })
  }
}

export class CannotChangeOwnRoleException extends DomainException {
  constructor() {
    super(
      'USER_CANNOT_CHANGE_OWN_ROLE',
      'No podés cambiar tu propio rol. Pedíselo a otro administrador.',
      DomainErrorKind.BusinessRule,
    )
  }
}

export class CannotDeactivateSelfException extends DomainException {
  constructor() {
    super(
      'USER_CANNOT_DEACTIVATE_SELF',
      'No podés desactivar tu propio usuario.',
      DomainErrorKind.BusinessRule,
    )
  }
}

export class CannotResetOwnPasswordException extends DomainException {
  constructor() {
    super(
      'USER_CANNOT_RESET_OWN_PASSWORD',
      'Para tu propia contraseña usá "Cambiar contraseña": te pide la actual.',
      DomainErrorKind.BusinessRule,
    )
  }
}
