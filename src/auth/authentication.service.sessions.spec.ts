import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsNull } from 'typeorm';
import {
  auditoriaMock, authenticationServiceWith, fakeDataSource, fakeRepository, limiterMock, primerAccesoMock, throwawayKeyPaths,
} from '../../test/support/auth-service-fakes.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { AppEnvironment } from '../config/environment.js';
import type { AuthRateLimiterService } from './auth-rate-limiter.service.js';
import { AuthenticationService } from './authentication.service.js';
import type { PrimerAccesoService } from './primer-acceso.service.js';
import { tokenDigest } from './credentials.js';
import { CredencialUsuario } from './entities/credencial-usuario.entity.js';
import { SesionRefreshHash } from './entities/sesion-refresh-hash.entity.js';
import { SesionUsuario } from './entities/sesion-usuario.entity.js';
import { SolicitudRecuperacion } from './entities/solicitud-recuperacion.entity.js';
import { hashPassword } from './password-hasher.js';

const IP = '10.20.30.40';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const EMAIL = 'e1300000001@live.uleam.edu.ec';
const CEDULA = '1300000001';
const CURRENT = 'Clave-actual-larga-01';
const NEW_PASSWORD = 'Marea-Volcan-Zafiro-41';

interface SessionRow {
  id: string; usuario_id: string; refresh_hash: string; refresh_anterior_hash: string | null;
  expira_en: Date; revocada_en: Date | null; ultima_actividad: Date | null;
}
interface HistoryRow { sesion_id: string; refresh_hash: string; consumida_en: Date | null }

describe('AuthenticationService (sesiones y recuperación)', () => {
  let keys: ReturnType<typeof throwawayKeyPaths>;
  let currentHash: string;

  beforeAll(async () => {
    keys = throwawayKeyPaths();
    currentHash = await hashPassword(CURRENT);
  });
  afterAll(() => keys.cleanup());

  /** Sesión con historial en memoria: refleja las escrituras para encadenar renovaciones. */
  function sessionStore(initial: Partial<SessionRow> = {}) {
    const session: SessionRow = {
      id: SESSION_ID, usuario_id: USER_ID, refresh_hash: tokenDigest('r1'), refresh_anterior_hash: null,
      expira_en: new Date(Date.now() + 3_600_000), revocada_en: null, ultima_actividad: new Date(), ...initial,
    };
    const history: HistoryRow[] = [{ sesion_id: SESSION_ID, refresh_hash: session.refresh_hash, consumida_en: null }];
    const match = (where: Record<string, unknown>) => (row: object) => Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
    const sesiones = fakeRepository({
      findOne: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(where.id === session.id ? session : null)),
      findOneBy: vi.fn((where: Record<string, unknown>) => Promise.resolve(match(where)(session) ? session : null)),
      save: vi.fn((value: SessionRow) => { Object.assign(session, value); return Promise.resolve(session); }),
      update: vi.fn((where: Record<string, unknown>, changes: Partial<SessionRow>) => {
        const applies = Object.entries(where).every(([key, value]) => value instanceof Object && 'type' in value ? session[key as keyof SessionRow] === null : session[key as keyof SessionRow] === value);
        if (applies) Object.assign(session, changes);
        return Promise.resolve({ affected: applies ? 1 : 0 });
      }),
    });
    const historial = fakeRepository({
      findOneBy: vi.fn((where: Record<string, unknown>) => Promise.resolve(history.find(match(where)) ?? null)),
      save: vi.fn((value: HistoryRow) => Promise.resolve(value)),
      insert: vi.fn((value: HistoryRow) => { history.push({ ...value }); return Promise.resolve(undefined); }),
    });
    const usuarios = fakeRepository({ findOneBy: vi.fn().mockResolvedValue({ id: USER_ID, email: EMAIL, estado: UsuarioEstado.ACTIVO }) });
    const credenciales = fakeRepository({ findOneBy: vi.fn().mockResolvedValue({ usuario_id: USER_ID, requiere_cambio: false }) });
    const fake = fakeDataSource([[SesionUsuario, sesiones], [SesionRefreshHash, historial], [Usuario, usuarios], [CredencialUsuario, credenciales]]);
    return { ...fake, session, history, sesiones };
  }

  async function serviceFor(dataSource: Parameters<typeof authenticationServiceWith>[1], limiter = limiterMock(), auditoria = auditoriaMock(), primerAcceso = primerAccesoMock()) {
    return { service: await authenticationServiceWith(keys, dataSource, limiter, auditoria, primerAcceso), limiter, auditoria, primerAcceso };
  }

  const eventos = (auditoria: ReturnType<typeof auditoriaMock>) => auditoria.registrarEventoSeguridad.mock.calls.map((call) => call[1] as string);
  const accessToken = (service: AuthenticationService) => (service as unknown as { sign(user: string, session: string, first: boolean): Promise<string> }).sign(USER_ID, SESSION_ID, false);

  describe('renovación concurrente (gracia de 10 s)', () => {
    it('carrera benigna: la segunda presentación responde 409 REFRESH_CONCURRENTE y la cookie nueva sigue sirviendo', async () => {
      const store = sessionStore();
      const { service, auditoria } = await serviceFor(store.dataSource);

      const winner = await service.refresh(`${SESSION_ID}.r1`, IP);
      const loser = service.refresh(`${SESSION_ID}.r1`, IP);

      await expect(loser).rejects.toBeInstanceOf(ConflictException);
      await expect(loser).rejects.toMatchObject({ response: { code: 'REFRESH_CONCURRENTE' } });
      expect(store.session.revocada_en).toBeNull();
      expect(store.session.refresh_anterior_hash).toBeNull();
      const next = await service.refresh(winner.refresh_cookie!, IP);
      expect(next.refresh_cookie).toMatch(new RegExp(`^${SESSION_ID}\\.`));
      expect(eventos(auditoria)).toEqual([]);
    });

    it('una segunda presentación del refresh anterior dentro de la ventana revoca la sesión', async () => {
      const store = sessionStore();
      const { service, auditoria } = await serviceFor(store.dataSource);
      await service.refresh(`${SESSION_ID}.r1`, IP);

      await expect(service.refresh(`${SESSION_ID}.r1`, IP)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.refresh(`${SESSION_ID}.r1`, IP)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(store.session.revocada_en).toBeInstanceOf(Date);
      expect(eventos(auditoria)).toEqual(['SESION_REUSO_DETECTADO']);
    });

    it('fuera de la ventana de 10 s la presentación del refresh anterior revoca de inmediato', async () => {
      const store = sessionStore();
      const { service } = await serviceFor(store.dataSource);
      await service.refresh(`${SESSION_ID}.r1`, IP);
      store.history[0]!.consumida_en = new Date(Date.now() - 11_000);

      await expect(service.refresh(`${SESSION_ID}.r1`, IP)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(store.session.revocada_en).toBeInstanceOf(Date);
    });

    it('la renovación está limitada por sesión (30 por minuto)', async () => {
      const store = sessionStore();
      const { service, limiter } = await serviceFor(store.dataSource);

      await service.refresh(`${SESSION_ID}.r1`, IP);

      expect(limiter.enforce).toHaveBeenCalledWith(`refresh:${tokenDigest(SESSION_ID)}`, 30, 60);
    });

    it('la renovación no actualiza la actividad', async () => {
      const lastUse = new Date(Date.now() - 20 * 60_000);
      const store = sessionStore({ ultima_actividad: lastUse });
      const { service } = await serviceFor(store.dataSource);

      await service.refresh(`${SESSION_ID}.r1`, IP);

      expect(store.session.ultima_actividad).toBe(lastUse);
    });
  });

  describe('inactividad (30 min)', () => {
    it('un token de una sesión inactiva se rechaza y la sesión queda revocada', async () => {
      const store = sessionStore({ ultima_actividad: new Date(Date.now() - 31 * 60_000) });
      const { service, auditoria } = await serviceFor(store.dataSource);

      await expect(service.verifyToken(await accessToken(service))).rejects.toBeInstanceOf(UnauthorizedException);

      expect(store.session.revocada_en).toBeInstanceOf(Date);
      expect(eventos(auditoria)).toEqual(['SESION_INACTIVA']);
    });

    it('el uso de la API actualiza la actividad como mucho una vez por minuto', async () => {
      const recent = new Date(Date.now() - 30_000);
      const store = sessionStore({ ultima_actividad: recent });
      const { service } = await serviceFor(store.dataSource);
      const token = await accessToken(service);

      await service.verifyToken(token);
      expect(store.sesiones.update).not.toHaveBeenCalled();

      store.session.ultima_actividad = new Date(Date.now() - 5 * 60_000);
      await service.verifyToken(token);
      expect(store.sesiones.update).toHaveBeenCalledWith({ id: SESSION_ID }, { ultima_actividad: expect.any(Date) });
    });

    it('una sesión sin actividad registrada (NULL) se trata como recién creada', async () => {
      const store = sessionStore({ ultima_actividad: null });
      const { service } = await serviceFor(store.dataSource);

      await expect(service.verifyToken(await accessToken(service))).resolves.toMatchObject({ sessionId: SESSION_ID });
      expect(store.session.ultima_actividad).toBeInstanceOf(Date);
    });

    it('refresh rechaza y revoca una sesión inactiva', async () => {
      const store = sessionStore({ ultima_actividad: new Date(Date.now() - 31 * 60_000) });
      const { service, auditoria } = await serviceFor(store.dataSource);

      await expect(service.refresh(`${SESSION_ID}.r1`, IP)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(store.session.revocada_en).toBeInstanceOf(Date);
      expect(eventos(auditoria)).toEqual(['SESION_INACTIVA']);
    });
  });

  describe('logout', () => {
    it('con un secreto que no corresponde a la sesión no revoca nada', async () => {
      const store = sessionStore();
      const { service, auditoria } = await serviceFor(store.dataSource);

      await service.logout(`${SESSION_ID}.falsificado`, IP);

      expect(store.session.revocada_en).toBeNull();
      expect(auditoria.registrarEventoSeguridad).not.toHaveBeenCalled();
    });

    it('con el refresh vigente revoca la sesión y registra LOGOUT', async () => {
      const store = sessionStore();
      const { service, auditoria } = await serviceFor(store.dataSource);

      await service.logout(`${SESSION_ID}.r1`, IP);

      expect(store.session.revocada_en).toBeInstanceOf(Date);
      expect(eventos(auditoria)).toEqual(['LOGOUT']);
    });

    it('un id de sesión que no es UUID se ignora sin consultar la base de datos', async () => {
      const store = sessionStore();
      const { service } = await serviceFor(store.dataSource);

      await service.logout('no-es-uuid.secreto', IP);
      expect(store.transaction).not.toHaveBeenCalled();
    });
  });

  /** Cuenta de estudiante con contraseña personal, código de recuperación y perfil. */
  function accountStore(estado = UsuarioEstado.ACTIVO) {
    const user = { id: USER_ID, email: EMAIL, nombres: 'Ana María', apellidos: 'López Cedeño', estado };
    const credential = { usuario_id: USER_ID, password_hash: currentHash, requiere_cambio: false, temporal_expira_en: null, version_sesion: 0 };
    const recoveryRow = { id: 'r', usuario_id: USER_ID, usada_en: null };
    const queryBuilder = { where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(), setLock: vi.fn().mockReturnThis(), getOne: vi.fn().mockResolvedValue(recoveryRow) };
    const solicitudes = fakeRepository({ createQueryBuilder: vi.fn(() => queryBuilder) });
    const usuarios = fakeRepository({ findOne: vi.fn().mockResolvedValue(user), findOneBy: vi.fn().mockResolvedValue(user) });
    const credenciales = fakeRepository({ findOne: vi.fn().mockResolvedValue(credential) });
    const estudiantes = fakeRepository({ findOneBy: vi.fn().mockResolvedValue({ cedula: CEDULA, matricula: CEDULA }) });
    const fake = fakeDataSource([[SolicitudRecuperacion, solicitudes], [Usuario, usuarios], [CredencialUsuario, credenciales], [Estudiante, estudiantes]]);
    return { ...fake, solicitudes, queryBuilder, credenciales };
  }

  const voidsRecoveryCodes = (store: ReturnType<typeof accountStore>) => expect(store.solicitudes.update)
    .toHaveBeenCalledWith({ usuario_id: USER_ID, usada_en: IsNull() }, { usada_en: expect.any(Date) });

  describe('anulación de códigos de recuperación', () => {
    it('un restablecimiento correcto anula todos los códigos abiertos y registra RECUPERACION_COMPLETADA', async () => {
      const store = accountStore();
      const { service, auditoria } = await serviceFor(store.dataSource);

      await service.resetPassword({ code: 'c'.repeat(43), password: NEW_PASSWORD }, IP);

      voidsRecoveryCodes(store);
      expect(eventos(auditoria)).toEqual(['RECUPERACION_COMPLETADA']);
    });

    it('cambiar la contraseña anula los códigos abiertos y registra CAMBIO_CLAVE', async () => {
      const store = accountStore();
      const { service, limiter, auditoria } = await serviceFor(store.dataSource);

      await service.changePassword(USER_ID, { current_password: CURRENT, password: NEW_PASSWORD }, IP);

      expect(limiter.enforce).toHaveBeenCalledWith(`chgpw:${USER_ID}`, 5, 900);
      voidsRecoveryCodes(store);
      expect(eventos(auditoria)).toEqual(['CAMBIO_CLAVE']);
    });

    it('el primer acceso anula los códigos abiertos y registra PRIMER_ACCESO', async () => {
      const store = accountStore();
      store.credenciales.findOne.mockResolvedValue({ usuario_id: USER_ID, password_hash: currentHash, requiere_cambio: true, temporal_expira_en: new Date(Date.now() + 60_000), version_sesion: 0 });
      const { service, limiter, auditoria, primerAcceso } = await serviceFor(store.dataSource);

      await service.changeInitialPassword(USER_ID, { password: NEW_PASSWORD }, IP);

      expect(limiter.enforce).toHaveBeenCalledWith(`first:${USER_ID}`, 10, 900);
      voidsRecoveryCodes(store);
      expect(eventos(auditoria)).toEqual(['PRIMER_ACCESO']);
      // El aviso al titular va en la misma transacción; la vigilancia por IP, tras confirmarla.
      expect(primerAcceso.avisarAlTitular).toHaveBeenCalledWith(expect.anything(), USER_ID);
      expect(primerAcceso.vigilarActivacionesPorIp).toHaveBeenCalledWith(IP);
    });

    it('un primer acceso rechazado no avisa al titular ni cuenta la activación por IP', async () => {
      const store = accountStore();
      store.credenciales.findOne.mockResolvedValue({ usuario_id: USER_ID, password_hash: currentHash, requiere_cambio: true, temporal_expira_en: new Date(Date.now() - 60_000), version_sesion: 0 });
      const { service, primerAcceso } = await serviceFor(store.dataSource);

      await expect(service.changeInitialPassword(USER_ID, { password: NEW_PASSWORD }, IP)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(primerAcceso.avisarAlTitular).not.toHaveBeenCalled();
      expect(primerAcceso.vigilarActivacionesPorIp).not.toHaveBeenCalled();
    });

    it('el restablecimiento de una cuenta INACTIVO responde 401 y cuenta el fallo por IP', async () => {
      const store = accountStore(UsuarioEstado.INACTIVO);
      const { service, limiter } = await serviceFor(store.dataSource);

      await expect(service.resetPassword({ code: 'c'.repeat(43), password: NEW_PASSWORD }, IP)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(limiter.assertBelow).toHaveBeenCalledWith(`reset-ip-fail:${IP}`, 30);
      expect(limiter.hit).toHaveBeenCalledWith(`reset-ip-fail:${IP}`, 900);
      expect(store.solicitudes.update).not.toHaveBeenCalled();
    });

    it('el restablecimiento aplica la política de contraseñas', async () => {
      const store = accountStore();
      const { service, limiter } = await serviceFor(store.dataSource);

      await expect(service.resetPassword({ code: 'c'.repeat(43), password: `${CEDULA}-Clave!` }, IP)).rejects.toBeInstanceOf(BadRequestException);
      expect(limiter.hit).not.toHaveBeenCalled();
    });

    it('el cambio de contraseña aplica la política (parte local del correo)', async () => {
      const store = accountStore();
      const { service } = await serviceFor(store.dataSource);

      await expect(service.changePassword(USER_ID, { current_password: CURRENT, password: 'e1300000001-Segura' }, IP)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('solicitud de recuperación', () => {
    it('supera el límite por correo en silencio, sin buscar la cuenta', async () => {
      const store = accountStore();
      const limiter = limiterMock();
      limiter.hit.mockResolvedValue(4);
      const { service } = await serviceFor(store.dataSource, limiter);

      await expect(service.requestPasswordReset({ email: EMAIL }, IP)).resolves.toBeUndefined();
      await service.onModuleDestroy();

      expect(limiter.enforce).toHaveBeenCalledWith(`reset-ip:${IP}`, 60, 3600);
      expect(store.getRepository).not.toHaveBeenCalledWith(Usuario);
    });

    it('emite el código fuera de la respuesta y un error de ese trabajo no se propaga', async () => {
      const store = accountStore();
      store.transaction.mockRejectedValueOnce(new Error('base de datos caída'));
      const { service } = await serviceFor(store.dataSource);

      await expect(service.requestPasswordReset({ email: EMAIL }, IP)).resolves.toBeUndefined();
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();

      expect(store.transaction).toHaveBeenCalledTimes(1);
    });

    it('al cerrar el módulo espera a que termine la emisión del código', async () => {
      const store = accountStore();
      const { service, auditoria } = await serviceFor(store.dataSource);

      await service.requestPasswordReset({ email: EMAIL }, IP);
      await service.onModuleDestroy();

      expect(eventos(auditoria)).toEqual(['RECUPERACION_SOLICITADA']);
    });
  });
});

describe('AuthenticationService (claves JWT)', () => {
  it('sin rutas de claves configuradas no arranca, ni siquiera con NODE_ENV=test', async () => {
    const config = new ConfigService<AppEnvironment, true>({ NODE_ENV: 'test', AUTH_ISSUER: 'http://127.0.0.1:3000' } as AppEnvironment);
    const service = new AuthenticationService(config, fakeDataSource().dataSource, limiterMock() as unknown as AuthRateLimiterService, auditoriaMock() as unknown as AuditoriaService, primerAccesoMock() as unknown as PrimerAccesoService);

    await expect(service.onModuleInit()).rejects.toMatchObject({ status: 503 });
  });
});
