import ExcelJS from 'exceljs';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStudentsXlsx } from './estudiantes-excel.parser.js';
import { buildStudentsTemplate } from './estudiantes-excel.template.js';

const HEADERS = ['#', 'Campus', 'Identificación', 'Apellidos', 'Nombres', 'nivel', 'ACADEMICO', 'INGLES', 'Tema', 'Tipo', 'Tutor', 'Tema en app'];
const SAMPLE_PATH = 'C:/Users/leopo/OneDrive/Documentos/Prueba estudiante sof.xlsx';

interface FixtureOptions {
  title?: string | null;
  career?: string | null;
  headers?: string[];
  rows: unknown[][];
  configure?: (sheet: ExcelJS.Worksheet) => void;
}

function fillRow(sheet: ExcelJS.Worksheet, number: number, values: unknown[]) {
  values.forEach((value, index) => { sheet.getCell(number, index + 1).value = value as ExcelJS.CellValue; });
}

async function institutionalWorkbook({ title = 'LISTA DE ESTUDIANTES QUE PUEDEN ACCEDER AL PROCESO', career = 'CARRERA SOFTWARE', headers = HEADERS, rows, configure }: FixtureOptions) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('depurado sof');
  if (title) sheet.getCell('A1').value = title;
  if (career) sheet.getCell('A2').value = career;
  fillRow(sheet, 6, headers);
  rows.forEach((values, index) => fillRow(sheet, 7 + index, values));
  configure?.(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
}

describe('parseStudentsXlsx (formato institucional)', () => {
  it('detecta encabezados en la fila 6, la carrera del título e ignora columnas adicionales', async () => {
    const parsed = await parseStudentsXlsx(await institutionalWorkbook({
      career: 'CARRERA TECNOLOGIAS DE LA INFORMACION',
      rows: [[1, 'MANTA', '1316661675', 'ZAMBRANO VERA', 'ORLEY ANTONIO', 7, 'SI', 'SI', 'Tema libre', 'Imp', 'Tutor X', { formula: '1+1' }]],
    }));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([{
      fila: 7, email: 'e1316661675@live.uleam.edu.ec', nombres: 'ORLEY ANTONIO', apellidos: 'ZAMBRANO VERA',
      cedula: '1316661675', matricula: '1316661675', carrera: 'Tecnologias de la Informacion', nivel: 7, habilitado: true,
    }]);
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('acepta SI/NO sin distinguir mayúsculas ni espacios y deriva habilitado', async () => {
    const parsed = await parseStudentsXlsx(await institutionalWorkbook({
      rows: [
        [1, 'MANTA', '1316661675', 'ZAMBRANO VERA', 'ORLEY ANTONIO', 7, 'si', 'Si', null],
        [2, 'MANTA', '0951676576', 'PEREZ LOPEZ', 'ANA MARIA', '8', ' SI ', ' no '],
        [3, 'MANTA', '1315226090', 'MORA CEDEÑO', 'LUIS', 6, 'NO', 'SÍ'],
      ],
    }));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((row) => [row.cedula, row.nivel, row.habilitado])).toEqual([
      ['1316661675', 7, true],
      ['0951676576', 8, false],
      ['1315226090', 6, false],
    ]);
    expect(parsed.rows[0].carrera).toBe('Software');
  });

  it('completa con ceros la cédula numérica que perdió el cero inicial', async () => {
    const parsed = await parseStudentsXlsx(await institutionalWorkbook({
      rows: [[1, 'MANTA', 951676576, 'PEREZ LOPEZ', 'ANA MARIA', 8, 'SI', 'SI']],
    }));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ cedula: '0951676576', matricula: '0951676576', email: 'e0951676576@live.uleam.edu.ec' });
  });

  it('reporta cédula inválida, valores distintos de SI/NO y nivel fuera de rango por fila y columna', async () => {
    const parsed = await parseStudentsXlsx(await institutionalWorkbook({
      rows: [
        [1, 'MANTA', '1316661676', 'ZAMBRANO VERA', 'ORLEY ANTONIO', 7, 'SI', 'SI'],
        [2, 'MANTA', '0951676576', 'PEREZ LOPEZ', 'ANA MARIA', 0, 'TALVEZ', ''],
      ],
    }));
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fila: 7, columna: 'identificacion' }),
      expect.objectContaining({ fila: 8, columna: 'nivel' }),
      expect.objectContaining({ fila: 8, columna: 'academico' }),
      expect.objectContaining({ fila: 8, columna: 'ingles' }),
    ]));
  });

  it('detecta cédulas duplicadas', async () => {
    const parsed = await parseStudentsXlsx(await institutionalWorkbook({
      rows: [
        [1, 'MANTA', '1316661675', 'ZAMBRANO VERA', 'ORLEY ANTONIO', 7, 'SI', 'SI'],
        [2, 'MANTA', 1316661675, 'ZAMBRANO VERA', 'ORLEY ANTONIO', 7, 'SI', 'SI'],
      ],
    }));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.errors).toEqual([expect.objectContaining({ fila: 8, columna: 'identificacion', mensaje: 'Está duplicado con la fila 7.' })]);
  });

  it('rechaza el libro si falta una columna obligatoria', async () => {
    const headers = HEADERS.filter((header) => header !== 'INGLES');
    await expect(parseStudentsXlsx(await institutionalWorkbook({ headers, rows: [[1, 'MANTA', '1316661675', 'ZAMBRANO VERA', 'ORLEY ANTONIO', 7, 'SI']] })))
      .rejects.toThrow(/Faltan encabezados obligatorios.*ingles/);
  });

  it('rechaza el libro sin carrera en el título o con el marcador de la plantilla', async () => {
    const rows = [[1, 'MANTA', '1316661675', 'ZAMBRANO VERA', 'ORLEY ANTONIO', 7, 'SI', 'SI']];
    await expect(parseStudentsXlsx(await institutionalWorkbook({ career: null, rows }))).rejects.toThrow(/carrera/i);
    await expect(parseStudentsXlsx(await institutionalWorkbook({ career: 'CARRERA <NOMBRE>', rows }))).rejects.toThrow(/marcador/);
  });

  it('acepta filas ocultas por el autofiltro y omite filas vacías', async () => {
    const parsed = await parseStudentsXlsx(await institutionalWorkbook({
      rows: [
        [1, 'MANTA', '1316661675', 'ZAMBRANO VERA', 'ORLEY ANTONIO', 7, 'SI', 'NO'],
        [null, 'MANTA', null, null, null, null, null, null, 'nota suelta'],
        [3, 'MANTA', '1315226090', 'MORA CEDEÑO', 'LUIS', 6, 'SI', 'SI'],
      ],
      configure: (sheet) => { sheet.autoFilter = 'A6:H9'; sheet.getRow(9).hidden = true; },
    }));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((row) => row.fila)).toEqual([7, 9]);
  });

  it('rechaza fórmulas en las columnas importadas', async () => {
    const parsed = await parseStudentsXlsx(await institutionalWorkbook({
      rows: [[1, 'MANTA', '1316661675', 'ZAMBRANO VERA', 'ORLEY ANTONIO', { formula: '3+4', result: 7 }, 'SI', 'SI']],
    }));
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([expect.objectContaining({ fila: 7, columna: 'fila' })]);
  });

  it('la plantilla descargable se procesa al completar la carrera y una fila', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildStudentsTemplate() as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell('C7').numFmt).toBe('@');
    expect(sheet.getCell('G7').dataValidation).toMatchObject({ type: 'list', formulae: ['"SI,NO"'] });
    sheet.getCell('A2').value = 'CARRERA SOFTWARE';
    fillRow(sheet, 7, [1, 'MANTA', '1316661675', 'ZAMBRANO VERA', 'ORLEY ANTONIO', 7, 'SI', 'NO']);
    const parsed = await parseStudentsXlsx(Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toMatchObject([{ carrera: 'Software', habilitado: false }]);
  });

  it.skipIf(!existsSync(SAMPLE_PATH))('procesa el archivo institucional de muestra', async () => {
    const parsed = await parseStudentsXlsx(readFileSync(SAMPLE_PATH));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(84);
    expect(parsed.rows.filter((row) => row.habilitado)).toHaveLength(54);
    expect(new Set(parsed.rows.map((row) => row.carrera))).toEqual(new Set(['Software']));
  });
});
