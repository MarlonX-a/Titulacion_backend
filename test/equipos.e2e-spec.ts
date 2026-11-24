import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthenticationService } from '../src/auth/authentication.service.js';
import { configureApplication } from '../src/config/setup-app.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { EquiposConsultaService } from '../src/equipos/equipos-consulta.service.js';
import { EquiposService } from '../src/equipos/equipos.service.js';
import { UsuarioRol } from '../src/usuarios/enums/usuario-rol.enum.js';
import { addUsuarioTestRecord, clearUsuarioTestRecords, DatabaseTestingModule } from './database-testing.module.js';
import { createE2eTestingModule, testConfigService, tokenAuthenticationMock } from './support/e2e-app.js';

describe('Equipos administrativos (e2e)', () => {
  let app: INestApplication<App>;
  const tokens = new Map<string, string>();
  const periodo = '00000000-0000-4000-8000-000000000010';
  const asignacion = '00000000-0000-4000-8000-000000000020';
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const equipo = { id: asignacion, periodo_id: periodo, origen: 'ADMIN', estado: 'VIGENTE', modalidad: 'INDIVIDUAL', integrantes: [], candidatos: [], tutor_vigente: null };
  const equipos = {
    crear: vi.fn(async () => ({ equipo, advertencias: [] })),
    asignarTutorDesdeCandidatos: vi.fn(async () => ({ equipo, advertencias: [] })),
  };
  const consulta = {
    listar: vi.fn(async (_p: string, query: { page: number; limit: number }) => ({ data: [], total: 0, page: query.page, limit: query.limit })),
    detalle: vi.fn(async () => equipo),
  };
  const cuerpo = { estudiante_ids: [uuid(1), uuid(2)], tema_id: uuid(3), docente_ids: [uuid(4), uuid(5)], motivo: '  Acta 7  ' };

  beforeAll(async () => {
    clearUsuarioTestRecords();
    for (const rol of [UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE, UsuarioRol.COORDINADOR]) {
      const user = addUsuarioTestRecord({ email: `${rol.toLowerCase()}-equipos@live.uleam.edu.ec`, id_externo_sso: `equipos-${rol}`, rol, nombres: rol, apellidos: 'Prueba' });
      tokens.set(rol, user.id);
    }
    const module = await createE2eTestingModule({ imports: [AppModule] })
      .overrideModule(DatabaseModule).useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService).useValue(testConfigService())
      .overrideProvider(AuthenticationService).useValue(tokenAuthenticationMock(tokens))
      .overrideProvider(EquiposService).useValue(equipos)
      .overrideProvider(EquiposConsultaService).useValue(consulta)
      .compile();
    app = module.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => { await app.close(); clearUsuarioTestRecords(); tokens.clear(); });
  beforeEach(() => vi.clearAllMocks());

  const http = () => request(app.getHttpServer());
  const rutas = [
    { metodo: 'post' as const, ruta: `/periodos/${periodo}/equipos`, body: cuerpo },
    { metodo: 'get' as const, ruta: `/periodos/${periodo}/equipos` },
    { metodo: 'get' as const, ruta: `/periodos/${periodo}/equipos/${asignacion}` },
    { metodo: 'post' as const, ruta: `/periodos/${periodo}/equipos/${asignacion}/tutor`, body: { candidato_id: uuid(9) } },
  ];

  it('exige autenticación y rol ADMIN en todas las rutas de equipos', async () => {
    for (const { metodo, ruta, body } of rutas) {
      await http()[metodo](ruta).send(body ?? {}).expect(401);
      for (const rol of [UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE, UsuarioRol.COORDINADOR]) {
        await http()[metodo](ruta).set('Authorization', `Bearer ${rol}`).send(body ?? {}).expect(403);
      }
    }
    expect(equipos.crear).not.toHaveBeenCalled();
    expect(equipos.asignarTutorDesdeCandidatos).not.toHaveBeenCalled();
    expect(consulta.listar).not.toHaveBeenCalled();
    expect(consulta.detalle).not.toHaveBeenCalled();
  });

  it('ADMIN conforma un equipo; el cuerpo llega validado y recortado', async () => {
    await http().post(`/periodos/${periodo}/equipos`).set('Authorization', `Bearer ${UsuarioRol.ADMIN}`).send(cuerpo).expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ equipo: { id: asignacion, origen: 'ADMIN' }, advertencias: [] }));
    expect(equipos.crear).toHaveBeenCalledWith(periodo, expect.objectContaining({ ...cuerpo, motivo: 'Acta 7' }), expect.objectContaining({ id: tokens.get(UsuarioRol.ADMIN) }), expect.anything());
  });

  it('rechaza cuerpos inválidos antes del servicio', async () => {
    const admin = { Authorization: `Bearer ${UsuarioRol.ADMIN}` };
    for (const invalido of [
      { ...cuerpo, estudiante_ids: [] },
      { ...cuerpo, docente_ids: [uuid(4), uuid(4)] },
      { ...cuerpo, tema_id: 'tema' },
      { ...cuerpo, motivo: '   ' },
      { ...cuerpo, extra: true },
    ]) {
      await http().post(`/periodos/${periodo}/equipos`).set(admin).send(invalido).expect(400);
    }
    await http().post(`/periodos/no-uuid/equipos`).set(admin).send(cuerpo).expect(400);
    await http().post(`/periodos/${periodo}/equipos/${asignacion}/tutor`).set(admin).send({ candidato_id: 'x' }).expect(400);
    expect(equipos.crear).not.toHaveBeenCalled();
    expect(equipos.asignarTutorDesdeCandidatos).not.toHaveBeenCalled();
  });

  it('transmite las reglas de negocio como 409', async () => {
    equipos.crear.mockRejectedValueOnce(new ConflictException('Briones Ana ya pertenece a un grupo activo en este período.'));
    await http().post(`/periodos/${periodo}/equipos`).set('Authorization', `Bearer ${UsuarioRol.ADMIN}`).send(cuerpo).expect(409)
      .expect(({ body }) => expect(body.message).toBe('Briones Ana ya pertenece a un grupo activo en este período.'));
  });

  it('ADMIN lista, consulta el detalle y confirma un candidato como tutor', async () => {
    const admin = { Authorization: `Bearer ${UsuarioRol.ADMIN}` };
    await http().get(`/periodos/${periodo}/equipos?page=2&limit=5&estado=VIGENTE`).set(admin).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ page: 2, limit: 5 }));
    expect(consulta.listar).toHaveBeenCalledWith(periodo, expect.objectContaining({ page: 2, limit: 5, estado: 'VIGENTE' }));
    await http().get(`/periodos/${periodo}/equipos?estado=OTRO`).set(admin).expect(400);
    await http().get(`/periodos/${periodo}/equipos/${asignacion}`).set(admin).expect(200).expect(({ body }) => expect(body.id).toBe(asignacion));
    await http().post(`/periodos/${periodo}/equipos/${asignacion}/tutor`).set(admin).send({ candidato_id: uuid(9), motivo: ' Elegido en el PAT ' }).expect(200);
    expect(equipos.asignarTutorDesdeCandidatos).toHaveBeenCalledWith(periodo, asignacion, { candidato_id: uuid(9), motivo: 'Elegido en el PAT' }, expect.anything(), expect.anything());
  });
});
