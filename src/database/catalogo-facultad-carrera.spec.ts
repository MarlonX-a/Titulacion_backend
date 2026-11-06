import { describe, expect, it } from 'vitest';
import { CATALOGO_FACULTAD_CARRERA, codigoCatalogo } from './catalogo-facultad-carrera.js';

describe('catálogo de facultades y carreras', () => {
  it('genera códigos en mayúsculas sin tildes ni signos', () => {
    expect(codigoCatalogo('Nutrición y Dietética')).toBe('NUTRICION_Y_DIETETICA');
    expect(codigoCatalogo('Facultad Ciencias Administrativas, Contables y Comercio')).toBe('FACULTAD_CIENCIAS_ADMINISTRATIVAS_CONTABLES_Y_COMERCIO');
    expect(codigoCatalogo('Educación Básica Bilingüe')).toBe('EDUCACION_BASICA_BILINGUE');
  });

  it('contiene las 7 facultades del diseño con su cantidad de carreras', () => {
    expect(CATALOGO_FACULTAD_CARRERA.map((f) => [f.nombre, f.carreras.length])).toEqual([
      ['Facultad Ciencias de la Salud', 9],
      ['Facultad Ciencias Administrativas, Contables y Comercio', 8],
      ['Facultad de Educación y Turismo', 14],
      ['Facultad Ingeniería, Industria y Arquitectura', 5],
      ['Facultad Ciencias de la Vida y Tecnologías', 9],
      ['Facultad de Ciencias Sociales, Derecho y Bienestar', 6],
      ['Facultad de Artes, Humanidades y Patrimonio', 5],
    ]);
  });

  it('no repite códigos ni nombres y respeta el tamaño de las columnas', () => {
    const carreras = CATALOGO_FACULTAD_CARRERA.flatMap((f) => f.carreras);
    expect(carreras).toHaveLength(56);
    expect(new Set(carreras.map((c) => c.codigo)).size).toBe(56);
    expect(new Set(carreras.map((c) => c.nombre)).size).toBe(56);
    expect(new Set(CATALOGO_FACULTAD_CARRERA.map((f) => f.codigo)).size).toBe(7);
    for (const item of [...CATALOGO_FACULTAD_CARRERA, ...carreras]) {
      expect(item.codigo.length).toBeLessThanOrEqual(80);
      expect(item.nombre.length).toBeLessThanOrEqual(150);
    }
  });

  it('deja las carreras repetidas de las imágenes solo en Artes y distingue Psicología', () => {
    const artes = CATALOGO_FACULTAD_CARRERA.find((f) => f.codigo === 'FACULTAD_DE_ARTES_HUMANIDADES_Y_PATRIMONIO');
    expect(artes?.carreras.map((c) => c.nombre)).toEqual(['Artes Plásticas', 'Arqueología', 'Artes Escénicas', 'Diseño Textil e Indumentaria', 'Sociología']);
    const codigos = CATALOGO_FACULTAD_CARRERA.flatMap((f) => f.carreras.map((c) => c.codigo));
    expect(codigos).toEqual(expect.arrayContaining(['PSICOLOGIA', 'PSICOLOGIA_EDUCATIVA', 'INGENIERIA_EN_SISTEMAS']));
  });
});
