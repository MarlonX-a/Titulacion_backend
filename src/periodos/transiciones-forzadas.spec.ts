import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AcademicoService } from '../academico/academico.service.js';
import { construirCatalogo } from '../academico/catalogo-academico.js';
import { TransicionPeriodoDto } from './dto/transicion-periodo.dto.js';
import { PeriodoEstado } from './enums/periodo-estado.enum.js';
import { InicioTitulacionService } from './inicio-titulacion.service.js';
import { PeriodosService } from './periodos.service.js';

/** Hora del reloj de Node en las pruebas. */
const NOW = new Date('2026-05-10T12:00:00Z');
/** Hora devuelta por `SELECT clock_timestamp()`: la que se usa para ajustar fechas al forzar. */
const DB_NOW = new Date('2026-05-10T12:00:05Z');
const MOTIVO = 'Calendario institucional adelantado por resolución.';
const actor = { id: 'admin-id' };

interface Fechas { inicio: string; fin: string; titulacion?: string }

function setupPeriodos(estado: PeriodoEstado, fechas: Fechas) {
  const periodo = {
    id: 'periodo-id', codigo: '2026-1', nombre: 'Período', estado, facultad_id: 'fac-1', max_integrantes_default: 3,
    fecha_inicio_postulacion: new Date(fechas.inicio),
    fecha_fin_postulacion: new Date(fechas.fin),
    fecha_inicio_titulacion: new Date(fechas.titulacion ?? '2026-06-01T00:00:00Z'),
  };
  const txRepo = { findOne: vi.fn(async () => periodo), save: vi.fn(async (value: typeof periodo) => ({ ...value })) };
  const query = vi.fn(async (sql: string) => (sql.includes('clock_timestamp') ? [{ ahora: DB_NOW }] : []));
  const manager = { getRepository: () => txRepo, query };
  const dataSource = { options: { schema: 'titulacion_dev' }, transaction: vi.fn(async (cb: (tx: typeof manager) => Promise<unknown>) => cb(manager)) };
  const auditoria = { registrar: vi.fn(async () => undefined) };
  const academico = new AcademicoService();
  vi.spyOn(academico, 'catalogo').mockResolvedValue(construirCatalogo([{ id: 'fac-1', codigo: 'F1', nombre: 'Facultad' }], []));
  const service = new PeriodosService({} as never, dataSource as never, auditoria as never, academico);
  return { service, periodo, txRepo, auditoria };
}

describe('Transiciones forzadas de período', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it('abre forzadamente un BORRADOR antes del inicio: fecha_inicio_postulacion pasa a la hora de PostgreSQL y se audita', async () => {
    const state = setupPeriodos(PeriodoEstado.BORRADOR, { inicio: '2026-05-15T00:00:00Z', fin: '2026-05-20T00:00:00Z' });
    const result = await state.service.abrirPostulacion('periodo-id', { forzar: true, motivo: `  ${MOTIVO}  ` }, actor as never, '10.0.0.1');
    expect(result.estado).toBe(PeriodoEstado.POSTULACION_ABIERTA);
    expect(result.fecha_inicio_postulacion).toEqual(DB_NOW);
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), {
      actor, accion: 'ABRIR_POSTULACION_FORZADA', entidad_tipo: 'periodo_titulacion', entidad_id: 'periodo-id',
      valores_anteriores: { estado: PeriodoEstado.BORRADOR, fecha_inicio_postulacion: new Date('2026-05-15T00:00:00Z') },
      valores_nuevos: { estado: PeriodoEstado.POSTULACION_ABIERTA, fecha_inicio_postulacion: DB_NOW, forzado: true, motivo: MOTIVO },
      ip_origen: '10.0.0.1',
    });
  });

  it('con forzar dentro del plazo no altera fechas y audita la apertura normal', async () => {
    const state = setupPeriodos(PeriodoEstado.BORRADOR, { inicio: '2026-05-01T00:00:00Z', fin: '2026-05-20T00:00:00Z' });
    const result = await state.service.abrirPostulacion('periodo-id', { forzar: true, motivo: MOTIVO }, actor as never, null);
    expect(result.fecha_inicio_postulacion).toEqual(new Date('2026-05-01T00:00:00Z'));
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      accion: 'ABRIR_POSTULACION', valores_nuevos: { estado: PeriodoEstado.POSTULACION_ABIERTA },
    }));
  });

  it('rechaza forzar la apertura o reapertura cuando la fecha fin ya pasó', async () => {
    for (const estado of [PeriodoEstado.BORRADOR, PeriodoEstado.POSTULACION_CERRADA]) {
      const state = setupPeriodos(estado, { inicio: '2026-05-01T00:00:00Z', fin: '2026-05-09T00:00:00Z' });
      await expect(state.service.abrirPostulacion('periodo-id', { forzar: true, motivo: MOTIVO }, actor as never, null))
        .rejects.toThrow('No se puede forzar la apertura: la fecha fin de postulación ya pasó.');
      expect(state.txRepo.save).not.toHaveBeenCalled();
      expect(state.auditoria.registrar).not.toHaveBeenCalled();
    }
  });

  it('forzar no salta la precondición de estado', async () => {
    const state = setupPeriodos(PeriodoEstado.EN_CURSO, { inicio: '2026-05-15T00:00:00Z', fin: '2026-05-20T00:00:00Z' });
    await expect(state.service.abrirPostulacion('periodo-id', { forzar: true, motivo: MOTIVO }, actor as never, null))
      .rejects.toThrow('Solo se pueden abrir períodos en BORRADOR o reabrir períodos en POSTULACION_CERRADA.');
    const abierto = setupPeriodos(PeriodoEstado.BORRADOR, { inicio: '2026-05-01T00:00:00Z', fin: '2026-05-20T00:00:00Z' });
    await expect(abierto.service.cerrarPostulacion('periodo-id', { forzar: true, motivo: MOTIVO }, actor as never, null))
      .rejects.toThrow('Solo se pueden cerrar períodos con postulaciones abiertas.');
  });

  it('exige el motivo en el servicio aunque no pase por el DTO', async () => {
    const state = setupPeriodos(PeriodoEstado.BORRADOR, { inicio: '2026-05-15T00:00:00Z', fin: '2026-05-20T00:00:00Z' });
    await expect(state.service.abrirPostulacion('periodo-id', { forzar: true, motivo: 'corto' }, actor as never, null)).rejects.toBeInstanceOf(BadRequestException);
    expect(state.txRepo.save).not.toHaveBeenCalled();
  });

  it('cierra forzadamente antes del vencimiento y el cierre automático posterior es un no-op', async () => {
    const state = setupPeriodos(PeriodoEstado.POSTULACION_ABIERTA, { inicio: '2026-05-01T00:00:00Z', fin: '2026-05-20T00:00:00Z' });
    const result = await state.service.cerrarPostulacion('periodo-id', { forzar: true, motivo: MOTIVO }, actor as never, null);
    expect(result.estado).toBe(PeriodoEstado.POSTULACION_CERRADA);
    expect(result.fecha_fin_postulacion).toEqual(DB_NOW);
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      accion: 'CERRAR_POSTULACION_FORZADA',
      valores_anteriores: { estado: PeriodoEstado.POSTULACION_ABIERTA, fecha_fin_postulacion: new Date('2026-05-20T00:00:00Z') },
      valores_nuevos: { estado: PeriodoEstado.POSTULACION_CERRADA, fecha_fin_postulacion: DB_NOW, forzado: true, motivo: MOTIVO },
    }));
    // El scheduler vuelve a leer bajo bloqueo: el período ya no está ABIERTO.
    await expect(state.service.cerrarPostulacionAutomatica('periodo-id')).resolves.toBe(false);
    await expect(state.service.abrirPostulacionAutomatica('periodo-id')).resolves.toBe(false);
    expect(state.auditoria.registrar).toHaveBeenCalledTimes(1);
  });

  it('la apertura automática posterior a una apertura forzada no repite la transición', async () => {
    const state = setupPeriodos(PeriodoEstado.BORRADOR, { inicio: '2026-05-15T00:00:00Z', fin: '2026-05-20T00:00:00Z' });
    await state.service.abrirPostulacion('periodo-id', { forzar: true, motivo: MOTIVO }, actor as never, null);
    await expect(state.service.abrirPostulacionAutomatica('periodo-id')).resolves.toBe(false);
    expect(state.auditoria.registrar).toHaveBeenCalledTimes(1);
  });

  it('rechaza forzar el cierre si la postulación aún no inicia (fin debe quedar posterior al inicio)', async () => {
    const state = setupPeriodos(PeriodoEstado.POSTULACION_ABIERTA, { inicio: '2026-05-11T00:00:00Z', fin: '2026-05-20T00:00:00Z' });
    await expect(state.service.cerrarPostulacion('periodo-id', { forzar: true, motivo: MOTIVO }, actor as never, null))
      .rejects.toBeInstanceOf(ConflictException);
    expect(state.txRepo.save).not.toHaveBeenCalled();
  });

  it('sin forzar mantiene el 409 de cierre antes del vencimiento', async () => {
    const state = setupPeriodos(PeriodoEstado.POSTULACION_ABIERTA, { inicio: '2026-05-01T00:00:00Z', fin: '2026-05-20T00:00:00Z' });
    await expect(state.service.cerrarPostulacion('periodo-id', {}, actor as never, null))
      .rejects.toThrow('El período solo puede cerrarse después de vencer el plazo de postulación.');
  });
});

function setupInicio(fechas: { fin: Date; titulacion: Date }) {
  const periodo = {
    id: 'periodo-id', codigo: 'P-1', nombre: 'Período', estado: PeriodoEstado.POSTULACION_CERRADA, max_integrantes_default: 3,
    fecha_inicio_postulacion: new Date('2026-01-01T00:00:00Z'), fecha_fin_postulacion: fechas.fin, fecha_inicio_titulacion: fechas.titulacion,
  };
  const repository = { findOne: vi.fn(async () => periodo), save: vi.fn(async (value: typeof periodo) => ({ ...value })) };
  const query = vi.fn(async (sql: string) => (sql.includes('clock_timestamp') ? [{ ahora: DB_NOW }] : []));
  const manager = { connection: { options: { schema: 'titulacion_dev' } }, getRepository: () => repository, query };
  const dataSource = { transaction: vi.fn(async (_level: string, cb: (m: typeof manager) => Promise<unknown>) => cb(manager)) };
  const auditoria = { registrar: vi.fn(async () => undefined) };
  const service = new InicioTitulacionService(dataSource as never, auditoria as never, { aplicarNoAdmision: vi.fn() } as never, { catalogo: async () => construirCatalogo([], []) } as never);
  return { service, repository, auditoria };
}

describe('Inicio de titulación forzado', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it('inicia antes de la fecha configurada ajustando fecha_inicio_titulacion a la hora de PostgreSQL', async () => {
    const state = setupInicio({ fin: new Date('2026-05-09T00:00:00Z'), titulacion: new Date('2026-06-01T00:00:00Z') });
    const result = await state.service.iniciar('periodo-id', actor as never, null, { forzar: true, motivo: MOTIVO });
    expect(result.estado).toBe(PeriodoEstado.EN_CURSO);
    expect(result.fecha_inicio_titulacion).toEqual(DB_NOW);
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      accion: 'INICIAR_TITULACION_FORZADA',
      valores_anteriores: { estado: PeriodoEstado.POSTULACION_CERRADA, fecha_inicio_titulacion: new Date('2026-06-01T00:00:00Z') },
      valores_nuevos: { estado: PeriodoEstado.EN_CURSO, fecha_inicio_titulacion: DB_NOW, condicionados_suspendidos: 0, forzado: true, motivo: MOTIVO },
    }));
  });

  it('rechaza forzar el inicio mientras el plazo de postulación sigue vigente', async () => {
    const state = setupInicio({ fin: new Date('2026-05-20T00:00:00Z'), titulacion: new Date('2026-06-01T00:00:00Z') });
    await expect(state.service.iniciar('periodo-id', actor as never, null, { forzar: true, motivo: MOTIVO }))
      .rejects.toThrow('No se puede forzar el inicio: el plazo de postulación aún no vence.');
    expect(state.repository.save).not.toHaveBeenCalled();
  });

  it('sin forzar sigue rechazando el inicio anticipado', async () => {
    const state = setupInicio({ fin: new Date('2026-05-09T00:00:00Z'), titulacion: new Date('2026-06-01T00:00:00Z') });
    await expect(state.service.iniciar('periodo-id', actor as never, null)).rejects.toThrow('El período no puede iniciar antes de la fecha configurada.');
  });
});

describe('TransicionPeriodoDto', () => {
  const errores = async (body: object) => (await validate(plainToInstance(TransicionPeriodoDto, body))).map((error) => error.property);

  it('acepta el cuerpo vacío y forzar=false sin motivo', async () => {
    expect(await errores({})).toEqual([]);
    expect(await errores({ forzar: false })).toEqual([]);
  });

  it('exige un motivo de 10 a 500 caracteres al forzar', async () => {
    expect(await errores({ forzar: true })).toEqual(['motivo']);
    expect(await errores({ forzar: true, motivo: '   corto   ' })).toEqual(['motivo']);
    expect(await errores({ forzar: true, motivo: 'x'.repeat(501) })).toEqual(['motivo']);
    expect(await errores({ forzar: true, motivo: MOTIVO })).toEqual([]);
  });

  it('rechaza forzar no booleano', async () => {
    expect(await errores({ forzar: 'true', motivo: MOTIVO })).toEqual(['forzar']);
  });
});
