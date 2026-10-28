import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { QueryFailedError } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { UpdateHabilitacionDto } from './dto/update-habilitacion.dto.js';
import { HabilitadosService } from './habilitados.service.js';
import { CondicionIngreso } from './enums/condicion-ingreso.enum.js';
import { HabilitadoEstado } from './enums/habilitado-estado.enum.js';
import { HabilitadoOrigen } from './enums/habilitado-origen.enum.js';
import { SituacionIngreso } from './enums/situacion-ingreso.enum.js';

function setup(estado: PeriodoEstado = PeriodoEstado.BORRADOR) {
  const actor = { id: 'admin-id', rol: UsuarioRol.ADMIN };
  const importador = { id: 'importador-id' };
  const periodo = { id: 'periodo-id', estado };
  const record = {
    id: 'habilitado-id',
    periodo,
    estudiante: { id: 'estudiante-id', matricula: '1300000000', usuario: { nombres: 'Ana', apellidos: 'Pérez' } },
    origen: HabilitadoOrigen.IMPORTACION,
    lote_importacion: { id: 'lote-id' },
    estado: HabilitadoEstado.SUSPENDIDO,
    condicion_ingreso: CondicionIngreso.REGULAR,
    requisito_pendiente: null as string | null,
    situacion_ingreso: SituacionIngreso.NO_ADMITIDO,
    fecha_habilitacion: new Date('2026-01-01T00:00:00Z'),
    fecha_resolucion_ingreso: new Date('2026-01-01T00:00:00Z') as Date | null,
    resuelto_por: importador as { id: string } | null,
    observacion_ingreso: 'Importado sin inglés' as string | null,
  };
  const periodRepo = { findOne: vi.fn(async () => periodo) };
  const habilitadoRepo = {
    findOne: vi.fn(async () => record),
    save: vi.fn(async (value: typeof record) => value),
  };
  const manager = { getRepository: (entity: unknown) => entity === PeriodoTitulacion ? periodRepo : habilitadoRepo };
  const dataSource = { transaction: vi.fn(async (callback: (m: typeof manager) => Promise<unknown>) => callback(manager)) };
  const auditoria = { registrar: vi.fn(async () => undefined) };
  const service = new HabilitadosService(
    {} as never, dataSource as never, {} as never, auditoria as never, {} as never, {} as never,
  );
  return { service, actor, record, periodRepo, habilitadoRepo, auditoria };
}

describe('HabilitadosService.actualizarCondicion', () => {
  it('pasa un SUSPENDIDO/NO_ADMITIDO a CONDICIONADO/PENDIENTE y lo vuelve a habilitar', async () => {
    const state = setup();
    const result = await state.service.actualizarCondicion('periodo-id', 'habilitado-id', state.actor as never, {
      condicion_ingreso: CondicionIngreso.CONDICIONADO,
      requisito_pendiente: '  Le falta inglés  ',
    }, '127.0.0.1');
    expect(result).toMatchObject({
      estado: HabilitadoEstado.HABILITADO,
      condicion_ingreso: CondicionIngreso.CONDICIONADO,
      requisito_pendiente: 'Le falta inglés',
      situacion_ingreso: SituacionIngreso.PENDIENTE,
      fecha_resolucion_ingreso: null,
      resuelto_por_id: null,
      observacion_ingreso: null,
      lote_importacion_id: 'lote-id',
    });
    expect(state.periodRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
    expect(state.habilitadoRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      accion: 'ACTUALIZAR_HABILITACION',
      valores_anteriores: {
        estado: HabilitadoEstado.SUSPENDIDO,
        condicion_ingreso: CondicionIngreso.REGULAR,
        requisito_pendiente: null,
        situacion_ingreso: SituacionIngreso.NO_ADMITIDO,
      },
      valores_nuevos: {
        estado: HabilitadoEstado.HABILITADO,
        condicion_ingreso: CondicionIngreso.CONDICIONADO,
        requisito_pendiente: 'Le falta inglés',
        situacion_ingreso: SituacionIngreso.PENDIENTE,
      },
    }));
  });

  it('pasa a REGULAR/ADMITIDO resuelto por el actor', async () => {
    const state = setup(PeriodoEstado.EN_CURSO);
    const result = await state.service.actualizarCondicion('periodo-id', 'habilitado-id', state.actor as never, {
      condicion_ingreso: CondicionIngreso.REGULAR,
      requisito_pendiente: null,
    }, null);
    expect(result).toMatchObject({
      estado: HabilitadoEstado.HABILITADO,
      condicion_ingreso: CondicionIngreso.REGULAR,
      requisito_pendiente: null,
      situacion_ingreso: SituacionIngreso.ADMITIDO,
      resuelto_por_id: 'admin-id',
      observacion_ingreso: null,
    });
    expect(result.fecha_resolucion_ingreso).toBeInstanceOf(Date);
  });

  it('rechaza editar en un período ARCHIVADO sin escribir', async () => {
    const state = setup(PeriodoEstado.ARCHIVADO);
    await expect(state.service.actualizarCondicion('periodo-id', 'habilitado-id', state.actor as never, {
      condicion_ingreso: CondicionIngreso.REGULAR,
    }, null)).rejects.toBeInstanceOf(ConflictException);
    expect(state.habilitadoRepo.save).not.toHaveBeenCalled();
    expect(state.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('rechaza CONDICIONADO en un período EN_CURSO sin escribir', async () => {
    const state = setup(PeriodoEstado.EN_CURSO);
    await expect(state.service.actualizarCondicion('periodo-id', 'habilitado-id', state.actor as never, {
      condicion_ingreso: CondicionIngreso.CONDICIONADO,
      requisito_pendiente: 'Le falta inglés',
    }, null)).rejects.toBeInstanceOf(ConflictException);
    expect(state.habilitadoRepo.save).not.toHaveBeenCalled();
  });

  it('traduce el rechazo del trigger de PostgreSQL (23514) a 409', async () => {
    const state = setup(PeriodoEstado.POSTULACION_CERRADA);
    state.habilitadoRepo.save.mockRejectedValue(new QueryFailedError('UPDATE', [], Object.assign(new Error('check'), { code: '23514' })));
    await expect(state.service.actualizarCondicion('periodo-id', 'habilitado-id', state.actor as never, {
      condicion_ingreso: CondicionIngreso.CONDICIONADO,
      requisito_pendiente: 'Le falta inglés',
    }, null)).rejects.toBeInstanceOf(ConflictException);
  });

  it('responde 404 si la habilitación no pertenece al período', async () => {
    const state = setup();
    state.habilitadoRepo.findOne.mockResolvedValue(null as never);
    await expect(state.service.actualizarCondicion('periodo-id', 'otro-id', state.actor as never, {
      condicion_ingreso: CondicionIngreso.REGULAR,
    }, null)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza REGULAR con requisito también en el servicio', async () => {
    const state = setup();
    await expect(state.service.actualizarCondicion('periodo-id', 'habilitado-id', state.actor as never, {
      condicion_ingreso: CondicionIngreso.REGULAR,
      requisito_pendiente: 'Algo',
    }, null)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UpdateHabilitacionDto', () => {
  const errors = (body: Record<string, unknown>) => validateSync(plainToInstance(UpdateHabilitacionDto, body));

  it('acepta REGULAR sin requisito y CONDICIONADO con requisito', () => {
    expect(errors({ condicion_ingreso: 'REGULAR' })).toHaveLength(0);
    expect(errors({ condicion_ingreso: 'REGULAR', requisito_pendiente: null })).toHaveLength(0);
    expect(errors({ condicion_ingreso: 'CONDICIONADO', requisito_pendiente: ' Le falta inglés ' })).toHaveLength(0);
  });

  it('rechaza REGULAR con requisito pendiente', () => {
    expect(errors({ condicion_ingreso: 'REGULAR', requisito_pendiente: 'Le falta inglés' }).length).toBeGreaterThan(0);
  });

  it('rechaza CONDICIONADO sin requisito o con requisito vacío', () => {
    for (const requisito_pendiente of [undefined, null, '', '   ', 5]) {
      expect(errors({ condicion_ingreso: 'CONDICIONADO', requisito_pendiente }).length).toBeGreaterThan(0);
    }
  });

  it('rechaza una condición desconocida', () => {
    expect(errors({ condicion_ingreso: 'OTRA' }).length).toBeGreaterThan(0);
  });
});
