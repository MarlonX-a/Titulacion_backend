import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthenticationService } from '../src/auth/authentication.service.js';
import { configureApplication } from '../src/config/setup-app.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { DocumentosPatService } from '../src/documentos-pat/documentos-pat.service.js';
import { EquiposConsultaService } from '../src/equipos/equipos-consulta.service.js';
import { EquiposService } from '../src/equipos/equipos.service.js';
import { GeneracionesPatService } from '../src/generaciones-pat/generaciones-pat.service.js';
import { PatInversoService } from '../src/pat-inverso/pat-inverso.service.js';
import { UsuarioRol } from '../src/usuarios/enums/usuario-rol.enum.js';
import { addUsuarioTestRecord, clearUsuarioTestRecords, DatabaseTestingModule } from './database-testing.module.js';
import { createE2eTestingModule, testConfigService, tokenAuthenticationMock } from './support/e2e-app.js';

describe('PAT inverso (e2e)', () => {
  let app: INestApplication<App>;
  const tokens = new Map<string, string>();
  const periodo = '00000000-0000-4000-8000-000000000010';
  const asignacion = '00000000-0000-4000-8000-000000000020';
  const estudiante = '00000000-0000-4000-8000-000000000030';
  const preparacion = '00000000-0000-4000-8000-000000000040';
  const ruta = `/periodos/${periodo}/equipos/${asignacion}/integrantes/${estudiante}/pat-inverso`;
  const pat = { preparar: vi.fn(async () => ({ preparacion_id: preparacion, puede_confirmar: true })), confirmar: vi.fn(async () => ({ confirmada: true })) };

  beforeAll(async () => {
    clearUsuarioTestRecords();
    for (const rol of [UsuarioRol.ADMIN, UsuarioRol.ESTUDIANTE, UsuarioRol.DOCENTE]) {
      const user = addUsuarioTestRecord({ email: `${rol.toLowerCase()}-pat-inverso@live.uleam.edu.ec`, id_externo_sso: `pat-inverso-${rol}`, rol, nombres: rol, apellidos: 'Prueba' });
      tokens.set(rol, user.id);
    }
    const module = await createE2eTestingModule({ imports: [AppModule] })
      .overrideModule(DatabaseModule).useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService).useValue(testConfigService())
      .overrideProvider(AuthenticationService).useValue(tokenAuthenticationMock(tokens))
      .overrideProvider(EquiposService).useValue({})
      .overrideProvider(EquiposConsultaService).useValue({})
      .overrideProvider(GeneracionesPatService).useValue({ solicitarParaEstudiante: vi.fn(), descargaDeEstudiante: vi.fn() })
      .overrideProvider(DocumentosPatService).useValue({ cargarFirmadoDeEstudiante: vi.fn() })
      .overrideProvider(PatInversoService).useValue(pat)
      .compile();
    app = module.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => { await app.close(); clearUsuarioTestRecords(); });

  it('solo ADMIN puede cargar el Word del PAT inverso', async () => {
    const http = request(app.getHttpServer());
    await http.post(ruta).expect(401);
    await http.post(ruta).set('Authorization', `Bearer ${UsuarioRol.ESTUDIANTE}`).expect(403);
    await http.post(ruta).set('Authorization', `Bearer ${UsuarioRol.ADMIN}`).expect(400);
    expect(pat.preparar).not.toHaveBeenCalled();
  });

  it('ADMIN confirma la vista previa', async () => {
    await request(app.getHttpServer()).post(`${ruta}/${preparacion}/confirmar`).set('Authorization', `Bearer ${UsuarioRol.ADMIN}`).send({ candidato_id: estudiante }).expect(201);
    expect(pat.confirmar).toHaveBeenCalled();
  });
});
