import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import { ArchivoLimpiezaService } from '../almacenamiento/archivo-limpieza.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { ExportacionEstado } from './enums/exportacion-estado.enum.js';
import { ExportacionFormato } from './enums/exportacion-formato.enum.js';
import { ExportacionTipo } from './enums/exportacion-tipo.enum.js';
import { SolicitudExportacion } from './entities/solicitud-exportacion.entity.js';
import { ExportacionesService } from './exportaciones.service.js';

const periodoId = '00000000-0000-4000-8000-000000000001';
const solicitudId = '00000000-0000-4000-8000-000000000002';
const actor = Object.assign(new Usuario(), {
  id: '00000000-0000-4000-8000-000000000003',
  email: 'admin@example.test',
  nombres: 'Admin',
  apellidos: 'Prueba',
  rol: UsuarioRol.ADMIN,
  estado: UsuarioEstado.ACTIVO,
});

function setup() {
  const save = vi.fn(async (row: Partial<SolicitudExportacion>) => ({ ...row, id: solicitudId }));
  const create = vi.fn((row: Partial<SolicitudExportacion>) => row);
  const findAndCount = vi.fn(async () => [[], 0] as [SolicitudExportacion[], number]);
  const requestRepository = { create, save, findAndCount };
  const manager = {
    connection: { options: { schema: 'test_exportaciones' } },
    query: vi.fn(async () => [{ id: periodoId }]),
    getRepository: vi.fn(() => requestRepository),
  };
  const dataSource = {
    manager,
    transaction: vi.fn(async (callback: (value: EntityManager) => Promise<unknown>) => callback(manager as unknown as EntityManager)),
    query: vi.fn(async () => [{ id: periodoId }]),
  };
  const audit = { registrar: vi.fn(async (_manager: EntityManager, _entry: { accion: string; entidad_tipo: string; ip_origen: string | null }) => undefined) };
  const config = { get: vi.fn(() => 'test') };
  const queue = { add: vi.fn(async () => undefined) };
  const service = new ExportacionesService(
    dataSource as unknown as DataSource,
    {} as never,
    {} as unknown as AlmacenamientoService,
    {} as unknown as ArchivoLimpiezaService,
    audit as unknown as AuditoriaService,
    config as never,
    requestRepository as unknown as Repository<SolicitudExportacion>,
    queue as never,
  );
  return { service, dataSource, manager, requestRepository, audit };
}

describe('ExportacionesService', () => {
  it('rechaza filtros desconocidos o incompatibles antes de abrir una transacción', async () => {
    const { service, dataSource } = setup();
    await expect(service.solicitar(periodoId, {
      tipo_reporte: ExportacionTipo.ESTUDIANTES,
      formato: ExportacionFormato.CSV,
      filtros: { docente_id: periodoId },
    }, actor, null)).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('persiste la solicitud y su auditoría juntas sin publicar el trabajo en la petición', async () => {
    const { service, dataSource, requestRepository, audit } = setup();
    const result = await service.solicitar(periodoId, {
      tipo_reporte: ExportacionTipo.ESTUDIANTES,
      formato: ExportacionFormato.XLSX,
      filtros: { condicion_ingreso: 'CONDICIONADO', situacion_ingreso: 'PENDIENTE' },
    }, actor, '127.0.0.1');

    expect(result).toEqual({ id: solicitudId, estado: ExportacionEstado.EN_COLA });
    expect(dataSource.transaction).toHaveBeenCalledOnce();
    expect(requestRepository.save).toHaveBeenCalledOnce();
    expect(audit.registrar).toHaveBeenCalledOnce();
    expect(audit.registrar.mock.calls[0]?.[1]).toMatchObject({
      accion: 'SOLICITAR_EXPORTACION',
      entidad_tipo: 'solicitud_exportacion',
      ip_origen: '127.0.0.1',
    });
  });

  it('lista exclusivamente las solicitudes del administrador autenticado', async () => {
    const { service, requestRepository } = setup();
    const result = await service.listar(periodoId, actor, { page: 1, limit: 20 });

    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    expect(requestRepository.findAndCount).toHaveBeenCalledWith(expect.objectContaining({
      where: { periodo_id: periodoId, solicitante_id: actor.id },
    }));
  });
});
