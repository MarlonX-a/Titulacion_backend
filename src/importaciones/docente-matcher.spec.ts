import { describe, expect, it } from 'vitest';
import { coincidirDocente, normalizarNombre, tokensNombre, type DocenteCandidato } from './docente-matcher.js';

const docentes: DocenteCandidato[] = [
  { id: 'd1', nombres: 'Edison Ernesto', apellidos: 'Almeida Zambrano' },
  { id: 'd2', nombres: 'María José', apellidos: 'Pérez-Cedeño Mero' },
  { id: 'd3', nombres: 'Juan', apellidos: 'Pérez Loor' },
  { id: 'd4', nombres: 'Juana', apellidos: 'Pérez Vera' },
];

describe('normalizarNombre', () => {
  it('quita tildes, mayúsculas, guiones y espacios repetidos', () => {
    expect(normalizarNombre('  PÉREZ-CEDEÑO   María  ')).toBe('perez cedeno maria');
  });

  it('descarta títulos académicos y signos de puntuación', () => {
    expect(tokensNombre('Ing. Almeida, Edison Mg.')).toEqual(['almeida', 'edison']);
  });
});

describe('coincidirDocente', () => {
  it('vincula automáticamente una coincidencia única', () => {
    expect(coincidirDocente('ALMEIDA ZAMBRANO EDISON', docentes)).toEqual({ docente: docentes[0], candidatos: [] });
  });

  it('ignora tildes, mayúsculas y guiones', () => {
    expect(coincidirDocente('perez cedeno maria jose', docentes).docente?.id).toBe('d2');
  });

  it('deja pendiente sin candidatos cuando nadie coincide', () => {
    expect(coincidirDocente('Rodríguez Gómez Ana', docentes)).toEqual({ docente: null, candidatos: [] });
  });

  it('deja pendiente con candidatos cuando hay varias coincidencias', () => {
    const resultado = coincidirDocente('Pérez', docentes);
    expect(resultado.docente).toBeNull();
    expect(resultado.candidatos.map((d) => d.id)).toEqual(['d2', 'd3', 'd4']);
  });

  it('exige cada palabra completa y no fragmentos', () => {
    expect(coincidirDocente('Juan Pérez', docentes).docente?.id).toBe('d3');
  });

  it('no vincula un nombre vacío', () => {
    expect(coincidirDocente('  Ing.  ', docentes)).toEqual({ docente: null, candidatos: [] });
  });
});
