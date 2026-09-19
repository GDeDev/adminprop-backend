import { User } from './entities/user.entity'
import { Role } from './enums/role.enum'
import {
  CannotChangeOwnRoleException,
  CannotDeactivateSelfException,
  CannotResetOwnPasswordException,
  UserNotFoundException,
} from './exceptions/user-management.exceptions'
import { UserManagementPolicy } from './user-management.policy'

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    tenantIsActive: true,
    email: 'ana@ejemplo.com',
    passwordHash: 'hash',
    firstName: 'Ana',
    lastName: 'Gómez',
    role: Role.EMPLOYEE,
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    passwordChangedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

describe('UserManagementPolicy', () => {
  describe('normalizeName', () => {
    it('saca espacios de más', () => {
      expect(UserManagementPolicy.normalizeName('  Ana   María ')).toBe(
        'Ana María',
      )
    })
  })

  describe('requireManageable', () => {
    it('acepta admins y empleados', () => {
      for (const role of [Role.ADMIN, Role.EMPLOYEE]) {
        expect(() =>
          UserManagementPolicy.requireManageable(buildUser({ role }), 'user-1'),
        ).not.toThrow()
      }
    })

    it('un usuario inexistente no se encuentra', () => {
      expect(() => UserManagementPolicy.requireManageable(null, 'x')).toThrow(
        UserNotFoundException,
      )
    })

    it('un propietario o inquilino tampoco: se gestionan desde su ficha', () => {
      for (const role of [Role.OWNER, Role.RENTER]) {
        expect(() =>
          UserManagementPolicy.requireManageable(buildUser({ role }), 'user-1'),
        ).toThrow(UserNotFoundException)
      }
    })
  })

  describe('assertCanChangeRole', () => {
    it('un admin puede cambiarle el rol a otro', () => {
      expect(() =>
        UserManagementPolicy.assertCanChangeRole(
          'admin-1',
          buildUser(),
          Role.ADMIN,
        ),
      ).not.toThrow()
    })

    it('nadie puede cambiarse su propio rol', () => {
      // Así la inmobiliaria nunca se queda sin admin: el único que podría
      // quitarle el rol al último es él mismo.
      const self = buildUser({ id: 'admin-1', role: Role.ADMIN })

      expect(() =>
        UserManagementPolicy.assertCanChangeRole(
          'admin-1',
          self,
          Role.EMPLOYEE,
        ),
      ).toThrow(CannotChangeOwnRoleException)
    })

    it('editar los propios datos dejando el mismo rol está permitido', () => {
      const self = buildUser({ id: 'admin-1', role: Role.ADMIN })

      expect(() =>
        UserManagementPolicy.assertCanChangeRole('admin-1', self, Role.ADMIN),
      ).not.toThrow()
    })
  })

  describe('assertCanDeactivate', () => {
    it('no se puede desactivar a uno mismo', () => {
      expect(() =>
        UserManagementPolicy.assertCanDeactivate(
          'user-1',
          buildUser({ id: 'user-1' }),
        ),
      ).toThrow(CannotDeactivateSelfException)
    })

    it('sí a otro usuario', () => {
      expect(() =>
        UserManagementPolicy.assertCanDeactivate('admin-1', buildUser()),
      ).not.toThrow()
    })
  })

  describe('assertCanResetPassword', () => {
    it('no se puede resetear la propia contraseña sin la actual', () => {
      expect(() =>
        UserManagementPolicy.assertCanResetPassword(
          'user-1',
          buildUser({ id: 'user-1' }),
        ),
      ).toThrow(CannotResetOwnPasswordException)
    })

    it('sí la de otro usuario', () => {
      expect(() =>
        UserManagementPolicy.assertCanResetPassword('admin-1', buildUser()),
      ).not.toThrow()
    })
  })
})
