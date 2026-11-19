import type { DataSource, Repository } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import { ArchivoLimpiezaService } from '../almacenamiento/archivo-limpieza.service.js';
import { ArchivoPendiente } from '../almacenamiento/entities/archivo-pendiente.entity.js';
import { DocumentoPat } from './entities/documento-pat.entity.js';
import { DocumentoPatFormato } from './enums/documento-pat-formato.enum.js';
import { DocumentosPatService } from './documentos-pat.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { PlantillaPat } from '../plantillas-pat/entities/plantilla-pat.entity.js';
import { RevisionPatResultado } from '../revisiones-pat/enums/revision-pat-resultado.enum.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { GeneracionPat } from '../generaciones-pat/entities/generacion-pat.entity.js';

describe('DocumentosPatService', () => {
  function setup(options: { owner?: string; activeTemplate?: boolean; group?: boolean; currentTutor?: boolean; latestReview?: RevisionPatResultado | null; generation?: Partial<GeneracionPat> | null; delivered?: boolean; periodState?: string } = {}) {
    const template = { id: 'template-id', periodo_id: 'period-id', activa: options.activeTemplate ?? true, version: 'v1', nombre_archivo: 'pat.pdf' } as PlantillaPat;
    const context = { periodo_id: 'period-id', periodo_estado: 'POSTULACION_CERRADA', asignacion_estado: 'VIGENTE', estudiante_id: options.group ? null : options.owner ?? 'student-id', grupo_id: options.group ? 'group-id' : null, tema_id: 'topic-id' };
    const saved: Partial<DocumentoPat> = {};
    let maxVersion = options.latestReview === undefined ? 0 : 1;
    let latestReview = options.latestReview ?? null;
    const docRepository = {
      findOne: vi.fn().mockImplementation(async () => ({ ...saved, id: 'doc-id', plantilla: template, cargado_por: actor })),
      findAndCount: vi.fn().mockResolvedValue([[], 0]),
      create: vi.fn((value: Partial<DocumentoPat>) => value),
      save: vi.fn(async (value: Partial<DocumentoPat>) => { maxVersion = value.version ?? maxVersion; return Object.assign(saved, value, { id: 'doc-id' }); }),
    };
    const externalTemplateRepo = { findOneBy: vi.fn().mockResolvedValue(template) };
    const pendingRepo = { delete: vi.fn().mockResolvedValue({ affected: 1 }) };
    const generation = options.generation === null ? null : { id: 'generation-id', asignacion_tema_id: 'assignment-id', estudiante_id: 'student-id', estado: 'LISTO', ruta_almacenamiento: 'generaciones-pat/pat.pdf', hash_sha256: 'c'.repeat(64), tamano_bytes: '4096', ...options.generation };
    const generationRepo = { findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) => (generation && where['id'] === generation.id && where['estudiante_id'] === generation.estudiante_id ? generation : null)) };
    const manager = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('"generacion_id"=$1 AND "origen"=\'GENERADO\'')) return options.delivered ? [{}] : [];
        if (sql.includes('MAX("version")')) return [{ version: maxVersion }];
        if (sql.includes('revision_pat')) return maxVersion ? [{ revision: latestReview }] : [];
        if (sql.includes('asignacion_tema')) return [context];
        if (sql.includes('SELECT "estado"::text AS estado')) return [{ estado: options.periodState ?? 'POSTULACION_CERRADA' }];
        if (sql.includes('grupo_integrante')) return [{}];
        if (sql.includes('estudiante')) return [{ id: 'student-id' }];
        if (sql.includes('plantilla_pat')) return [{ id: 'template-id' }];
        return [];
      }),
      getRepository: (entity: typeof DocumentoPat | typeof PlantillaPat | typeof ArchivoPendiente | typeof GeneracionPat) => entity === DocumentoPat ? docRepository : entity === PlantillaPat ? externalTemplateRepo : entity === GeneracionPat ? generationRepo : pendingRepo,
    };
    const dataSource = {
      options: { schema: 'public' },
      getRepository: (entity: typeof GeneracionPat) => entity === GeneracionPat ? generationRepo : externalTemplateRepo,
      query: vi.fn(async (sql: string) => {
        if (sql.includes('asignacion_tutor')) return options.currentTutor ? [{}] : [];
        if (sql.includes('revision_pat')) return maxVersion ? [{ revision: latestReview }] : [];
        if (sql.includes('asignacion_tema')) return [context];
        if (sql.includes('estudiante')) return [{ id: 'student-id' }];
        if (sql.includes('grupo_integrante')) return [{}];
        return [];
      }),
      transaction: (work: (tx: typeof manager) => Promise<unknown>) => work(manager),
    } as unknown as DataSource;
    const storage = { createPrivateKey: vi.fn().mockReturnValue('documentos-pat/file.pdf'), saveAtPrivateKey: vi.fn().mockResolvedValue(undefined), signPrivateDownload: vi.fn() } as unknown as AlmacenamientoService;
    const cleanup = { registrar: vi.fn().mockResolvedValue(undefined), solicitar: vi.fn().mockResolvedValue(undefined) } as unknown as ArchivoLimpiezaService;
    const audit = { registrar: vi.fn().mockResolvedValue(undefined) } as unknown as AuditoriaService;
    const actor = { id: 'user-id', rol: UsuarioRol.ESTUDIANTE } as Usuario;
    const notifications = { registrarEventoPat: vi.fn().mockResolvedValue(undefined) } as unknown as NotificacionesPersistenciaService;
    const service = new DocumentosPatService(docRepository as unknown as Repository<DocumentoPat>, dataSource, storage, cleanup, audit, notifications);
    return { service, actor, storage, cleanup, audit, manager, docRepository, pendingRepo, notifications, generationRepo, setLatestReview: (value: RevisionPatResultado | null) => { latestReview = value; } };
  }

  const pdf = { originalname: 'entrega.pdf', mimetype: 'application/pdf', size: 14, buffer: Buffer.from('%PDF-1.7\n%%EOF') } as Express.Multer.File;

  it('guarda una versión con hash, auditoría y consumo atómico de la intención de carga', async () => {
    const { service, actor, storage, cleanup, audit, docRepository, pendingRepo, notifications, setLatestReview } = setup();
    const result = await service.cargar('period-id', 'assignment-id', { generacion_id: 'generation-id' }, pdf, actor, '127.0.0.1');
    expect(result).toMatchObject({ id: 'doc-id', version: 1, formato: DocumentoPatFormato.PDF, revision: 'PENDIENTE' });
    expect(result.hash_sha256).toBeDefined();
    expect(storage.saveAtPrivateKey).toHaveBeenCalledWith('documentos-pat/file.pdf', pdf.buffer, 'application/pdf');
    expect(audit.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'CARGAR_DOCUMENTO_PAT', entidad_tipo: 'documento_pat' }));
    expect(notifications.registrarEventoPat).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tipo: 'PAT_ENTREGADO', actorId: actor.id, entidadTipo: 'documento_pat' }));
    expect(pendingRepo.delete).toHaveBeenCalledWith({ ruta_almacenamiento: 'documentos-pat/file.pdf' });
    expect(cleanup.solicitar).not.toHaveBeenCalled();
    expect(docRepository.save).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }));
    setLatestReview(RevisionPatResultado.OBSERVADO);
    const second = await service.cargar('period-id', 'assignment-id', { generacion_id: 'generation-id' }, pdf, actor, '127.0.0.1');
    expect(second.version).toBe(2);
  });

  it.each([null, RevisionPatResultado.APROBADO])('bloquea una corrección cuando la última versión está pendiente o aprobada (%s)', async (latestReview) => {
    const { service, actor, storage, cleanup } = setup({ latestReview });
    await expect(service.cargar('period-id', 'assignment-id', { generacion_id: 'generation-id' }, pdf, actor, null)).rejects.toMatchObject({ status: 409 });
    expect(storage.saveAtPrivateKey).not.toHaveBeenCalled();
    expect(cleanup.registrar).not.toHaveBeenCalled();
  });

  it('permite una nueva entrega solo después de observar o rechazar la última versión', async () => {
    const { service, actor } = setup({ latestReview: RevisionPatResultado.RECHAZADO });
    const result = await service.cargar('period-id', 'assignment-id', { generacion_id: 'generation-id' }, pdf, actor, null);
    expect(result).toMatchObject({ version: 2, revision: 'PENDIENTE', detalle_revision: null });
  });

  it('rechaza que otra cuenta estudiante cargue un documento del titular', async () => {
    const { service, actor, storage } = setup({ owner: 'different-student' });
    await expect(service.cargar('period-id', 'assignment-id', { generacion_id: 'generation-id' }, pdf, actor, null)).rejects.toMatchObject({ status: 403 });
    expect(storage.saveAtPrivateKey).not.toHaveBeenCalled();
  });

  it('permite que un integrante activo cargue su PAT individual y consulte solo su historial', async () => {
    const { service, actor, docRepository } = setup({ group: true });
    const result = await service.cargar('period-id', 'assignment-id', { generacion_id: 'generation-id' }, pdf, actor, null);
    expect(result.version).toBe(1);
    await expect(service.listar('period-id', 'assignment-id', actor, 1, 20)).resolves.toMatchObject({ data: [], total: 0 });
    expect(docRepository.findAndCount).toHaveBeenCalled();
  });

  it('permite lectura al tutor vigente, pero oculta el trabajo al proponente o a un tutor anterior', async () => {
    const current = setup({ currentTutor: true });
    const tutor = { id: 'teacher-user', rol: UsuarioRol.DOCENTE } as Usuario;
    await expect(current.service.listar('period-id', 'assignment-id', tutor, 1, 20)).resolves.toMatchObject({ total: 0 });
    const former = setup();
    await expect(former.service.listar('period-id', 'assignment-id', tutor, 1, 20)).rejects.toMatchObject({ status: 404 });
  });

  describe('entrega directa de la generación (sin firma)', () => {
    it('crea una versión GENERADO que referencia el archivo, hash y tamaño de la generación', async () => {
      const { service, actor, storage, cleanup, audit, docRepository, notifications } = setup();
      const result = await service.entregarGenerada('period-id', 'assignment-id', 'generation-id', actor, '127.0.0.1');
      expect(docRepository.save).toHaveBeenCalledWith(expect.objectContaining({
        version: 1, origen: 'GENERADO', ruta_almacenamiento: 'generaciones-pat/pat.pdf', hash_sha256: 'c'.repeat(64), tamano_bytes: '4096',
        formato: DocumentoPatFormato.PDF, generacion_id: 'generation-id', estudiante_id: 'student-id', plantilla_id: null, nombre_archivo: 'PAT-generado.pdf',
      }));
      expect(result).toMatchObject({ origen: 'GENERADO', firmado: false, version: 1, revision: 'PENDIENTE' });
      expect(storage.saveAtPrivateKey).not.toHaveBeenCalled();
      expect(cleanup.registrar).not.toHaveBeenCalled();
      expect(notifications.registrarEventoPat).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tipo: 'PAT_ENTREGADO', entidadTipo: 'documento_pat' }));
      expect(audit.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'ENTREGAR_PAT_GENERADO', valores_nuevos: expect.objectContaining({ origen: 'GENERADO', firmado: false }) }));
    });

    it('la carga firmada sigue disponible y se marca FIRMADO', async () => {
      const { service, actor, docRepository } = setup();
      const result = await service.cargar('period-id', 'assignment-id', { generacion_id: 'generation-id' }, pdf, actor, null);
      expect(docRepository.save).toHaveBeenCalledWith(expect.objectContaining({ origen: 'FIRMADO' }));
      expect(result).toMatchObject({ origen: 'FIRMADO', firmado: true });
    });

    it('numera una nueva versión solo tras OBSERVADO o RECHAZADO', async () => {
      const { service, actor } = setup({ latestReview: RevisionPatResultado.OBSERVADO });
      await expect(service.entregarGenerada('period-id', 'assignment-id', 'generation-id', actor, null)).resolves.toMatchObject({ version: 2 });
    });

    it.each([null, RevisionPatResultado.APROBADO])('bloquea la entrega si la última versión está pendiente o aprobada (%s)', async (latestReview) => {
      const { service, actor, docRepository } = setup({ latestReview });
      await expect(service.entregarGenerada('period-id', 'assignment-id', 'generation-id', actor, null)).rejects.toMatchObject({ status: 409 });
      expect(docRepository.save).not.toHaveBeenCalled();
    });

    it('responde 404 si la generación no existe o es de otro estudiante y 409 si no está lista o ya se entregó', async () => {
      const missing = setup({ generation: null });
      await expect(missing.service.entregarGenerada('period-id', 'assignment-id', 'generation-id', missing.actor, null)).rejects.toMatchObject({ status: 404 });
      const otherStudent = setup({ generation: { estudiante_id: 'other-student' } });
      await expect(otherStudent.service.entregarGenerada('period-id', 'assignment-id', 'generation-id', otherStudent.actor, null)).rejects.toMatchObject({ status: 404 });
      const pending = setup({ generation: { estado: 'PROCESANDO', ruta_almacenamiento: null } });
      await expect(pending.service.entregarGenerada('period-id', 'assignment-id', 'generation-id', pending.actor, null)).rejects.toThrow('todavía no está disponible');
      const delivered = setup({ delivered: true });
      await expect(delivered.service.entregarGenerada('period-id', 'assignment-id', 'generation-id', delivered.actor, null)).rejects.toThrow('ya fue entregada');
      expect(delivered.docRepository.save).not.toHaveBeenCalled();
    });

    it('rechaza a quien no es titular, a otros roles y fuera del período habilitado', async () => {
      const other = setup({ owner: 'different-student' });
      await expect(other.service.entregarGenerada('period-id', 'assignment-id', 'generation-id', other.actor, null)).rejects.toMatchObject({ status: 403 });
      const admin = setup();
      await expect(admin.service.entregarGenerada('period-id', 'assignment-id', 'generation-id', { id: 'admin', rol: UsuarioRol.ADMIN } as Usuario, null)).rejects.toMatchObject({ status: 403 });
      const closed = setup({ periodState: 'ARCHIVADO' });
      await expect(closed.service.entregarGenerada('period-id', 'assignment-id', 'generation-id', closed.actor, null)).rejects.toThrow('postulaciones cerradas');
    });

    it('un integrante activo del grupo entrega su propia generación', async () => {
      const { service, actor } = setup({ group: true });
      await expect(service.entregarGenerada('period-id', 'assignment-id', 'generation-id', actor, null)).resolves.toMatchObject({ origen: 'GENERADO', estudiante_id: 'student-id' });
    });
  });
});
