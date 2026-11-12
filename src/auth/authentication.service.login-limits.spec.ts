import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { argon2id, hash } from 'argon2';
import type { DataSource } from 'typeorm';
import { vi } from 'vitest';
import type { AppEnvironment } from '../config/environment.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import type { AuthRateLimiterService } from './auth-rate-limiter.service.js';
import { AuthenticationService } from './authentication.service.js';

const IP = '10.20.30.40';
const EMAIL = 'estudiante@uleam.edu.ec';
const PASSWORD = 'Clave-temporal-1';

function limiterMock() {
  return {
    enforce: vi.fn().mockResolvedValue(undefined),
    assertBelow: vi.fn().mockResolvedValue(undefined),
    hit: vi.fn().mockResolvedValue(undefined),
  };
}

function dataSourceWith(user: Partial<Usuario> | null, credentials: Record<string, unknown> | null): DataSource {
  return {
    getRepository: (entity: unknown) => ({
      findOneBy: vi.fn().mockResolvedValue(entity === Usuario ? user : credentials),
    }),
  } as unknown as DataSource;
}

async function serviceWith(dataSource: DataSource, limiter: ReturnType<typeof limiterMock>) {
  const config = new ConfigService<AppEnvironment, true>({ NODE_ENV: 'test', AUTH_ISSUER: 'http://127.0.0.1:3000' } as AppEnvironment);
  const service = new AuthenticationService(config, dataSource, limiter as unknown as AuthRateLimiterService);
  await service.onModuleInit();
  return service;
}

describe('AuthenticationService.login (límites)', () => {
  it('consulta el límite de fallos por IP sin contarlo y mantiene el límite por correo', async () => {
    const limiter = limiterMock();
    const service = await serviceWith(dataSourceWith(null, null), limiter);

    await expect(service.login({ email: EMAIL, password: 'incorrecta' }, IP)).rejects.toBeInstanceOf(UnauthorizedException);

    expect(limiter.assertBelow).toHaveBeenCalledWith(`login-ip-failures:${IP}`, 30);
    expect(limiter.enforce).toHaveBeenCalledWith(expect.stringMatching(/^login-email:/), 10, 60);
    expect(limiter.enforce).not.toHaveBeenCalledWith(expect.stringMatching(/^login-ip/), expect.anything(), expect.anything());
  });

  it('cuenta un fallo por IP cuando las credenciales son incorrectas', async () => {
    const limiter = limiterMock();
    const service = await serviceWith(dataSourceWith(null, null), limiter);

    await expect(service.login({ email: EMAIL, password: 'incorrecta' }, IP)).rejects.toBeInstanceOf(UnauthorizedException);

    expect(limiter.hit).toHaveBeenCalledWith(`login-ip-failures:${IP}`, 60);
  });

  it('no cuenta fallos por IP en un inicio de sesión exitoso', async () => {
    const limiter = limiterMock();
    const passwordHash = await hash(PASSWORD, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const user = { id: '00000000-0000-4000-8000-000000000001', estado: UsuarioEstado.ACTIVO };
    const credentials = { usuario_id: user.id, password_hash: passwordHash, requiere_cambio: true, temporal_expira_en: new Date(Date.now() + 60_000) };
    const service = await serviceWith(dataSourceWith(user, credentials), limiter);

    const result = await service.login({ email: EMAIL, password: PASSWORD }, IP);

    expect(result.response.requiere_cambio_clave).toBe(true);
    expect(limiter.hit).not.toHaveBeenCalled();
  });

  it('rechaza con 429 antes de verificar credenciales si la IP superó los fallos permitidos', async () => {
    const limiter = limiterMock();
    limiter.assertBelow.mockRejectedValue(new HttpException('Límite', HttpStatus.TOO_MANY_REQUESTS));
    const dataSource = dataSourceWith(null, null);
    const getRepository = vi.spyOn(dataSource, 'getRepository');
    const service = await serviceWith(dataSource, limiter);

    await expect(service.login({ email: EMAIL, password: 'incorrecta' }, IP)).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(getRepository).not.toHaveBeenCalled();
    expect(limiter.hit).not.toHaveBeenCalled();
  });
});
