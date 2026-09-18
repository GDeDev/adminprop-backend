#!/usr/bin/env ts-node
/**
 * Quick test script to verify the enhanced logger functionality
 * Run with: npx ts-node scripts/test-logger.ts
 */

import { CustomLoggerService } from '../src/shared/core/logger.service'

async function testLogger() {
  console.log('🧪 Testing Enhanced Logger Service...\n')

  const logger = new CustomLoggerService('TestLogger')

  // Test basic logging
  console.log('1. Testing basic log levels:')
  logger.error('This is an error message', undefined, {
    operation: 'test_error',
    errorCode: 500,
  })

  logger.warn('This is a warning message', {
    operation: 'test_warning',
    warningType: 'deprecation',
  })

  logger.log('This is an info message', {
    operation: 'test_info',
    userId: 'user-123',
  })

  logger.debug('This is a debug message', {
    operation: 'test_debug',
    debugInfo: 'detailed debugging information',
  })

  // Test specialized methods
  console.log('\n2. Testing specialized logging methods:')

  logger.logApiCall('GET', '/api/v1/examples', 200, 45, {
    correlationId: 'test-correlation-123',
    userId: 'user-456',
  })

  logger.logCommandExecution('CreateUserCommand', 120, true, {
    correlationId: 'test-correlation-123',
    entityId: 'user-789',
  })

  logger.logQueryExecution('GetUsersQuery', 80, 15, {
    correlationId: 'test-correlation-123',
    filters: { active: true },
  })

  logger.logBusinessOperation('user_registration', 'user-789', 'admin-123', {
    correlationId: 'test-correlation-123',
    registrationType: 'email',
  })

  console.log('\n✅ Logger test completed! Check the output above.')
  console.log('💡 In development, you should see colored, readable logs.')
  console.log('💡 In production (NODE_ENV=production), you would see JSON logs.')
}

if (require.main === module) {
  testLogger().catch(console.error)
}

export { testLogger }
