import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseTeachersXlsx, splitTeacherName, TEACHER_HEADERS } from './docentes-excel.parser.js';
import { buildTeachersTemplate, TEACHER_TEMPLATE_HEADER_ROW } from './docentes-excel.template.js';

interface SheetSpec { name: string; rows: unknown[][]; }

async function workbook(sheets: SheetSpec[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  for (const spec of sheets) {
    const sheet = book.addWorksheet(spec.name);
    spec.rows.forEach((values, rowIndex) => values.forEach((value, index) => {
      sheet.getCell(rowIndex + 1, index + 1).value = value as ExcelJS.CellValue;
    }));
  }
  return Buffer.from(await book.xlsx.writeBuffer() as ArrayBuffer);
}

const HEADER = ['DOCENTES', 'Tipo', 'CARRERA', 'FASE 1'];

async function tutores(rows: unknown[][]): Promise<Buffer> {
  return workbook([{ name: 'Tutores', rows: [HEADER, ...rows] }]);
}

describe('splitTeacherName', () => {
  it('separa dos apellidos y los nombres, en formato legible, y genera nombre1.apellido1', () => {
    expect(splitTeacherName('ALMEIDA ZAMBRANO EDISON ERNESTO')).toEqual({
      apellidos: 'Almeida Zambrano', nombres: 'Edison Ernesto', email: 'edison.almeida@live.uleam.edu.ec',
    });
  });

  it('conserva ñ y tildes en el nombre pero las elimina del correo', () => {
    expect(splitTeacherName('  CEDEÑO   CEDEÑO CÉSAR  EDUARDO ')).toEqual({
      apellidos: 'Cedeño Cedeño', nombres: 'César Eduardo', email: 'cesar.cedeno@live.uleam.edu.ec',
    });
    expect(splitTeacherName("O'NEIL PEÑA ÁNGEL")?.email).toBe('angel.oneil@live.uleam.edu.ec');
  });

  it('rechaza nombres con menos de tres palabras', () => {
    expect(splitTeacherName('MERA ROSA')).toBeNull();
  });
});

describe('parseTeachersXlsx', () => {
  it('lee solo DOCENTES y Tipo, ignora otras columnas y filas vacías, y mapea Nombramiento/Contratos', async () => {
    const parsed = await parseTeachersXlsx(await tutores([
      ['ALMEIDA ZAMBRANO EDISON ERNESTO', 'Nombramiento', 'SOFTWARE', { formula: '1+1' }],
      [null, null, 'SOFTWARE'],
      ['VELASQUEZ MOREIRA GABRIELA MAHOLY', 'contratos', 'SOFTWARE'],
      ['MERO BRIONES HENRY NEURIO', 'Nombramientos', 'TI'],
    ]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      { fila: 2, nombres: 'Edison Ernesto', apellidos: 'Almeida Zambrano', email: 'edison.almeida@live.uleam.edu.ec', tipo: 'NOMBRAMIENTO', habilitado_tutoria: true, advertencia: null },
      { fila: 4, nombres: 'Gabriela Maholy', apellidos: 'Velasquez Moreira', email: 'gabriela.velasquez@live.uleam.edu.ec', tipo: 'CONTRATO', habilitado_tutoria: false, advertencia: null },
      { fila: 5, nombres: 'Henry Neurio', apellidos: 'Mero Briones', email: 'henry.mero@live.uleam.edu.ec', tipo: 'NOMBRAMIENTO', habilitado_tutoria: true, advertencia: null },
    ]);
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('Tipo vacío u otro valor no bloquea: deshabilita la tutoría y deja una advertencia', async () => {
    const parsed = await parseTeachersXlsx(await tutores([
      ['PANCHANA FLORES JOFFRE EDGARDO', null],
      ['PEREZ VELIZ JONNY VICENTE', 'Ocasional'],
    ]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((row) => [row.tipo, row.habilitado_tutoria, row.advertencia !== null])).toEqual([[null, false, true], [null, false, true]]);
  });

  it('deduplica por nombre completo entre fases; Nombramiento prevalece sobre Contratos o vacío', async () => {
    const parsed = await parseTeachersXlsx(await tutores([
      ['PANCHANA FLORES JOFFRE EDGARDO', null],
      ['VELASQUEZ MOREIRA GABRIELA MAHOLY', 'Contratos'],
      ['Panchana  Flores Joffre Edgardo', 'Nombramiento'],
      ['VELÁSQUEZ MOREIRA GABRIELA MAHOLY', 'Nombramiento'],
      ['VELASQUEZ MOREIRA GABRIELA MAHOLY', 'Contratos'],
    ]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({ fila: 2, tipo: 'NOMBRAMIENTO', habilitado_tutoria: true, advertencia: null });
    expect(parsed.rows[1]).toMatchObject({ fila: 3, tipo: 'NOMBRAMIENTO', habilitado_tutoria: true });
  });

  it('informa errores por fila: nombre incompleto, correo repetido por otra persona y fórmulas', async () => {
    const parsed = await parseTeachersXlsx(await tutores([
      ['MERA ROSA', 'Nombramiento'],
      ['ALMEIDA ZAMBRANO EDISON ERNESTO', 'Nombramiento'],
      ['ALMEIDA MERO EDISON JAVIER', 'Contratos'],
      [{ formula: '"A"' }, 'Nombramiento'],
      ['LOOR VERA ANA', { text: 'Nombramiento', hyperlink: 'https://malicioso.example' }],
    ]));
    expect(parsed.rows.map((row) => row.fila)).toEqual([3]);
    expect(parsed.errors).toEqual([
      expect.objectContaining({ fila: 2, columna: 'DOCENTES' }),
      expect.objectContaining({ fila: 4, columna: 'DOCENTES', mensaje: expect.stringContaining('fila 3') }),
      expect.objectContaining({ fila: 5, columna: 'fila' }),
      expect.objectContaining({ fila: 6, columna: 'fila' }),
    ]);
  });

  it('elige la hoja Tutores entre varias hojas, sin importar mayúsculas ni tildes', async () => {
    const parsed = await parseTeachersXlsx(await workbook([
      { name: 'Resumen', rows: [['DOCENTES', 'Tipo'], ['OTRO DOCENTE DE RESUMEN', 'Nombramiento']] },
      { name: 'Fase 1', rows: [['Estudiante', 'Tema']] },
      { name: 'TUTORÉS', rows: [['Lista'], HEADER, ['ARAY ARAUZ RICARDO ADRIAN', 'Nombramiento']] },
    ]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([expect.objectContaining({ fila: 3, email: 'ricardo.aray@live.uleam.edu.ec' })]);
  });

  it('sin hoja Tutores usa la primera hoja con encabezados DOCENTES y Tipo', async () => {
    const parsed = await parseTeachersXlsx(await workbook([
      { name: 'Fase 1', rows: [['Estudiante', 'Tema']] },
      { name: 'Lista', rows: [['docentes', 'TIPO'], ['ARAY ARAUZ RICARDO ADRIAN', 'Contratos']] },
    ]));
    expect(parsed.rows).toEqual([expect.objectContaining({ tipo: 'CONTRATO', habilitado_tutoria: false })]);
  });

  it('rechaza libros sin encabezados, sin filas o que no son XLSX', async () => {
    await expect(parseTeachersXlsx(await workbook([{ name: 'Hoja', rows: [['DOCENTES', 'CARRERA']] }]))).rejects.toThrow('No se encontró la hoja');
    await expect(parseTeachersXlsx(await workbook([{ name: 'Tutores', rows: [['Nombre']] }]))).rejects.toThrow('no tiene los encabezados');
    await expect(parseTeachersXlsx(await tutores([]))).rejects.toThrow('no contiene filas de docentes');
    await expect(parseTeachersXlsx(Buffer.from('no es xlsx'))).rejects.toThrow();
  });

  it('la plantilla descargable trae DOCENTES/Tipo y ejemplos que el mismo parser acepta', async () => {
    const template = await buildTeachersTemplate();
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(template as unknown as Parameters<typeof book.xlsx.load>[0]);
    const sheet = book.worksheets[0];
    expect(sheet.name).toBe('Tutores');
    expect((sheet.getRow(TEACHER_TEMPLATE_HEADER_ROW).values as unknown[]).slice(1, 3)).toEqual([...TEACHER_HEADERS]);
    const parsed = await parseTeachersXlsx(template);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((row) => [row.email, row.habilitado_tutoria])).toEqual([
      ['edison.almeida@live.uleam.edu.ec', true],
      ['gabriela.velasquez@live.uleam.edu.ec', false],
    ]);
  });

  it('procesa el libro institucional de muestra', async () => {
    const buffer = readFileSync(new URL('../../test/fixtures/docentes-tutores.xlsx', import.meta.url));
    const parsed = await parseTeachersXlsx(buffer);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(22);
    expect(parsed.rows.filter((row) => row.habilitado_tutoria)).toHaveLength(21);
    expect(parsed.rows.filter((row) => row.advertencia)).toEqual([]);
    expect(parsed.rows.find((row) => row.email === 'cesar.cedeno@live.uleam.edu.ec')).toMatchObject({ nombres: 'Cesar Eduardo', apellidos: 'Cedeño Cedeño' });
    expect(parsed.rows.find((row) => row.email === 'joffre.panchana@live.uleam.edu.ec')).toMatchObject({ habilitado_tutoria: true });
    expect(parsed.rows.find((row) => row.email === 'gabriela.velasquez@live.uleam.edu.ec')).toMatchObject({ habilitado_tutoria: false });
  });
});
