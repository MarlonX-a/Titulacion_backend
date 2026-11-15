import { HttpException, HttpStatus, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { argon2id, hash } from 'argon2';
import {
  auditoriaMock, authenticationServiceWith, fakeDataSource, fakeRepository, limiterMock, throwawayKeyPaths,
} from '../../test/support/auth-service-fakes.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { tokenDigest } from './credentials.js';
import { CredencialUsuario } from './entities/credencial-usuario.entity.js';
import { SesionUsuario } from './entities/sesion-usuario.entity.js';
import { hashPassword, needsRehash } from './password-hasher.js';

const IP = '10.20.30.40';
const EMAIL = 'estudiante@live.uleam.edu.ec';
const PASSWORD = 'Clave-personal-larga-1';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const DEVICE = 'dispositivo-conocido-0123456789abcdefghijklmn';
const EMAIL_DIGEST = tokenDigest(EMAIL);
const DEVICE_DIGEST = tokenDigest(DEVICE);

const tooMany = () => new HttpException('Límite', HttpStatus.TOO_MANY_REQUESTS);

describe('AuthenticationService.login (límites y eventos)', () => {
  let keys: ReturnType<typeof throwawayKeyPaths>;
  let passwordHash: string;

  beforeAll(async () => {
    keys = throwawayKeyPaths();
    passwordHash = await hashPassword(PASSWORD);
  });
  afterAll(() => keys.cleanup());

  /** Cuenta activa con contraseña personal; `credential` permite variar la credencial. */
  function scenario(options: { user?: Partial<Usuario> | null; credential?: Record<string, unknown> | null } = {}) {
    const user = options.user === undefined ? { id: USER_ID, email: EMAIL, estado: UsuarioEstado.ACTIVO } : options.user;
    const credential = options.credential === undefined
      ? { usuario_id: USER_ID, password_hash: passwordHash, requiere_cambio: false, temporal_expira_en: null, version_sesion: 0 }
      : options.credential;
    const usuarios = fakeRepository({ findOneBy: vi.fn().mockResolvedValue(user) });
    const credenciales = fakeRepository({ findOneBy: vi.fn().mockResolvedValue(credential) });
    const sesiones = fakeRepository({ save: vi.fn((value: Record<string, unknown>) => Promise.resolve({ ...value, id: '00000000-0000-4000-8000-0000000000aa' })) });
    const fake = fakeDataSource([[Usuario, usuarios], [CredencialUsuario, credenciales], [SesionUsuario, sesiones]]);
    return { ...fake, usuarios, credenciales, sesiones };
  }

  async function serviceFor(fake: { dataSource: Parameters<typeof authenticationServiceWith>[1] }, limiter = limiterMock(), auditoria = auditoriaMock()) {
    return { service: await authenticationServiceWith(keys, fake.dataSource, limiter, auditoria), limiter, auditoria };
  }

  const eventos = (auditoria: ReturnType<typeof auditoriaMock>) => auditoria.registrarEventoSeguridad.mock.calls.map((call) => call[1] as string);

  describe('dispositivo no conocido', () => {
    it('reserva un cupo por IP (30/60 s) y por correo (10/900 s) antes de verificar y lo devuelve si el login es correcto', async () => {
      const { service, limiter } = await serviceFor(scenario());

      await service.login({ email: EMAIL, password: PASSWORD }, IP);

      expect(limiter.reserve.mock.calls).toEqual([[`login-ip-fail:${IP}`, 30, 60], [`login-email-fail:${EMAIL_DIGEST}`, 10, 900]]);
      expect(limiter.release.mock.calls).toEqual([[`login-ip-fail:${IP}`], [`login-email-fail:${EMAIL_DIGEST}`]]);
      expect(limiter.hit).not.toHaveBeenCalled();
      expect(limiter.enforce).not.toHaveBeenCalled();
    });

    it('un fallo conserva las reservas de IP y correo (son el contador de fallos) y cuenta en el detector (3600 s)', async () => {
      const { service, limiter } = await serviceFor(scenario());

      await expect(service.login({ email: EMAIL, password: 'incorrecta-123' }, IP)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(limiter.reserve).toHaveBeenCalledTimes(2);
      expect(limiter.release).not.toHaveBeenCalled();
      expect(limiter.hit.mock.calls).toEqual([[`login-email-total:${EMAIL_DIGEST}`, 3600]]);
    });

    it('40 intentos fallidos simultáneos contra un correo verifican la contraseña como máximo 10 veces', async () => {
      const fake = scenario();
      const limiter = limiterMock();
      const contadores = new Map<string, number>();
      const pausa = () => new Promise((resolve) => setImmediate(resolve));
      // Limitador en memoria con la misma semántica que Redis: cada operación es atómica, pero
      // entre operaciones pasa un turno del bucle de eventos, como en solicitudes reales.
      limiter.assertBelow.mockImplementation(async (key: string, limit: number) => { await pausa(); if ((contadores.get(key) ?? 0) >= limit) throw tooMany(); });
      limiter.hit.mockImplementation(async (key: string) => { await pausa(); const total = (contadores.get(key) ?? 0) + 1; contadores.set(key, total); return total; });
      limiter.reserve.mockImplementation(async (key: string, limit: number) => {
        await pausa();
        const total = (contadores.get(key) ?? 0) + 1;
        if (total > limit) return false;
        contadores.set(key, total);
        return true;
      });
      limiter.release.mockImplementation(async (key: string) => { await pausa(); contadores.set(key, Math.max(0, (contadores.get(key) ?? 0) - 1)); });
      const { service } = await serviceFor(fake, limiter);

      const resultados = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => service.login({ email: EMAIL, password: `incorrecta-${i}` }, `10.0.0.${i + 1}`)));

      const estados = resultados.map((resultado) => (resultado.status === 'rejected' ? (resultado.reason as HttpException).getStatus() : 200));
      expect(fake.credenciales.findOneBy.mock.calls.length).toBeLessThanOrEqual(10);
      expect(estados.filter((estado) => estado === 401).length).toBeLessThanOrEqual(10);
      expect(estados.filter((estado) => estado === 429).length).toBeGreaterThanOrEqual(30);
    });

    it('un correo inexistente cuenta el fallo pero no deja evento de auditoría', async () => {
      const { service, limiter, auditoria } = await serviceFor(scenario({ user: null, credential: null }));

      await expect(service.login({ email: EMAIL, password: 'incorrecta-123' }, IP)).rejects.toMatchObject({ message: 'Correo o contraseña incorrectos.' });

      expect(limiter.reserve).toHaveBeenCalledTimes(2);
      expect(limiter.release).not.toHaveBeenCalled();
      expect(limiter.hit).toHaveBeenCalledTimes(1);
      expect(auditoria.registrarEventoSeguridad).not.toHaveBeenCalled();
    });

    it('un login correcto no consume cupo y emite una cookie de dispositivo nueva ligada al correo', async () => {
      const { service, limiter } = await serviceFor(scenario());

      const result = await service.login({ email: EMAIL, password: PASSWORD }, IP);

      expect(result.device_cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(limiter.remember).toHaveBeenCalledWith(`device:${tokenDigest(result.device_cookie!)}`, EMAIL_DIGEST, 7_776_000);
      expect(limiter.reset).not.toHaveBeenCalled();
      expect(limiter.release).toHaveBeenCalledTimes(2);
      expect(limiter.hit).not.toHaveBeenCalled();
    });

    it('el primer acceso con clave temporal correcta también devuelve las reservas', async () => {
      const credential = { usuario_id: USER_ID, password_hash: passwordHash, requiere_cambio: true, temporal_expira_en: new Date(Date.now() + 60_000) };
      const { service, limiter } = await serviceFor(scenario({ credential }));

      await service.login({ email: EMAIL, password: PASSWORD }, IP);

      expect(limiter.release).toHaveBeenCalledTimes(2);
    });

    it('si falla la base de datos durante la verificación, devuelve las reservas (no es un fallo de contraseña)', async () => {
      const fake = scenario();
      fake.credenciales.findOneBy.mockRejectedValue(new Error('conexión perdida'));
      const { service, limiter } = await serviceFor(fake);

      await expect(service.login({ email: EMAIL, password: PASSWORD }, IP)).rejects.toBeDefined();

      expect(limiter.release).toHaveBeenCalledTimes(2);
      expect(limiter.hit).not.toHaveBeenCalled();
    });

    it('con un contador lleno responde 429 sin verificar la contraseña, libera las reservas ya tomadas y registra LOGIN_BLOQUEADO una vez', async () => {
      const fake = scenario();
      const limiter = limiterMock();
      limiter.reserve.mockImplementation((key: string) => Promise.resolve(!key.startsWith('login-email-fail:')));
      limiter.rememberOnce.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      const { service, auditoria } = await serviceFor(fake, limiter);

      await expect(service.login({ email: EMAIL, password: PASSWORD }, IP)).rejects.toMatchObject({ status: 429 });
      await expect(service.login({ email: EMAIL, password: PASSWORD }, IP)).rejects.toMatchObject({ status: 429 });

      expect(fake.credenciales.findOneBy).not.toHaveBeenCalled();
      expect(limiter.hit).not.toHaveBeenCalled();
      expect(limiter.release.mock.calls).toEqual([[`login-ip-fail:${IP}`], [`login-ip-fail:${IP}`]]);
      expect(limiter.rememberOnce).toHaveBeenCalledWith(`evt-bloqueo:login-email-fail:${EMAIL_DIGEST}`, 900);
      expect(eventos(auditoria)).toEqual(['LOGIN_BLOQUEADO']);
      expect(auditoria.registrarEventoSeguridad.mock.calls[0]?.[2]).toMatchObject({ usuarioId: USER_ID, ip: IP, detalles: { limite: 'correo' } });
    });
  });

  describe('dispositivo conocido', () => {
    function trustedLimiter() {
      const limiter = limiterMock();
      limiter.recall.mockImplementation((key: string) => Promise.resolve(key === `device:${DEVICE_DIGEST}` ? EMAIL_DIGEST : null));
      return limiter;
    }

    it('solo reserva en el contador del dispositivo: un ataque por IP o por correo no lo bloquea', async () => {
      const limiter = trustedLimiter();
      limiter.reserve.mockImplementation((key: string) => Promise.resolve(key.startsWith('login-dev-fail:')));
      const { service } = await serviceFor(scenario(), limiter);

      const result = await service.login({ email: EMAIL, password: PASSWORD }, IP, DEVICE);

      expect(result.refresh_cookie).toBeTruthy();
      expect(limiter.reserve.mock.calls).toEqual([[`login-dev-fail:${DEVICE_DIGEST}`, 10, 900]]);
    });

    it('al entrar vacía el contador del dispositivo y renueva la misma cookie', async () => {
      const limiter = trustedLimiter();
      const { service } = await serviceFor(scenario(), limiter);

      const result = await service.login({ email: EMAIL, password: PASSWORD }, IP, DEVICE);

      expect(result.device_cookie).toBe(DEVICE);
      expect(limiter.reset).toHaveBeenCalledWith(`login-dev-fail:${DEVICE_DIGEST}`);
      expect(limiter.remember).toHaveBeenCalledWith(`device:${DEVICE_DIGEST}`, EMAIL_DIGEST, 7_776_000);
    });

    it('un fallo cuenta solo en el dispositivo (900 s) y en el detector', async () => {
      const limiter = trustedLimiter();
      const { service } = await serviceFor(scenario(), limiter);

      await expect(service.login({ email: EMAIL, password: 'incorrecta-123' }, IP, DEVICE)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(limiter.reserve.mock.calls).toEqual([[`login-dev-fail:${DEVICE_DIGEST}`, 10, 900]]);
      expect(limiter.release).not.toHaveBeenCalled();
      expect(limiter.hit.mock.calls).toEqual([[`login-email-total:${EMAIL_DIGEST}`, 3600]]);
    });

    it('una cookie registrada para otro correo no da confianza', async () => {
      const limiter = limiterMock();
      limiter.recall.mockResolvedValue(tokenDigest('otra.cuenta@live.uleam.edu.ec'));
      const { service } = await serviceFor(scenario(), limiter);

      const result = await service.login({ email: EMAIL, password: PASSWORD }, IP, DEVICE);

      expect(limiter.reserve.mock.calls.map((call) => call[0])).toEqual([`login-ip-fail:${IP}`, `login-email-fail:${EMAIL_DIGEST}`]);
      expect(result.device_cookie).not.toBe(DEVICE);
    });
  });

  describe('resultado de la verificación', () => {
    it('una cuenta INACTIVO con la contraseña correcta recibe el mismo 401 genérico y cuenta como fallo', async () => {
      const { service, limiter, auditoria } = await serviceFor(scenario({ user: { id: USER_ID, email: EMAIL, estado: UsuarioEstado.INACTIVO } }));

      await expect(service.login({ email: EMAIL, password: PASSWORD }, IP)).rejects.toMatchObject({ status: 401, message: 'Correo o contraseña incorrectos.' });

      expect(limiter.reserve).toHaveBeenCalledWith(`login-email-fail:${EMAIL_DIGEST}`, 10, 900);
      expect(limiter.release).not.toHaveBeenCalled();
      expect(eventos(auditoria)).toEqual(['LOGIN_FALLIDO']);
    });

    it('LOGIN_FALLIDO se registra una vez por (usuario, IP) y ventana de 900 s', async () => {
      const limiter = limiterMock();
      limiter.rememberOnce.mockResolvedValueOnce(true).mockResolvedValue(false);
      const { service, auditoria } = await serviceFor(scenario(), limiter);

      for (let i = 0; i < 3; i += 1) await expect(service.login({ email: EMAIL, password: `incorrecta-${i}` }, IP)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(limiter.rememberOnce).toHaveBeenCalledWith(`evt-fallo:${USER_ID}:${IP}`, 900);
      expect(eventos(auditoria)).toEqual(['LOGIN_FALLIDO']);
    });

    it('el detector registra FUERZA_BRUTA_SOSPECHADA al llegar a 50 fallos, sin bloquear', async () => {
      const limiter = limiterMock();
      limiter.hit.mockImplementation((key: string) => Promise.resolve(key.startsWith('login-email-total:') ? 50 : 1));
      const { service, auditoria } = await serviceFor(scenario(), limiter);

      await expect(service.login({ email: EMAIL, password: 'incorrecta-123' }, IP)).rejects.toMatchObject({ status: 401 });

      expect(limiter.rememberOnce).toHaveBeenCalledWith(`evt-fuerza:${EMAIL_DIGEST}`, 3600);
      expect(eventos(auditoria)).toEqual(['LOGIN_FALLIDO', 'FUERZA_BRUTA_SOSPECHADA']);
    });

    it('un login completo registra LOGIN_EXITOSO dentro de la transacción de la sesión', async () => {
      const fake = scenario();
      const { service, auditoria } = await serviceFor(fake);

      await service.login({ email: EMAIL, password: PASSWORD }, IP);

      expect(eventos(auditoria)).toEqual(['LOGIN_EXITOSO']);
      expect(auditoria.registrarEventoSeguridad.mock.calls[0]?.[0]).toBe(fake.dataSource.manager);
      expect(fake.sesiones.create).toHaveBeenCalledWith(expect.objectContaining({ ultima_actividad: expect.any(Date) }));
    });

    it('el primer acceso no emite cookie de dispositivo ni sesión', async () => {
      const credential = { usuario_id: USER_ID, password_hash: passwordHash, requiere_cambio: true, temporal_expira_en: new Date(Date.now() + 60_000) };
      const { service, limiter, auditoria } = await serviceFor(scenario({ credential }));

      const result = await service.login({ email: EMAIL, password: PASSWORD }, IP);

      expect(result.response.requiere_cambio_clave).toBe(true);
      expect(result.device_cookie).toBeUndefined();
      expect(limiter.remember).not.toHaveBeenCalled();
      expect(auditoria.registrarEventoSeguridad).not.toHaveBeenCalled();
    });

    it('regenera un hash con parámetros antiguos tras un login correcto', async () => {
      const oldHash = await hash(PASSWORD, { type: argon2id, memoryCost: 4096, timeCost: 3, parallelism: 1 });
      const fake = scenario({ credential: { usuario_id: USER_ID, password_hash: oldHash, requiere_cambio: false, temporal_expira_en: null } });
      const { service } = await serviceFor(fake);

      await service.login({ email: EMAIL, password: PASSWORD }, IP);

      expect(fake.credenciales.update).toHaveBeenCalledWith({ usuario_id: USER_ID, password_hash: oldHash }, { password_hash: expect.any(String) });
      const [, changes] = fake.credenciales.update.mock.calls[0] as [unknown, { password_hash: string }];
      expect(needsRehash(changes.password_hash)).toBe(false);
    });
  });

  describe('Redis', () => {
    it('falla cerrado con 503 si no se pueden reservar los contadores y libera las reservas ya tomadas', async () => {
      const fake = scenario();
      const limiter = limiterMock();
      limiter.reserve.mockImplementation((key: string) => key.startsWith('login-email-fail:')
        ? Promise.reject(new ServiceUnavailableException('El servicio de autenticación no está disponible.')) : Promise.resolve(true));
      const { service } = await serviceFor(fake, limiter);

      await expect(service.login({ email: EMAIL, password: PASSWORD }, IP)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fake.credenciales.findOneBy).not.toHaveBeenCalled();
      expect(limiter.release.mock.calls).toEqual([[`login-ip-fail:${IP}`]]);
    });

    it('si falla el registro del dispositivo o del evento, el login correcto sigue siendo válido', async () => {
      const limiter = limiterMock();
      limiter.remember.mockRejectedValue(new ServiceUnavailableException('caído'));
      const { service } = await serviceFor(scenario(), limiter);

      const result = await service.login({ email: EMAIL, password: PASSWORD }, IP);

      expect(result.refresh_cookie).toBeTruthy();
      expect(result.device_cookie).toBeUndefined();
    });

    it('si falla la marca SET NX del evento, el 401 no se convierte en 503', async () => {
      const limiter = limiterMock();
      limiter.rememberOnce.mockRejectedValue(new ServiceUnavailableException('caído'));
      const { service, auditoria } = await serviceFor(scenario(), limiter);

      await expect(service.login({ email: EMAIL, password: 'incorrecta-123' }, IP)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(auditoria.registrarEventoSeguridad).not.toHaveBeenCalled();
    });
  });
});
