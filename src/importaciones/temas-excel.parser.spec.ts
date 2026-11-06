import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { temasWorkbook } from '../../test/support/temas-workbook.js';
import { carrerasCoinciden, parseTemasXlsx, TOPIC_HEADERS } from './temas-excel.parser.js';
import { buildTopicsTemplate, TOPIC_TEMPLATE_EXAMPLE } from './temas-excel.template.js';

const SOFTWARE = 'Ingeniería en Software';

describe('parseTemasXlsx', () => {
  it('detecta el encabezado debajo de filas de título y omite filas vacías', async () => {
    const parsed = await parseTemasXlsx(await temasWorkbook([
      [1, 'ALMEIDA EDISON', '  Tema A  ', 'SOFTWARE', 'Observación A'],
      [null, null, null, null, null],
      [2, 'PÉREZ', 'Tema B', null, null],
    ]), SOFTWARE);
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.rows).toEqual([
      { fila: 10, nro: '1', docente: 'ALMEIDA EDISON', titulo: 'Tema A', descripcion: 'Observación A', carrera: 'SOFTWARE', duplicado: false, errores: [], advertencias: [] },
      { fila: 12, nro: '2', docente: 'PÉREZ', titulo: 'Tema B', descripcion: null, carrera: null, duplicado: false, errores: [], advertencias: [] },
    ]);
  });

  it('acepta el encabezado en la primera fila y sin columnas opcionales', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Temas');
    sheet.getRow(1).values = ['DOCENTES', 'TEMA'];
    sheet.getRow(2).values = ['ALMEIDA EDISON', 'Tema único'];
    const parsed = await parseTemasXlsx(Buffer.from(await book.xlsx.writeBuffer() as ArrayBuffer), SOFTWARE);
    expect(parsed.rows).toEqual([{ fila: 2, nro: null, docente: 'ALMEIDA EDISON', titulo: 'Tema único', descripcion: null, carrera: null, duplicado: false, errores: [], advertencias: [] }]);
  });

  it('marca error si el tema falta, supera 250 caracteres o falta el docente', async () => {
    const parsed = await parseTemasXlsx(await temasWorkbook([
      [1, 'ALMEIDA EDISON', 'x'.repeat(251)],
      [2, 'ALMEIDA EDISON', null],
      [3, null, 'Tema sin docente'],
    ]), SOFTWARE);
    expect(parsed.rows.map((row) => row.errores)).toEqual([
      ['El tema supera 250 caracteres (251).'],
      ['La columna Temas es obligatoria.'],
      ['La columna Docente es obligatoria.'],
    ]);
  });

  it('advierte cuando la carrera del archivo no coincide con la seleccionada', async () => {
    const parsed = await parseTemasXlsx(await temasWorkbook([[1, 'ALMEIDA EDISON', 'Tema', 'MEDICINA']]), SOFTWARE);
    expect(parsed.rows[0]!.advertencias).toEqual(['La carrera del archivo («MEDICINA») no coincide con la seleccionada («Ingeniería en Software»); se usa la seleccionada.']);
    expect(parsed.rows[0]!.errores).toEqual([]);
  });

  it('marca los temas repetidos dentro del archivo', async () => {
    const parsed = await parseTemasXlsx(await temasWorkbook([[1, 'A B', 'Tema Uno'], [2, 'C D', '  tema   UNO ']]), SOFTWARE);
    expect(parsed.rows[0]!.duplicado).toBe(false);
    expect(parsed.rows[1]).toMatchObject({ duplicado: true, advertencias: ['Tema repetido en el archivo (fila 10); se omitirá.'] });
  });

  it('rechaza fórmulas en las columnas importadas', async () => {
    const parsed = await parseTemasXlsx(await temasWorkbook([[1, 'ALMEIDA EDISON', { formula: '1+1' }]]), SOFTWARE);
    expect(parsed.rows[0]!.errores).toContain('No se permiten fórmulas ni enlaces en las columnas importadas.');
  });

  it('rechaza libros sin encabezados o sin temas', async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Hoja1').getRow(1).values = ['Nombre', 'Descripción'];
    await expect(parseTemasXlsx(Buffer.from(await book.xlsx.writeBuffer() as ArrayBuffer), SOFTWARE)).rejects.toThrow('No se encontró una hoja con los encabezados Docente y Temas en sus primeras 20 filas.');
    await expect(parseTemasXlsx(await temasWorkbook([]), SOFTWARE)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('carrerasCoinciden', () => {
  it('compara sin tildes ni mayúsculas y admite nombres abreviados', () => {
    expect(carrerasCoinciden('SOFTWARE', SOFTWARE)).toBe(true);
    expect(carrerasCoinciden('INGENIERÍA EN SOFTWARE', SOFTWARE)).toBe(true);
    expect(carrerasCoinciden('MEDICINA', SOFTWARE)).toBe(false);
  });
});

describe('buildTopicsTemplate', () => {
  it('genera una plantilla con los encabezados del formato institucional que el parser lee', async () => {
    const template = await buildTopicsTemplate();
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(template as unknown as Parameters<typeof book.xlsx.load>[0]);
    expect(book.worksheets[0]!.getRow(1).values).toEqual([undefined, ...TOPIC_HEADERS]);
    const parsed = await parseTemasXlsx(template, SOFTWARE);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ fila: 2, docente: TOPIC_TEMPLATE_EXAMPLE[1], titulo: TOPIC_TEMPLATE_EXAMPLE[2], advertencias: [], errores: [] });
  });
});
