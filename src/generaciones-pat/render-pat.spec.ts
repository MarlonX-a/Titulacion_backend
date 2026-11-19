import PDFDocument from 'pdfkit';
import { calcularEdad, renderizarPat, type InstantaneaPat } from './render-pat.js';

const instantanea: InstantaneaPat = {
  periodo_nombre: 'Período de prueba', periodo_codigo: 'PAT-TEST', extension: 'Extensión Manta', curso: 'Sexto', modalidad: 'GRUPAL',
  linea_investigacion: { nombre: 'Software' }, facultad: 'Facultad de Ciencias', carrera: 'Sistemas', nombres: 'José', apellidos: 'Peña',
  cedula: '0000000000', matricula: '0000000000', email: 'estudiante@live.uleam.edu.ec', titulo: 'Sistema de prueba', nivel: 6,
  capturado_en: '2026-11-19T12:00:00.000Z',
  personal: {
    fecha_nacimiento: '2002-05-18', paralelo: 'A', sexo: 'Femenino', nacionalidad: 'Ecuatoriana', estado_civil: 'Soltera', provincia: 'Manabí',
    canton: 'Manta', parroquia: 'Manta', correo_personal_no_aplica: true, telefono_convencional_no_aplica: true, certificado_votacion_no_aplica: true,
    celular: '0990000000', tiene_discapacidad: false,
  },
  contenido: {
    modalidad_academica: 'TRABAJO_INTEGRACION_CURRICULAR',
    problematica: 'Descripción de la problemática con acentos: investigación, vinculación y docencia. '.repeat(180),
    articulaciones: ['INVESTIGACION'],
  },
  participantes: [{ nombres: 'José', apellidos: 'Peña' }, { nombres: 'María', apellidos: 'Zambrano' }],
  tutor: { nombres: 'Ana', apellidos: 'Docente' },
};

describe('renderizarPat', () => {
  afterEach(() => vi.restoreAllMocks());

  it('genera un PDF de varias páginas con firma vacía', async () => {
    const buffer = await renderizarPat(instantanea);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1500);
    expect((buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });

  it('escribe secciones, datos e integrantes en el orden del formato', async () => {
    const textos: string[] = [];
    const original = PDFDocument.prototype.text;
    vi.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: PDFKit.PDFDocument, ...args: Parameters<typeof original>) {
      textos.push(String(args[0]));
      return original.apply(this, args);
    });
    await renderizarPat(instantanea);
    const totalPaginas = textos.filter((valor) => valor.startsWith('PAT · ')).length;
    expect(totalPaginas).toBeGreaterThan(1);

    const esperados = [
      'UNIVERSIDAD LAICA ELOY ALFARO DE MANABÍ',
      'PLAN DE TRABAJO DE TITULACIÓN',
      'Formulario individual · Documento generado sin firma',
      '1. INFORMACIÓN ACADÉMICA',
      'Período: Período de prueba (PAT-TEST)',
      'Facultad: Facultad de Ciencias    Carrera: Sistemas',
      'Estudiante: Peña José    Cédula: 0000000000',
      'Matrícula: 0000000000    Nivel: 6    Curso: Sexto    Paralelo: A',
      'Correo institucional: estudiante@live.uleam.edu.ec    Correo personal: No aplica',
      'Tema: Sistema de prueba',
      'Línea de investigación: Software',
      'Modalidad: Grupal',
      'Tutor: Ana Docente',
      'Integrantes del trabajo: José Peña; María Zambrano',
      '2. DATOS PERSONALES',
      'Fecha de nacimiento: 2002-05-18    Edad: 24 años    Sexo: Femenino',
      'Nacionalidad: Ecuatoriana    Estado civil: Soltera',
      'Residencia: Manabí / Manta / Manta',
      'Certificado de votación: No aplica    Celular: 0990000000    Convencional: No aplica',
      'Discapacidad declarada: No    Grado: ',
      '3. PLAN DE TRABAJO',
      'Modalidad académica: TRABAJO_INTEGRACION_CURRICULAR',
      'Título provisional: Sistema de prueba',
      'Problemática:',
      'Articulación: INVESTIGACION',
      'Tipo de trabajo: Trabajo de Integración Curricular.',
      'Firma del estudiante',
      'Generado electrónicamente a partir de la información institucional y la registrada por el estudiante.',
      'Extensión / sede: Extensión Manta',
      `PAT · 1 / ${totalPaginas}`,
      'PLAN DE TRABAJO DE TITULACIÓN · CONTINUACIÓN',
      `PAT · ${totalPaginas} / ${totalPaginas}`,
    ];
    const posiciones = esperados.map((esperado) => textos.indexOf(esperado));
    expect(esperados.filter((_, i) => posiciones[i] === -1)).toEqual([]);
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
  });

  it('tolera una instantánea histórica vacía', async () => {
    const buffer = await renderizarPat({});
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('calcularEdad', () => {
  it('resta un año si todavía no llega el cumpleaños en la fecha de referencia', () => {
    expect(calcularEdad('2002-05-18', new Date('2026-05-17T12:00:00'))).toBe(23);
    expect(calcularEdad('2002-05-18', new Date('2026-05-18T12:00:00'))).toBe(24);
    expect(calcularEdad('2002-05-18', new Date('2026-11-19T12:00:00'))).toBe(24);
  });
});
