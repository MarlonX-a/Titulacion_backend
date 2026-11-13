import { redisConnectionBase } from './redis-options.js';

describe('redisConnectionBase', () => {
  it('usa 127.0.0.1 y no añade contraseña ni TLS por omisión', () => {
    expect(redisConnectionBase({ REDIS_PORT: 6379, REDIS_TLS: false })).toEqual({ host: '127.0.0.1', port: 6379 });
  });

  it('incluye contraseña y TLS cuando están configurados', () => {
    expect(redisConnectionBase({ REDIS_HOST: 'redis.interno', REDIS_PORT: 6380, REDIS_PASSWORD: 'x', REDIS_TLS: true }))
      .toEqual({ host: 'redis.interno', port: 6380, password: 'x', tls: {} });
  });

  it('no impone commandTimeout a quien la reutiliza (BullMQ usa comandos bloqueantes)', () => {
    expect(redisConnectionBase({ REDIS_PORT: 6379, REDIS_TLS: false })).not.toHaveProperty('commandTimeout');
  });
});
