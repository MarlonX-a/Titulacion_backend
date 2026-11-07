import { describe, expect, it } from 'vitest';
import { TipoTema } from './enums/tipo-tema.enum.js';
import { admiteIntegrantes, integrantesPermitidos, mensajeRangoIntegrantes, MIN_INTEGRANTES_GRUPO, rangoIntegrantesSql } from './integrantes-tema.js';

describe('integrantesPermitidos', () => {
  it('fija 1 para INDIVIDUAL y 2 para PAREJA sin depender del período', () => {
    expect(integrantesPermitidos(TipoTema.INDIVIDUAL)).toEqual({ min: 1, max: 1 });
    expect(integrantesPermitidos(TipoTema.PAREJA, 8)).toEqual({ min: 2, max: 2 });
  });

  it('usa 3 como mínimo de GRUPO y el máximo del período como tope', () => {
    expect(MIN_INTEGRANTES_GRUPO).toBe(3);
    expect(integrantesPermitidos(TipoTema.GRUPO, 5)).toEqual({ min: 3, max: 5 });
    expect(integrantesPermitidos(TipoTema.GRUPO)).toEqual({ min: 3, max: null });
  });
});

describe('admiteIntegrantes', () => {
  it('valida la cantidad exacta de INDIVIDUAL y PAREJA', () => {
    expect(admiteIntegrantes(TipoTema.INDIVIDUAL, 1, 5)).toBe(true);
    expect(admiteIntegrantes(TipoTema.INDIVIDUAL, 2, 5)).toBe(false);
    expect(admiteIntegrantes(TipoTema.PAREJA, 2, 5)).toBe(true);
    expect(admiteIntegrantes(TipoTema.PAREJA, 3, 5)).toBe(false);
  });

  it('valida GRUPO entre 3 y el máximo del período', () => {
    expect(admiteIntegrantes(TipoTema.GRUPO, 2, 5)).toBe(false);
    expect(admiteIntegrantes(TipoTema.GRUPO, 3, 5)).toBe(true);
    expect(admiteIntegrantes(TipoTema.GRUPO, 5, 5)).toBe(true);
    expect(admiteIntegrantes(TipoTema.GRUPO, 6, 5)).toBe(false);
    expect(admiteIntegrantes(TipoTema.GRUPO, 3, 2)).toBe(false);
  });
});

describe('mensajeRangoIntegrantes', () => {
  it('explica la regla incumplida', () => {
    expect(mensajeRangoIntegrantes(TipoTema.PAREJA, 3, 5)).toBe('El tema PAREJA admite 2 integrante(s); la solicitud tiene 3.');
    expect(mensajeRangoIntegrantes(TipoTema.GRUPO, 2, 5)).toBe('El tema GRUPO admite entre 3 y 5 integrante(s); la solicitud tiene 2.');
  });
});

describe('rangoIntegrantesSql', () => {
  it('replica la regla en SQL con el máximo del período indicado', () => {
    const sql = rangoIntegrantesSql('t', 'pe."max_integrantes_default"');
    expect(sql.min).toBe(`(CASE t."tipo" WHEN 'INDIVIDUAL' THEN 1 WHEN 'PAREJA' THEN 2 ELSE 3 END)`);
    expect(sql.max).toBe(`(CASE t."tipo" WHEN 'INDIVIDUAL' THEN 1 WHEN 'PAREJA' THEN 2 ELSE pe."max_integrantes_default" END)`);
  });
});
