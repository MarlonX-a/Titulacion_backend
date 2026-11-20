import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { DataSource, Repository } from 'typeorm';
import type { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import type { ArchivoLimpiezaService } from '../almacenamiento/archivo-limpieza.service.js';
import { ArchivoPendiente } from '../almacenamiento/entities/archivo-pendiente.entity.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { AppEnvironment } from '../config/environment.js';
import type { ContenidoPatEstudiante } from './entities/contenido-pat.entity.js';
import type { EstudianteDatosPat } from './entities/estudiante-datos-pat.entity.js';
import { GeneracionPat } from './entities/generacion-pat.entity.js';
import { GeneracionesPatService, type GeneracionJob } from './generaciones-pat.service.js';
import { renderizarPat } from './render-pat.js';

vi.mock('./render-pat.js', () => ({ renderizarPat: vi.fn() }));

const ID = 'gen-1';
const CLAVE = 'generaciones-pat/archivo.pdf';
const PDF = Buffer.from('%PDF-1.7 contenido de prueba');

/**
 * Fila `generacion_pat` simulada en memoria: `findOne` devuelve su estado actual (como una lectura
 * con bloqueo) y `save` lo persiste, de modo que la segunda transacción ve lo que dejó la primera.
 */
function setup(inicial: Partial<GeneracionPat> | null) {
  const fila: { actual: Partial<GeneracionPat> | null } = { actual: inicial ? { id: ID, instantanea: { titulo: 'Tema' }, ...inicial } : null };
  const generacionRepo = {
    findOne: vi.fn(async () => (fila.actual ? { ...fila.actual } : null)),
    save: vi.fn(async (valor: Partial<GeneracionPat>) => {
      fila.actual = { ...valor };
      return { ...valor };
    }),
    update: vi.fn(async () => ({ affected: 1 })),
  };
  const archivoPendienteRepo = { delete: vi.fn(async () => ({ affected: 1 })) };
  const manager = {
    getRepository: (entidad: unknown) => (entidad === GeneracionPat ? generacionRepo : entidad === ArchivoPendiente ? archivoPendienteRepo : {}),
  };
  const db = {
    options: { schema: 'public' },
    transaction: (trabajo: (tx: typeof manager) => Promise<unknown>) => trabajo(manager),
  } as unknown as DataSource;
  const storage = {
    createPrivateKey: vi.fn(() => CLAVE),
    saveAtPrivateKey: vi.fn(async () => undefined),
  };
  const cleanup = { registrar: vi.fn(async () => true), solicitar: vi.fn(async () => undefined) };
  const config = { get: vi.fn(() => false) } as unknown as ConfigService<AppEnvironment, true>;
  const service = new GeneracionesPatService(
    db, {} as Repository<EstudianteDatosPat>, {} as Repository<ContenidoPatEstudiante>, generacionRepo as unknown as Repository<GeneracionPat>,
    storage as unknown as AlmacenamientoService, cleanup as unknown as ArchivoLimpiezaService, {} as AuditoriaService,
    {} as Queue<GeneracionJob>, config,
  );
  return { service, fila, generacionRepo, archivoPendienteRepo, storage, cleanup };
}

describe('GeneracionesPatService.procesar', () => {
  beforeEach(() => {
    vi.mocked(renderizarPat).mockReset();
    vi.mocked(renderizarPat).mockResolvedValue(PDF);
  });

  it('pasa EN_COLA a PROCESANDO con procesando_desde antes de renderizar', async () => {
    const { service, generacionRepo } = setup({ estado: 'EN_COLA', ciclo: 2 });
    const antes = Date.now();
    await service.procesar(ID, 2);
    expect(generacionRepo.findOne).toHaveBeenNthCalledWith(1, { where: { id: ID }, lock: { mode: 'pessimistic_write' } });
    const primeraEscritura = generacionRepo.save.mock.calls[0]![0];
    expect(primeraEscritura).toMatchObject({ estado: 'PROCESANDO', ciclo: 2 });
    expect(primeraEscritura.procesando_desde).toBeInstanceOf(Date);
    expect(primeraEscritura.procesando_desde!.getTime()).toBeGreaterThanOrEqual(antes);
    expect(renderizarPat).toHaveBeenCalledWith({ titulo: 'Tema' });
  });

  it.each([
    ['la fila no existe', null],
    ['el ciclo del trabajo no coincide', { estado: 'EN_COLA', ciclo: 3 }],
    ['la fila no está EN_COLA', { estado: 'PROCESANDO', ciclo: 2 }],
    ['la fila ya está LISTO', { estado: 'LISTO', ciclo: 2 }],
  ])('ignora el trabajo cuando %s', async (_caso, inicial) => {
    const { service, generacionRepo, storage, cleanup } = setup(inicial as Partial<GeneracionPat> | null);
    await service.procesar(ID, 2);
    expect(generacionRepo.save).not.toHaveBeenCalled();
    expect(renderizarPat).not.toHaveBeenCalled();
    expect(storage.createPrivateKey).not.toHaveBeenCalled();
    expect(storage.saveAtPrivateKey).not.toHaveBeenCalled();
    expect(cleanup.registrar).not.toHaveBeenCalled();
    expect(cleanup.solicitar).not.toHaveBeenCalled();
  });

  it('guarda el PDF y deja la generación LISTO con ruta, tamaño y hash', async () => {
    const { service, fila, archivoPendienteRepo, storage, cleanup } = setup({ estado: 'EN_COLA', ciclo: 1 });
    await service.procesar(ID, 1);
    expect(cleanup.registrar).toHaveBeenCalledWith(null, CLAVE);
    expect(storage.saveAtPrivateKey).toHaveBeenCalledWith(CLAVE, PDF, 'application/pdf');
    expect(fila.actual).toMatchObject({
      estado: 'LISTO', ciclo: 1, ruta_almacenamiento: CLAVE, tamano_bytes: String(PDF.length),
      hash_sha256: createHash('sha256').update(PDF).digest('hex'), error_sanitizado: null,
    });
    expect(fila.actual!.generada_en).toBeInstanceOf(Date);
    expect(archivoPendienteRepo.delete).toHaveBeenCalledWith({ ruta_almacenamiento: CLAVE });
    expect(cleanup.solicitar).not.toHaveBeenCalled();
  });

  it('descarta el PDF si otro ciclo tomó la generación mientras se renderizaba', async () => {
    const { service, fila, generacionRepo, archivoPendienteRepo, storage, cleanup } = setup({ estado: 'EN_COLA', ciclo: 1 });
    // La recuperación de atascadas devolvió la fila a EN_COLA con ciclo + 1 durante la subida.
    storage.saveAtPrivateKey.mockImplementationOnce(async () => {
      fila.actual = { ...fila.actual, estado: 'EN_COLA', ciclo: 2, procesando_desde: null };
    });
    await service.procesar(ID, 1);
    expect(generacionRepo.save).toHaveBeenCalledTimes(1);
    expect(fila.actual).toMatchObject({ estado: 'EN_COLA', ciclo: 2 });
    expect(fila.actual).not.toHaveProperty('ruta_almacenamiento');
    expect(archivoPendienteRepo.delete).not.toHaveBeenCalled();
    expect(cleanup.solicitar).toHaveBeenCalledWith(undefined, CLAVE);
    expect(generacionRepo.update).not.toHaveBeenCalled();
  });

  it.each([
    ['el render falla', 'render'],
    ['la subida al almacenamiento falla', 'storage'],
  ])('marca FALLIDO solo en el ciclo propio y pide limpiar el archivo cuando %s', async (_caso, punto) => {
    const { service, generacionRepo, archivoPendienteRepo, storage, cleanup } = setup({ estado: 'EN_COLA', ciclo: 4 });
    if (punto === 'render') vi.mocked(renderizarPat).mockRejectedValueOnce(new Error('pdfkit'));
    else storage.saveAtPrivateKey.mockRejectedValueOnce(new Error('s3'));
    await expect(service.procesar(ID, 4)).resolves.toBeUndefined();
    expect(generacionRepo.update).toHaveBeenCalledWith(
      { id: ID, ciclo: 4, estado: 'PROCESANDO' },
      { estado: 'FALLIDO', error_sanitizado: 'No se pudo generar el archivo PAT.' },
    );
    expect(cleanup.registrar).toHaveBeenCalledWith(null, CLAVE);
    expect(cleanup.solicitar).toHaveBeenCalledWith(undefined, CLAVE);
    expect(archivoPendienteRepo.delete).not.toHaveBeenCalled();
  });
});
