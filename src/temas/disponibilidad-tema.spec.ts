import { describe, expect, it } from 'vitest';
import { estaDisponible, filtroEstados, puedeEditarse } from './disponibilidad-tema.js';
import { EstadoTema } from './enums/estado-tema.enum.js';

describe('estaDisponible', () => {
  it('solo un tema PUBLICADO sin asignación VIGENTE está disponible', () => {
    expect(estaDisponible(EstadoTema.PUBLICADO, false)).toBe(true);
    expect(estaDisponible(EstadoTema.PUBLICADO, true)).toBe(false);
    expect(estaDisponible(EstadoTema.ASIGNADO, true)).toBe(false);
    expect(estaDisponible(EstadoTema.BORRADOR, false)).toBe(false);
  });

  it('un tema anulado vuelve al banco al regresar a PUBLICADO', () => {
    expect(estaDisponible(EstadoTema.ASIGNADO, true)).toBe(false);
    expect(estaDisponible(EstadoTema.PUBLICADO, false)).toBe(true);
  });
});

describe('puedeEditarse', () => {
  it('permite editar cualquier tema sin asignación VIGENTE', () => {
    for (const estado of [EstadoTema.BORRADOR, EstadoTema.PUBLICADO, EstadoTema.CERRADO, EstadoTema.RETIRADO]) {
      expect(puedeEditarse(estado, false)).toBe(true);
    }
  });

  it('bloquea la edición con asignación VIGENTE', () => {
    expect(puedeEditarse(EstadoTema.ASIGNADO, true)).toBe(false);
    expect(puedeEditarse(EstadoTema.PUBLICADO, true)).toBe(false);
    expect(puedeEditarse(EstadoTema.ASIGNADO, false)).toBe(false);
  });
});

describe('filtroEstados', () => {
  it('sin filtros no restringe el estado', () => {
    expect(filtroEstados()).toBeUndefined();
    expect(filtroEstados(EstadoTema.CERRADO)).toEqual([EstadoTema.CERRADO]);
  });

  it('disponible=true equivale a PUBLICADO y es incompatible con otro estado', () => {
    expect(filtroEstados(undefined, true)).toEqual([EstadoTema.PUBLICADO]);
    expect(filtroEstados(EstadoTema.PUBLICADO, true)).toEqual([EstadoTema.PUBLICADO]);
    expect(filtroEstados(EstadoTema.BORRADOR, true)).toEqual([]);
  });

  it('disponible=false excluye PUBLICADO', () => {
    expect(filtroEstados(undefined, false)).toEqual([EstadoTema.BORRADOR, EstadoTema.CERRADO, EstadoTema.ASIGNADO, EstadoTema.RETIRADO]);
    expect(filtroEstados(EstadoTema.ASIGNADO, false)).toEqual([EstadoTema.ASIGNADO]);
    expect(filtroEstados(EstadoTema.PUBLICADO, false)).toEqual([]);
  });
});
