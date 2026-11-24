import PizZip from 'pizzip';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fechaDdMmAaaa, renderizarPatDocx } from './render-pat-docx.js';
import type { InstantaneaPat } from './render-pat.js';

const PLANTILLA = readFileSync(fileURLToPath(new URL('./plantillas/PAT-04-F-002.docx', import.meta.url)));

/** Datos ficticios de prueba. */
function instantanea(cambios: Partial<InstantaneaPat> = {}): InstantaneaPat {
  return {
    facultad: 'Facultad de Ciencias de Prueba', extension: 'Extensión Ficticia - Matriz', carrera: 'Carrera de Prueba',
    nombres: 'Ana María', apellidos: 'Pérez Gómez', cedula: '0000000001', email: 'e0000000001@live.uleam.edu.ec',
    nivel: 6, curso: 'Sexto', titulo: 'Sistema de prueba para la gestión de titulación', modalidad: 'INDIVIDUAL',
    tutor: { nombres: 'Carlos', apellidos: 'Docente Ficticio' },
    participantes: [{ nombres: 'Ana María', apellidos: 'Pérez Gómez' }],
    personal: {
      fecha_nacimiento: '2002-05-18', paralelo: 'A', sexo: 'Femenino', nacionalidad: 'Ecuatoriana', estado_civil: 'Soltera',
      certificado_votacion: '123456', provincia: 'Manabí', canton: 'Manta', parroquia: 'Tarqui', correo_personal: 'ana@example.com',
      celular: '0990000000', telefono_convencional_no_aplica: true, tiene_discapacidad: false,
    },
    contenido: { problematica: 'Problemática de prueba.', articulaciones: ['INVESTIGACION'], modalidad_academica: 'TRABAJO_INTEGRACION_CURRICULAR' },
    capturado_en: '2026-11-20T10:00:00.000Z',
    ...cambios,
  };
}

const decodificar = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Texto de cada párrafo de `word/document.xml`, en orden de documento. */
function parrafos(docx: Buffer): string[] {
  const xml = new PizZip(docx).file('word/document.xml')!.asText();
  return [...xml.matchAll(/<w:p(?:\s[^>]*?)?(?:\/>|>[\s\S]*?<\/w:p>)/g)]
    .map((m) => decodificar([...m[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('')));
}
const indice = (lista: string[], predicado: (t: string) => boolean) => {
  const i = lista.findIndex(predicado);
  expect(i, 'párrafo esperado en la plantilla').toBeGreaterThanOrEqual(0);
  return i;
};
/** Valor escrito en la celda contigua (o párrafo siguiente) de un rótulo. */
const tras = (lista: string[], rotulo: string, salto: number) => lista[indice(lista, (t) => t.trim() === rotulo || t.endsWith(rotulo)) + salto];

describe('renderizarPatDocx', () => {
  it('produce un docx válido que conserva encabezado, logo y notas del formato institucional', () => {
    const salida = new PizZip(renderizarPatDocx(instantanea()));
    const plantilla = new PizZip(PLANTILLA);
    expect(salida.file('word/header1.xml')!.asText()).toBe(plantilla.file('word/header1.xml')!.asText());
    expect(salida.file('word/media/image1.png')!.asUint8Array()).toEqual(plantilla.file('word/media/image1.png')!.asUint8Array());
    expect(salida.file('word/styles.xml')!.asText()).toBe(plantilla.file('word/styles.xml')!.asText());
    const texto = parrafos(renderizarPatDocx(instantanea()));
    expect(texto.join('\n')).not.toMatch(/[{}]/);
    expect(texto.some((t) => t.startsWith('Nota 1: La aprobación preliminar'))).toBe(true);
    expect(texto.some((t) => t.startsWith('Nota 2: El formato será llenado'))).toBe(true);
  });

  it('escribe los datos del estudiante en las celdas «Etiqueta: valor» de la tabla 1', () => {
    const p = parrafos(renderizarPatDocx(instantanea()));
    expect(p).toEqual(expect.arrayContaining([
      'Facultad/Extensión/Sede: Facultad de Ciencias de Prueba – Extensión Ficticia - Matriz',
      'Carrera: Carrera de Prueba',
      'Nombres y apellidos del estudiante: Ana María Pérez Gómez',
      'Nivel: Sexto',
      'Paralelo: A',
      'Cédula de Ciudadanía: 0000000001',
      'Fecha de Nacimiento: 18/05/2002',
      'Edad: 24',
      'Sexo: Femenino',
      'Nacionalidad: Ecuatoriana',
      'Estado Civil: Soltera',
      'N° de Certificado de Votación: 123456',
      '1) e0000000001@live.uleam.edu.ec',
      '2) ana@example.com',
      'Teléfono Celular: 0990000000',
      'Teléfono Convencional: No aplica',
    ]));
    expect(tras(p, 'Provincia de residencia:', 1)).toBe('Manabí');
    expect(tras(p, 'Cantón de residencia:', 1)).toBe('Manta');
    expect(tras(p, 'Parroquia de residencia:', 1)).toBe('Tarqui');
    // Sin discapacidad declarada: ninguna marca.
    for (const tipo of ['Visual:', 'Física:', 'Auditiva:', 'Intelectual:', 'Psicológica:', 'Lengua:', 'Otras:']) expect(tras(p, tipo, 2)).toBe('');
  });

  it('marca las discapacidades declaradas con su grado y el detalle de «Otras»', () => {
    const p = parrafos(renderizarPatDocx(instantanea({
      personal: { tiene_discapacidad: true, discapacidades: ['FISICA', 'LENGUAJE', 'OTRA'], grado_discapacidad: '40%', otra_discapacidad: 'Detalle' },
    })));
    expect(tras(p, 'Física:', 2)).toBe('x');
    expect(tras(p, 'Física:', 5)).toBe('40%');
    expect(tras(p, 'Lengua:', 2)).toBe('x');
    expect(tras(p, 'Otras:', 2)).toBe('x (Detalle)');
    expect(tras(p, 'Visual:', 2)).toBe('');
    expect(tras(p, 'Visual:', 5)).toBe('');
  });

  it('escribe título, problemática, tutor y nombre del firmante en lugar de las instrucciones', () => {
    const p = parrafos(renderizarPatDocx(instantanea({ contenido: { problematica: 'Primera línea.\nSegunda línea.', articulaciones: ['NINGUNA'] } })));
    expect(p).toContain('Sistema de prueba para la gestión de titulación');
    expect(p).toContain('Primera línea.Segunda línea.');
    expect(tras(p, 'PROBLEMÁTICA DEL TRABAJO DE INTEGRACIÓN CURRICULAR', 1)).toBe('Primera línea.Segunda línea.');
    expect(tras(p, 'TUTOR/A SOLICITADO/A', 1)).toBe('Carlos Docente Ficticio');
    expect(tras(p, 'Nombres del estudiante que postula y presenta la propuesta:', 1)).toBe('Ana María Pérez Gómez');
    expect(p.join('\n')).not.toMatch(/Oración enunciativa|Este apartado solo se llenará|La problemática tendrá|Se específica aquí/);
    expect(p).toContain('Examen de carácter complexivo');
    expect(p).toContain('No Aplica.');
  });

  it('convierte los saltos de línea de la problemática en saltos de Word', () => {
    const xml = new PizZip(renderizarPatDocx(instantanea({ contenido: { problematica: 'Uno\nDos' } }))).file('word/document.xml')!.asText();
    expect(xml).toMatch(/Uno<\/w:t>.*<w:br\/>.*Dos/s);
  });

  it.each([
    [['INVESTIGACION'], ['x', '', '', '']],
    [['VINCULACION', 'DOCENCIA'], ['', 'x', 'x', '']],
    [['NINGUNA'], ['', '', '', 'x']],
  ])('marca con «x» la articulación %j', (articulaciones, esperado) => {
    const p = parrafos(renderizarPatDocx(instantanea({ contenido: { articulaciones } })));
    expect([
      tras(p, 'programas de Investigación:', 1), tras(p, 'programas de Vinculación:', 1), tras(p, '(Docencia):', 1), tras(p, 'Ninguna:', 1),
    ]).toEqual(esperado);
  });

  it('indica mecanismo individual sin integrantes', () => {
    const p = parrafos(renderizarPatDocx(instantanea()));
    expect(tras(p, 'MECANISMO DE DESARROLLO Y PRESENTACIÓN', 1)).toBe('Individual');
    expect(tras(p, 'MECANISMO DE DESARROLLO Y PRESENTACIÓN', 2)).toBe('');
  });

  it('indica mecanismo grupal con los nombres de los demás integrantes', () => {
    const p = parrafos(renderizarPatDocx(instantanea({
      modalidad: 'GRUPAL',
      participantes: [{ nombres: 'Luis', apellidos: 'Andrade Ficticio' }, { nombres: 'Ana María', apellidos: 'Pérez Gómez' }, { nombres: 'Rosa', apellidos: 'Zambrano Prueba' }],
    })));
    expect(tras(p, 'MECANISMO DE DESARROLLO Y PRESENTACIÓN', 1)).toBe('Grupal:');
    expect(tras(p, 'MECANISMO DE DESARROLLO Y PRESENTACIÓN', 2)).toBe('Luis Andrade Ficticio, Rosa Zambrano Prueba');
  });

  it('conserva las instrucciones oficiales de MODALIDAD si no hay una modalidad específica y la imprime si existe', () => {
    const predeterminada = parrafos(renderizarPatDocx(instantanea()));
    expect(tras(predeterminada, 'MODALIDAD', 4)).toBe('Podrá ser: ');
    expect(predeterminada).toContain('(Deberá ser una sola modalidad).');

    const especifica = parrafos(renderizarPatDocx(instantanea({ contenido: { modalidad_academica: 'Propuesta tecnológica' } })));
    expect(especifica).toContain('Propuesta tecnológica');
    expect(especifica.join('\n')).not.toMatch(/Podrá ser|Deberá ser una sola modalidad/);
    expect(especifica[especifica.indexOf('Propuesta tecnológica') - 1]).toBe('Trabajo de Integración Curricular');

    const detalle = parrafos(renderizarPatDocx(instantanea({ contenido: { modalidad_detalle: 'Aplicación profesional de prueba', modalidad_academica: 'TRABAJO_INTEGRACION_CURRICULAR' } })));
    expect(detalle).toContain('Aplicación profesional de prueba');
    expect(detalle.join('\n')).not.toMatch(/Podrá ser|Deberá ser una sola modalidad/);
  });

  it('deja vacías las celdas sin dato en una instantánea antigua o incompleta', () => {
    const p = parrafos(renderizarPatDocx({ nombres: 'Ana', apellidos: 'Prueba' }));
    expect(p).toEqual(expect.arrayContaining([
      'Facultad/Extensión/Sede: ', 'Carrera: ', 'Nivel: ', 'Curso: ', 'Cédula de Ciudadanía: ', 'Fecha de Nacimiento: ', 'Edad: ',
      'N° de Certificado de Votación: ', '1) ', '2) ', 'Teléfono Convencional: ',
    ]));
    expect(tras(p, 'Provincia de residencia:', 1)).toBe('');
    expect(tras(p, 'TUTOR/A SOLICITADO/A', 1)).toBe('');
    expect(tras(p, 'MECANISMO DE DESARROLLO Y PRESENTACIÓN', 1)).toBe('');
    expect(p.join('\n')).not.toMatch(/[{}]|undefined|null/);
  });

  it('imprime «No aplica» en correo personal y certificado cuando el estudiante lo marcó', () => {
    const p = parrafos(renderizarPatDocx(instantanea({ personal: { correo_personal_no_aplica: true, certificado_votacion_no_aplica: true } })));
    expect(p).toEqual(expect.arrayContaining(['2) No aplica', 'N° de Certificado de Votación: No aplica']));
  });
});

describe('fechaDdMmAaaa', () => {
  it.each([['2002-05-18', '18/05/2002'], ['', ''], [null, ''], ['18/05/2002', '']])('%j → %j', (entrada, esperado) => {
    expect(fechaDdMmAaaa(entrada)).toBe(esperado);
  });
});
