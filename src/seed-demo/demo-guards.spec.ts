import {
  applyDemoSeedEnvironment,
  assertDemoSeedAllowed,
  DEMO_SEED_FORCED_ENV,
  DemoSeedRefusedError,
} from './demo-guards'

const LOCAL_DB =
  'postgresql://adminprop:adminprop@localhost:5432/adminprop_development'

describe('guardas del seed de demo', () => {
  it.each(['production', 'qa', 'staging', 'Production', 'prod'])(
    'se niega con NODE_ENV=%s',
    (nodeEnv) => {
      expect(() =>
        assertDemoSeedAllowed({ nodeEnv, databaseUrl: LOCAL_DB }),
      ).toThrow(DemoSeedRefusedError)
    },
  )

  it('el mensaje de rechazo dice qué entorno lo frenó', () => {
    expect(() =>
      assertDemoSeedAllowed({ nodeEnv: 'production', databaseUrl: LOCAL_DB }),
    ).toThrow(/NODE_ENV=production/)
  })

  it.each([undefined, '', 'development', 'test'])(
    'corre con NODE_ENV=%p y una base local',
    (nodeEnv) => {
      expect(() =>
        assertDemoSeedAllowed({ nodeEnv, databaseUrl: LOCAL_DB }),
      ).not.toThrow()
    },
  )

  it.each([
    'postgresql://u:p@db.example.neon.tech:5432/adminprop_development',
    'postgresql://u:p@10.0.0.5:5432/adminprop_development',
    'postgresql://u:p@prod-db.internal:5432/adminprop',
  ])('se niega si la base no es local (%s)', (databaseUrl) => {
    expect(() =>
      assertDemoSeedAllowed({ nodeEnv: 'development', databaseUrl }),
    ).toThrow(/no parece local/)
  })

  it.each([
    'postgresql://u:p@localhost:5432/adminprop_production',
    'postgresql://u:p@localhost:5432/adminprop_prod',
    'postgresql://u:p@localhost:5432/qa',
    'postgresql://u:p@localhost:5432/adminprop-staging',
  ])(
    'se niega si el nombre de la base parece de otro entorno (%s)',
    (databaseUrl) => {
      expect(() =>
        assertDemoSeedAllowed({ nodeEnv: 'development', databaseUrl }),
      ).toThrow(/otro entorno/)
    },
  )

  it('acepta el Postgres del docker-compose y las bases de test', () => {
    expect(() =>
      assertDemoSeedAllowed({
        nodeEnv: 'development',
        databaseUrl:
          'postgresql://adminprop:adminprop@postgres:5432/adminprop_development',
      }),
    ).not.toThrow()
    expect(() =>
      assertDemoSeedAllowed({
        nodeEnv: 'test',
        databaseUrl:
          'postgresql://adminprop:adminprop@127.0.0.1:5432/adminprop_test',
      }),
    ).not.toThrow()
  })

  it('se niega sin DATABASE_URL o con una URL ilegible', () => {
    expect(() =>
      assertDemoSeedAllowed({ nodeEnv: 'development', databaseUrl: undefined }),
    ).toThrow(/Falta DATABASE_URL/)
    expect(() =>
      assertDemoSeedAllowed({
        nodeEnv: 'development',
        databaseUrl: 'no-es-una-url',
      }),
    ).toThrow(DemoSeedRefusedError)
  })

  it('el NODE_ENV se chequea antes que la base: producción nunca llega a conectarse', () => {
    expect(() =>
      assertDemoSeedAllowed({ nodeEnv: 'production', databaseUrl: undefined }),
    ).toThrow(/NODE_ENV=production/)
  })
})

describe('entorno forzado del seed de demo', () => {
  it('apaga cola real, mails, portales y Cloudinary dentro del proceso', () => {
    const env: Record<string, string | undefined> = {
      EMAIL_PROVIDER: 'resend',
      STORAGE_PROVIDER: 'cloudinary',
      SITES_REVALIDATE_URL: 'https://sites.example.com/revalidate',
    }
    applyDemoSeedEnvironment(env)

    for (const [key, value] of Object.entries(DEMO_SEED_FORCED_ENV)) {
      expect(env[key]).toBe(value)
    }
    expect(env.EMAIL_PROVIDER).toBe('console')
    expect(env.STORAGE_PROVIDER).toBe('local')
    expect(env.SITES_REVALIDATE_URL).toBeUndefined()
    expect(env.NODE_ENV).toBe('development')
  })

  it('respeta un NODE_ENV ya definido', () => {
    const env: Record<string, string | undefined> = { NODE_ENV: 'test' }
    applyDemoSeedEnvironment(env)
    expect(env.NODE_ENV).toBe('test')
  })
})
