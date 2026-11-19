import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { DataSource, Repository } from 'typeorm';
import type { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import type { ArchivoLimpiezaService } from '../almacenamiento/archivo-limpieza.service.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { AppEnvironment } from '../config/environment.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { ContenidoPatEstudiante } from './entities/contenido-pat.entity.js';
import type { EstudianteDatosPat } from './entities/estudiante-datos-pat.entity.js';
import { GeneracionPat } from './entities/generacion-pat.entity.js';
import { GENERACION_PAT_ATASCADA_MS, GeneracionesPatService, type GeneracionJob } from './generaciones-pat.service.js';

const PERIODO = 'period-id';
const MATRICULA_COMPANERO = '1399999999';
const ASIGNACION = 'assignment-id';
const personalCompleto = {
  fecha_nacimiento: '2002-05-18', paralelo: 'A', sexo: 'Femenino', nacionalidad: 'Ecuatoriana', estado_civil: 'Soltera', provincia: 'Manabí',
  canton: 'Manta', parroquia: 'Manta', celular: '0990000000', tiene_discapacidad: false, correo_personal_no_aplica: true,
  telefono_convencional_no_aplica: true, certificado_votacion_no_aplica: true,
};
const propuestas = [
  { id: 'tp-1', orden_prioridad: 1, docente_id: 'doc-1', nombres: 'Ana', apellidos: 'Proponente', elegible_actualmente: true, es_proponente_tema: true },
  { id: 'tp-2', orden_prioridad: 2, docente_id: 'doc-2', nombres: 'Luis', apellidos: 'Segundo', elegible_actualmente: true, es_proponente_tema: false },
];

interface Opciones {
  owner?: boolean;
  personal?: Record<string, unknown>;
  contenido?: Record<string, unknown>;
  extension?: string | null;
  vigente?: boolean;
  propuestas?: typeof propuestas;
  grupal?: boolean;
  periodo?: string;
  generacion?: Partial<GeneracionPat> | null;
  atascadas?: Array<{ id: string; ciclo: number }>;
  updateAffected?: number;
  jobFallido?: boolean;
}

function setup(options: Opciones = {}) {
  const actor = { id: 'user-id', rol: UsuarioRol.ESTUDIANTE, nombres: 'José', apellidos: 'Peña' } as Usuario;
  const contexto = {
    nombres: 'José', apellidos: 'Peña', email: 'e1300000000@live.uleam.edu.ec', cedula: '1300000000', matricula: '1300000000', nivel: 8,
    carrera: 'Sistemas', facultad: 'Ciencias', periodo_codigo: '2026-2', periodo_nombre: 'Titulación 2026-2', extension_pat: options.extension === undefined ? 'Extensión Manta' : options.extension,
    titular_id: options.grupal ? null : 'student-id', grupo_id: options.grupal ? 'group-id' : null, titulo: 'Sistema de prueba', descripcion: 'Descripción del tema', tipo_tema: options.grupal ? 'PAREJA' : 'INDIVIDUAL',
    linea_id: 'line-id', linea_codigo: 'L1', linea_nombre: 'Software', personal: options.personal ?? {}, contenido_guardado: options.contenido ?? {},
  };
  const generacion = options.generacion === undefined ? null : options.generacion;
  const listado = [
    { id: 'gen-2', asignacion_tema_id: ASIGNACION, estudiante_id: 'student-id', version_diseno: 1, ciclo: 2, estado: 'LISTO', tamano_bytes: '2048', hash_sha256: 'a'.repeat(64), error_sanitizado: null, solicitada_en: new Date('2026-11-18T10:00:00Z'), generada_en: new Date('2026-11-18T10:00:05Z'), procesando_desde: new Date('2026-11-18T10:00:01Z'), documento_pat_id: 'doc-pat' },
    { id: 'gen-1', asignacion_tema_id: ASIGNACION, estudiante_id: 'student-id', version_diseno: 1, ciclo: 1, estado: 'FALLIDO', tamano_bytes: null, hash_sha256: null, error_sanitizado: 'No se pudo generar el archivo PAT.', solicitada_en: new Date('2026-11-17T10:00:00Z'), generada_en: null, procesando_desde: null, documento_pat_id: null },
  ];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('WITH recuperadas')) return options.atascadas ?? [];
    if (sql.includes('d."id" AS documento_pat_id')) return listado;
    if (sql.includes('count(*)::int AS total')) return [{ total: listado.length }];
    if (sql.includes('FROM "public"."documento_pat" WHERE "generacion_id"')) return params?.[0] === 'gen-2' ? [{ id: 'doc-pat' }] : [];
    if (sql.includes('AS contenido_guardado')) return [contexto];
    if (sql.includes('"tutor_propuesto" tp')) return options.propuestas ?? propuestas;
    if (sql.includes('"asignacion_tutor" at')) return options.vigente ? [{ docente_id: 'doc-9', nombres: 'Tutor', apellidos: 'Vigente' }] : [];
    if (sql.includes('ORDER BY u."apellidos",u."nombres",e."id"')) {
      // Simula una fila con identificadores de más: el servicio debe descartarlos aunque lleguen.
      const peer = { id: 'peer-id', nombres: 'María', apellidos: 'Zambrano', matricula: MATRICULA_COMPANERO, cedula: MATRICULA_COMPANERO };
      return options.grupal ? [{ id: 'student-id', nombres: 'José', apellidos: 'Peña', matricula: '1300000000' }, peer] : [{ id: 'student-id', nombres: 'José', apellidos: 'Peña', matricula: '1300000000' }];
    }
    if (sql.includes('SELECT t."descripcion",t."linea_id"')) return [{ descripcion: 'Descripción del tema', linea_id: 'line-id' }];
    if (sql.includes('"periodo_titulacion" WHERE "id"=$1 FOR UPDATE')) return [{ estado: options.periodo ?? 'POSTULACION_CERRADA' }];
    if (sql.includes('SELECT "id","periodo_id","estado"::text AS estado FROM')) return [{ id: ASIGNACION, periodo_id: PERIODO, estado: 'VIGENTE' }];
    if (sql.includes('SELECT 1 FROM "public"."asignacion_tema" a')) return options.owner === false ? [] : [{}];
    if (sql.includes('"estudiante" WHERE "usuario_id"')) return [{ id: 'student-id' }];
    return [];
  });
  const generacionRepo = {
    findOneBy: vi.fn(async (where: Record<string, unknown>) => (generacion && where['id'] === generacion.id && where['estudiante_id'] === 'student-id' ? { ...generacion } : null)),
    update: vi.fn(async () => ({ affected: options.updateAffected ?? 1 })),
    find: vi.fn(async () => []),
    create: vi.fn((value: Partial<GeneracionPat>) => value),
    save: vi.fn(async (value: Partial<GeneracionPat>) => ({ ...value, id: 'new-gen' })),
  };
  const contenidoRepo = {
    findOneBy: vi.fn(async () => (options.contenido ? { id: 'content-id', contenido: options.contenido } : null)),
    create: vi.fn((value: Partial<ContenidoPatEstudiante>) => value),
    save: vi.fn(async (value: Partial<ContenidoPatEstudiante>) => ({ ...value, id: 'content-id' })),
  };
  const manager = {
    query,
    getRepository: (entity: unknown) => (entity === GeneracionPat ? generacionRepo : entity === ContenidoPatEstudiante ? contenidoRepo : { delete: vi.fn() }),
  };
  const db = {
    options: { schema: 'public' },
    query,
    getRepository: () => ({ findOneByOrFail: vi.fn(async () => ({ id: 'student-id' })) }),
    transaction: (work: (tx: typeof manager) => Promise<unknown>) => work(manager),
  } as unknown as DataSource;
  const audit = { registrar: vi.fn(async () => undefined) } as unknown as AuditoriaService;
  const failedJob = { isFailed: vi.fn(async () => true), remove: vi.fn(async () => undefined) };
  const queue = { add: vi.fn(async () => undefined), getJob: vi.fn(async () => (options.jobFallido ? failedJob : undefined)) };
  const config = { get: vi.fn(() => false) } as unknown as ConfigService<AppEnvironment, true>;
  const service = new GeneracionesPatService(
    db, {} as Repository<EstudianteDatosPat>, contenidoRepo as unknown as Repository<ContenidoPatEstudiante>, generacionRepo as unknown as Repository<GeneracionPat>,
    { signPrivateDownload: vi.fn(async () => 'https://signed') } as unknown as AlmacenamientoService,
    { registrar: vi.fn(), solicitar: vi.fn() } as unknown as ArchivoLimpiezaService, audit, queue as unknown as Queue<GeneracionJob>, config,
  );
  return { service, actor, query, queue, failedJob, generacionRepo, contenidoRepo, audit };
}

describe('GeneracionesPatService', () => {
  describe('resumen', () => {
    it('autocompleta identidad, tema, curso, modalidad, línea y tutor con su fuente', async () => {
      const { service, actor } = setup({ personal: personalCompleto });
      const resumen = await service.resumen(PERIODO, ASIGNACION, actor);
      expect(resumen.automaticos).toMatchObject({
        nombres: { valor: 'José', fuente: 'USUARIO' },
        cedula: { valor: '1300000000', fuente: 'ESTUDIANTE' },
        correo_institucional: { valor: 'e1300000000@live.uleam.edu.ec', fuente: 'USUARIO' },
        carrera: { valor: 'Sistemas', fuente: 'CARRERA' },
        facultad: { valor: 'Ciencias', fuente: 'FACULTAD' },
        periodo: { valor: { codigo: '2026-2', nombre: 'Titulación 2026-2' }, fuente: 'PERIODO' },
        curso: { valor: 'Octavo', fuente: 'ESTUDIANTE_NIVEL' },
        tema_titulo: { valor: 'Sistema de prueba', fuente: 'TEMA' },
        problematica_sugerida: { valor: 'Descripción del tema', fuente: 'TEMA' },
        linea_investigacion: { valor: { id: 'line-id', codigo: 'L1', nombre: 'Software' }, fuente: 'LINEA_INVESTIGACION' },
        articulaciones_sugeridas: { valor: ['INVESTIGACION'], fuente: 'LINEA_INVESTIGACION' },
        modalidad: { valor: 'INDIVIDUAL', fuente: 'ASIGNACION_TEMA' },
        modalidad_academica: { valor: 'TRABAJO_INTEGRACION_CURRICULAR', fuente: 'PREDETERMINADO' },
        tutor: { valor: { docente_id: 'doc-1', tutor_propuesto_id: 'tp-1' }, fuente: 'TUTOR_PROPUESTO_PREDETERMINADO' },
      });
      expect(resumen.editables.contenido).toEqual({ problematica: 'Descripción del tema', problematica_personalizada: false, confirma_problematica: false, articulaciones: ['INVESTIGACION'], tutor_propuesto_id: null });
      expect(resumen.pendientes).toEqual(['confirma_problematica']);
      expect(resumen.listo_para_generar).toBe(false);
      expect(resumen.tutores_propuestos.data).toHaveLength(2);
    });

    it('marca GRUPAL, usa el tutor vigente y queda listo cuando todo está completo', async () => {
      const { service, actor } = setup({ grupal: true, vigente: true, personal: personalCompleto, contenido: { confirma_problematica: true } });
      const resumen = await service.resumen(PERIODO, ASIGNACION, actor);
      expect(resumen.automaticos.modalidad).toEqual({ valor: 'GRUPAL', fuente: 'ASIGNACION_TEMA' });
      expect(resumen.automaticos.tutor).toEqual({ valor: { docente_id: 'doc-9', nombres: 'Tutor', apellidos: 'Vigente', tutor_propuesto_id: null }, fuente: 'ASIGNACION_TUTOR' });
      expect(resumen.tutores_propuestos).toEqual({ tutor_vigente: { docente_id: 'doc-9', nombres: 'Tutor', apellidos: 'Vigente' }, data: [] });
      expect(resumen.pendientes).toEqual([]);
      expect(resumen.listo_para_generar).toBe(true);
    });

    it('expone solo los campos personales editables y la elección guardada de tutor', async () => {
      const { service, actor } = setup({ personal: { ...personalCompleto, curso: 'Antiguo', ajeno: 'x' }, contenido: { tutor_propuesto_id: 'tp-2', confirma_problematica: true } });
      const resumen = await service.resumen(PERIODO, ASIGNACION, actor);
      expect(resumen.editables.personal).not.toHaveProperty('curso');
      expect(resumen.editables.personal).not.toHaveProperty('ajeno');
      expect(resumen.editables.personal).toMatchObject({ paralelo: 'A', certificado_votacion_no_aplica: true });
      expect(resumen.automaticos.tutor).toMatchObject({ valor: { tutor_propuesto_id: 'tp-2' }, fuente: 'TUTOR_PROPUESTO_ELEGIDO' });
    });

    it('informa tutor y extensión pendientes cuando no hay propuestas ni sede configurada', async () => {
      const { service, actor } = setup({ personal: personalCompleto, contenido: { confirma_problematica: true }, propuestas: [], extension: null });
      const resumen = await service.resumen(PERIODO, ASIGNACION, actor);
      expect(resumen.automaticos.tutor).toEqual({ valor: null, fuente: 'SIN_TUTOR' });
      expect(resumen.pendientes).toEqual(['tutor_propuesto_id', 'extension_pat']);
    });

    it('expone de los integrantes solo id, nombres y apellidos, sin matrícula ni cédula de compañeros', async () => {
      const { service, actor, query } = setup({ grupal: true, personal: personalCompleto });
      const resumen = await service.resumen(PERIODO, ASIGNACION, actor);
      expect(resumen.automaticos.integrantes.valor).toEqual([
        { id: 'student-id', nombres: 'José', apellidos: 'Peña' },
        { id: 'peer-id', nombres: 'María', apellidos: 'Zambrano' },
      ]);
      expect(JSON.stringify(resumen)).not.toContain(MATRICULA_COMPANERO);
      expect(resumen.automaticos.matricula).toEqual({ valor: '1300000000', fuente: 'ESTUDIANTE' });
      const [sql] = query.mock.calls.find(([text]) => String(text).includes('ORDER BY u."apellidos",u."nombres",e."id"'))!;
      expect(sql).not.toContain('matricula');
      expect(sql).not.toContain('cedula');
    });

    it('rechaza a quien no participa en la asignación', async () => {
      const { service, actor } = setup({ owner: false });
      await expect(service.resumen(PERIODO, ASIGNACION, actor)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('solicitar generación', () => {
    it('devuelve 400 con las mismas claves pendientes que el resumen', async () => {
      const { service, actor, queue } = setup({ personal: {}, extension: null });
      const resumen = await service.resumen(PERIODO, ASIGNACION, actor);
      const error = await service.solicitar(PERIODO, ASIGNACION, {}, actor, null).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(((error as BadRequestException).getResponse() as { pendientes: string[] }).pendientes).toEqual(resumen.pendientes);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('congela los valores autocompletados y el tutor predeterminado en la instantánea', async () => {
      const { service, actor, generacionRepo, queue } = setup({ personal: personalCompleto, contenido: { confirma_problematica: true } });
      await expect(service.solicitar(PERIODO, ASIGNACION, {}, actor, null)).resolves.toEqual({ id: 'new-gen', estado: 'EN_COLA' });
      const instantanea = (generacionRepo.create.mock.calls[0]![0] as GeneracionPat).instantanea;
      expect(instantanea).toMatchObject({ curso: 'Octavo', modalidad: 'INDIVIDUAL', tutor_propuesto_id: 'tp-1', tutor_fuente: 'TUTOR_PROPUESTO_PREDETERMINADO', contenido: { problematica: 'Descripción del tema', articulaciones: ['INVESTIGACION'] } });
      expect(queue.add).toHaveBeenCalledWith('generar-pat', { id: 'new-gen', ciclo: 1 }, expect.objectContaining({ jobId: 'pat-new-gen-1', removeOnFail: false }));
    });

    it('no guarda en la instantánea la matrícula ni la cédula de los compañeros', async () => {
      const { service, actor, generacionRepo } = setup({ grupal: true, personal: personalCompleto, contenido: { confirma_problematica: true } });
      await service.solicitar(PERIODO, ASIGNACION, {}, actor, null);
      const instantanea = (generacionRepo.create.mock.calls[0]![0] as GeneracionPat).instantanea;
      expect(instantanea['participantes']).toEqual([
        { id: 'student-id', nombres: 'José', apellidos: 'Peña' },
        { id: 'peer-id', nombres: 'María', apellidos: 'Zambrano' },
      ]);
      expect(JSON.stringify(instantanea)).not.toContain(MATRICULA_COMPANERO);
      expect(instantanea).toMatchObject({ cedula: '1300000000', matricula: '1300000000' });
    });

    it('acepta otra propuesta de la misma postulación y rechaza una ajena o con tutor vigente', async () => {
      const ok = setup({ personal: personalCompleto, contenido: { confirma_problematica: true } });
      await ok.service.solicitar(PERIODO, ASIGNACION, { tutor_propuesto_id: 'tp-2' }, ok.actor, null);
      expect((ok.generacionRepo.create.mock.calls[0]![0] as GeneracionPat).instantanea).toMatchObject({ tutor_propuesto_id: 'tp-2', tutor_fuente: 'TUTOR_PROPUESTO_ELEGIDO' });
      await expect(ok.service.solicitar(PERIODO, ASIGNACION, { tutor_propuesto_id: 'tp-ajeno' }, ok.actor, null)).rejects.toThrow('no pertenece');
      const vigente = setup({ vigente: true, personal: personalCompleto, contenido: { confirma_problematica: true } });
      await expect(vigente.service.solicitar(PERIODO, ASIGNACION, { tutor_propuesto_id: 'tp-1' }, vigente.actor, null)).rejects.toThrow('tutor vigente');
    });

    it('retira un trabajo fallido con el mismo jobId antes de volver a publicar', async () => {
      const { service, actor, queue, failedJob } = setup({ personal: personalCompleto, contenido: { confirma_problematica: true }, jobFallido: true });
      await service.solicitar(PERIODO, ASIGNACION, {}, actor, null);
      expect(queue.getJob).toHaveBeenCalledWith('pat-new-gen-1');
      expect(failedJob.remove).toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalled();
    });
  });

  describe('contenido', () => {
    it('valida la propuesta de tutor elegida antes de guardarla', async () => {
      const { service, actor, contenidoRepo } = setup();
      await expect(service.actualizarContenido(PERIODO, ASIGNACION, { tutor_propuesto_id: 'tp-ajeno' }, actor, null)).rejects.toThrow('no pertenece');
      expect(contenidoRepo.save).not.toHaveBeenCalled();
      const result = await service.actualizarContenido(PERIODO, ASIGNACION, { tutor_propuesto_id: 'tp-2', confirma_problematica: true }, actor, null);
      expect(result.contenido).toMatchObject({ tutor_propuesto_id: 'tp-2', confirma_problematica: true });
      expect(result.pendientes).toEqual([]);
    });

    it('null borra la elección de tutor guardada', async () => {
      const { service, actor } = setup({ contenido: { tutor_propuesto_id: 'tp-2' } });
      const result = await service.actualizarContenido(PERIODO, ASIGNACION, { tutor_propuesto_id: null }, actor, null);
      expect(result.contenido).not.toHaveProperty('tutor_propuesto_id');
    });

    it('rechaza elegir propuesta cuando ya hay tutor vigente', async () => {
      const { service, actor } = setup({ vigente: true });
      await expect(service.actualizarContenido(PERIODO, ASIGNACION, { tutor_propuesto_id: 'tp-1' }, actor, null)).rejects.toThrow('tutor vigente');
    });
  });

  describe('listado y consulta', () => {
    it('lista las generaciones propias de la más reciente a la más antigua con ciclo, error y entrega', async () => {
      const { service, actor, query } = setup();
      const result = await service.listar(PERIODO, ASIGNACION, actor);
      expect(result.total).toBe(2);
      expect(result.data.map((item) => item.id)).toEqual(['gen-2', 'gen-1']);
      expect(result.data[0]).toMatchObject({ ciclo: 2, estado: 'LISTO', tamano_bytes: 2048, documento_pat_id: 'doc-pat', error: null });
      expect(result.data[1]).toMatchObject({ estado: 'FALLIDO', error: 'No se pudo generar el archivo PAT.', documento_pat_id: null });
      const sql = query.mock.calls.find(([text]) => String(text).includes('documento_pat_id'))!;
      expect(sql[0]).toContain('ORDER BY g."solicitada_en" DESC');
      expect(sql[1]).toEqual([ASIGNACION, 'student-id']);
    });

    it('no lista generaciones de una asignación ajena', async () => {
      const { service, actor } = setup({ owner: false });
      await expect(service.listar(PERIODO, ASIGNACION, actor)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reintentar', () => {
    const fallida = { id: 'gen-1', asignacion_tema_id: ASIGNACION, estudiante_id: 'student-id', solicitada_por_id: 'otro-usuario', estado: 'FALLIDO', ciclo: 1 };

    it('busca por estudiante (no por quien solicitó) y publica un jobId nuevo con el ciclo siguiente', async () => {
      const { service, actor, generacionRepo, queue, audit } = setup({ generacion: fallida });
      await expect(service.reintentar(PERIODO, ASIGNACION, 'gen-1', actor, null)).resolves.toEqual({ id: 'gen-1', estado: 'EN_COLA' });
      expect(generacionRepo.findOneBy).toHaveBeenCalledWith({ id: 'gen-1', asignacion_tema_id: ASIGNACION, estudiante_id: 'student-id' });
      expect(generacionRepo.update).toHaveBeenCalledWith({ id: 'gen-1', estado: 'FALLIDO', ciclo: 1 }, expect.objectContaining({ estado: 'EN_COLA', ciclo: 2 }));
      expect(queue.add).toHaveBeenCalledWith('generar-pat', { id: 'gen-1', ciclo: 2 }, expect.objectContaining({ jobId: 'pat-gen-1-2' }));
      expect(audit.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'REINTENTAR_GENERACION_PAT' }));
    });

    it('solo reintenta fallidas, no encuentra ajenas y detecta un cambio concurrente', async () => {
      await expect(setup({ generacion: { ...fallida, estado: 'LISTO' } }).service.reintentar(PERIODO, ASIGNACION, 'gen-1', setup().actor, null)).rejects.toBeInstanceOf(ConflictException);
      await expect(setup({ generacion: null }).service.reintentar(PERIODO, ASIGNACION, 'gen-1', setup().actor, null)).rejects.toBeInstanceOf(NotFoundException);
      const concurrent = setup({ generacion: fallida, updateAffected: 0 });
      await expect(concurrent.service.reintentar(PERIODO, ASIGNACION, 'gen-1', concurrent.actor, null)).rejects.toBeInstanceOf(ConflictException);
      expect(concurrent.queue.add).not.toHaveBeenCalled();
    });
  });

  describe('recuperación de atascadas', () => {
    it('devuelve a EN_COLA con ciclo nuevo las PROCESANDO que superan el plazo', async () => {
      const { service, query } = setup({ atascadas: [{ id: 'gen-x', ciclo: 3 }] });
      await expect(service.recuperarAtascadas()).resolves.toEqual([{ id: 'gen-x', ciclo: 3 }]);
      const [sql, params] = query.mock.calls.find(([text]) => String(text).includes('WITH recuperadas'))!;
      expect(sql).toContain(`"estado"='EN_COLA', "ciclo"="ciclo"+1`);
      expect(sql).toContain(`WHERE "estado"='PROCESANDO' AND COALESCE("procesando_desde","solicitada_en")`);
      expect(params).toEqual([GENERACION_PAT_ATASCADA_MS / 1000]);
      expect(GENERACION_PAT_ATASCADA_MS).toBe(300_000);
    });

    it('el barrido periódico recupera y publica con el ciclo nuevo', async () => {
      const { service, generacionRepo, queue } = setup({ atascadas: [{ id: 'gen-x', ciclo: 3 }] });
      generacionRepo.find.mockResolvedValueOnce([{ id: 'gen-x', ciclo: 3 }] as never);
      await service['publicarPendientes']();
      expect(queue.add).toHaveBeenCalledWith('generar-pat', { id: 'gen-x', ciclo: 3 }, expect.objectContaining({ jobId: 'pat-gen-x-3' }));
    });

    it('no programa el barrido si BACKGROUND_TASKS_ENABLED es false', () => {
      const { service } = setup();
      service.onModuleInit();
      expect(service['timer']).toBeUndefined();
    });
  });

  describe('validación', () => {
    const plain = Object.create(GeneracionesPatService.prototype) as GeneracionesPatService;

    it('rechaza una fecha de nacimiento imposible o futura', () => {
      expect(() => plain['validatePersonal']({ fecha_nacimiento: '2001-02-30' })).toThrow();
      expect(() => plain['validatePersonal']({ fecha_nacimiento: '2999-01-01' })).toThrow();
    });
  });
});
