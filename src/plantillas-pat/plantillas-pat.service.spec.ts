import type { DataSource, Repository } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import { ArchivoLimpiezaService } from '../almacenamiento/archivo-limpieza.service.js';
import { ArchivoPendiente } from '../almacenamiento/entities/archivo-pendiente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { PlantillaPat } from './entities/plantilla-pat.entity.js';
import { PlantillasPatService } from './plantillas-pat.service.js';

describe('PlantillasPatService', () => {
  it('sustituye la versión activa y audita ambos valores dentro de la transacción', async () => {
    const period = { id: 'period-id', estado: PeriodoEstado.BORRADOR } as PeriodoTitulacion;
    const actor = { id: 'admin-id', nombres: 'Ana', apellidos: 'Admin' } as Usuario;
    const previous = {
      id: 'old-id', periodo_id: period.id, version: 'v1', nombre_archivo: 'anterior.pdf', ruta_almacenamiento: 'plantillas-pat/old.pdf',
      mime_type: 'application/pdf', tamano_bytes: '12', hash_sha256: 'a'.repeat(64), fecha_vigencia_inicio: '2026-10-01',
      fecha_vigencia_fin: null, publicada_por_id: actor.id, publicada_por: actor, activa: true,
    } as PlantillaPat;
    let saved: PlantillaPat | undefined;
    const transactionalRepository = {
      findOne: vi.fn().mockResolvedValue(previous),
      create: vi.fn((input: Partial<PlantillaPat>) => input as PlantillaPat),
      save: vi.fn(async (item: PlantillaPat) => {
        if (item.id === previous.id) return item;
        saved = { ...item, id: 'new-id' };
        return saved;
      }),
    };
    const periodRepository = { findOne: vi.fn().mockResolvedValue(period) };
    const pendingRepository = { delete: vi.fn().mockResolvedValue({ affected: 1 }) };
    const manager = {
      getRepository: (entity: typeof PeriodoTitulacion | typeof PlantillaPat | typeof ArchivoPendiente) => entity === PeriodoTitulacion ? periodRepository : entity === ArchivoPendiente ? pendingRepository : transactionalRepository,
    };
    const dataSource = { transaction: (work: (value: typeof manager) => Promise<unknown>) => work(manager) } as unknown as DataSource;
    const storage = {
      createPrivateKey: vi.fn().mockReturnValue('plantillas-pat/new.pdf'),
      saveAtPrivateKey: vi.fn().mockResolvedValue(undefined),
      signPrivateDownload: vi.fn(),
    } as unknown as AlmacenamientoService;
    const audit = { registrar: vi.fn().mockResolvedValue(undefined) } as unknown as AuditoriaService;
    const cleanup = { registrar: vi.fn().mockResolvedValue(undefined), solicitar: vi.fn().mockResolvedValue(undefined) } as unknown as ArchivoLimpiezaService;
    const externalRepository = {
      exist: vi.fn().mockResolvedValue(false),
      findOne: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'new-id' ? saved && { ...saved, publicada_por: actor } : null),
    };
    const periods = { findOneBy: vi.fn().mockResolvedValue(period) };
    const service = new PlantillasPatService(
      externalRepository as unknown as Repository<PlantillaPat>,
      periods as unknown as Repository<PeriodoTitulacion>,
      {} as Repository<Estudiante>,
      {} as Repository<EstudianteHabilitado>,
      dataSource,
      storage,
      audit,
      cleanup,
    );
    const file = { originalname: 'nueva.pdf', mimetype: 'application/pdf', size: 12, buffer: Buffer.from('%PDF-1.7\n%%EOF') } as Express.Multer.File;

    const result = await service.publicar(period.id, { version: 'v2' }, file, actor, '127.0.0.1');

    expect(result.version).toBe('v2');
    expect(result.activa).toBe(true);
    expect(previous.activa).toBe(false);
    expect(previous.fecha_vigencia_fin).toBe(saved?.fecha_vigencia_inicio);
    expect(audit.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      accion: 'PUBLICAR_PLANTILLA_PAT',
      valores_anteriores: expect.objectContaining({ id: 'old-id', activa: true }),
      valores_nuevos: expect.objectContaining({ id: 'new-id', activa: true, version_anterior_id: 'old-id' }),
    }));
    expect(cleanup.registrar).toHaveBeenCalledWith(period.id, 'plantillas-pat/new.pdf');
    expect(pendingRepository.delete).toHaveBeenCalledWith({ ruta_almacenamiento: 'plantillas-pat/new.pdf' });
    expect(cleanup.solicitar).not.toHaveBeenCalled();
  });

  it('marca para limpieza el objeto si falla la transacción de publicación', async () => {
    const actor = { id: 'admin-id', nombres: 'Ana', apellidos: 'Admin' } as Usuario;
    const period = { id: 'period-id', estado: PeriodoEstado.BORRADOR } as PeriodoTitulacion;
    const repository = { exist: vi.fn().mockResolvedValue(false) };
    const periods = { findOneBy: vi.fn().mockResolvedValue(period) };
    const dataSource = { transaction: vi.fn().mockRejectedValue(new Error('audit failed')) } as unknown as DataSource;
    const storage = { createPrivateKey: vi.fn().mockReturnValue('plantillas-pat/failed.pdf'), saveAtPrivateKey: vi.fn().mockResolvedValue(undefined) } as unknown as AlmacenamientoService;
    const cleanup = { registrar: vi.fn().mockResolvedValue(undefined), solicitar: vi.fn().mockResolvedValue(undefined) } as unknown as ArchivoLimpiezaService;
    const service = new PlantillasPatService(
      repository as unknown as Repository<PlantillaPat>, periods as unknown as Repository<PeriodoTitulacion>,
      {} as Repository<Estudiante>, {} as Repository<EstudianteHabilitado>, dataSource, storage,
      {} as AuditoriaService, cleanup,
    );
    const file = { originalname: 'nueva.pdf', mimetype: 'application/pdf', size: 12, buffer: Buffer.from('%PDF-1.7\n%%EOF') } as Express.Multer.File;

    await expect(service.publicar(period.id, { version: 'v2' }, file, actor, null)).rejects.toMatchObject({ status: 503 });
    expect(cleanup.registrar).toHaveBeenCalledWith(period.id, 'plantillas-pat/failed.pdf');
    expect(cleanup.solicitar).toHaveBeenCalledWith(undefined, 'plantillas-pat/failed.pdf');
  });
});
