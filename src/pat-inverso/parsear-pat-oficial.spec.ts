import { BadRequestException } from '@nestjs/common';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { parrafosDocxOficial } from './docx-seguro.js';
import { parsearPatOficial } from './parsear-pat-oficial.js';
import { vistaPatInverso, type SistemaPatInverso } from './vista-pat-inverso.js';

/** Párrafos en el orden del formato oficial, con datos ficticios. */
function lleno(variacion: (parrafos: string[]) => void = () => undefined): string[] {
  const parrafos = [
    'DATOS INFORMATIVOS DEL ESTUDIANTE',
    'Facultad/Extensión/Sede: Facultad de Prueba – Manta',
    'Carrera: Ingeniería de Prueba',
    'Nombres y apellidos del estudiante: Ana María Pérez Gómez',
    'Nivel: Sexto', 'Curso:', 'Paralelo: A',
    'Cédula de Ciudadanía: 0102030405',
    'Fecha de Nacimiento: 18/05/2002',
    'Edad: 24', 'Sexo: Femenino', 'Nacionalidad: Ecuatoriana',
    'Estado Civil: Soltera', 'N° de Certificado de Votación: 111222',
    'Provincia de residencia:', 'Manabí',
    'Cantón de residencia:', 'Manta',
    'Parroquia de residencia:', 'Tarqui',
    'Correos Electrónicos:', '1) ana.perez@live.uleam.edu.ec', '2) ana.perez@example.com',
    'Teléfono Celular: 0990000000', 'Teléfono Convencional: No aplica',
    'Discapacidad', 'Visual:', 'Grado de Discapacidad:', 'Física:', 'Grado de Discapacidad:',
    'Auditiva:', 'Grado de Discapacidad:', 'Intelectual:', 'Grado de Discapacidad:',
    'Psicológica:', 'Grado de Discapacidad:', 'Lengua:', 'Grado de Discapacidad:', 'Otras:', 'Grado de Discapacidad:',
    'No.', 'OPCIÓN DE APROBACIÓN PREVIO A TITULACIÓN', 'MODALIDAD', 'TÍTULO PROVISIONAL DEL TEMA PROPUESTO O NÚCLEO PROBLÉMICO',
    '1', 'Trabajo de Integración Curricular', 'Aplicación profesional de prueba', 'Plataforma ficticia de seguimiento académico',
    '2', 'Examen de carácter complexivo', 'No Aplica.',
    'PROBLEMÁTICA DEL TRABAJO DE INTEGRACIÓN CURRICULAR',
    'La asignación manual de temas de prueba retrasa el inicio del proceso.',
    'ARTICULACIÓN DEL TRABAJO DE INTEGRACIÓN CURRICULAR CON FUNCIONES SUSTANTIVAS',
    'Trabajo de Integración Curricular se articula con proyectos y programas de Investigación:',
    'Trabajo de Integración Curricular se articula con proyectos y programas de Vinculación:',
    'Trabajo de Integración Curricular se articula con proyectos de asignaturas (Docencia):',
    'Ninguna:', 'x',
    'MECANISMO DE DESARROLLO Y PRESENTACIÓN',
    'Grupal:', 'Luis Andrade Ficticio',
    'TUTOR/A SOLICITADO/A', 'Ing. Sandra Jackeline Soledispa Pereira, Mg',
    'FIRMA DE RESPONSABILIDAD',
    'Nombres del estudiante que postula y presenta la propuesta:', 'Ana María Pérez Gómez',
    'Firma:', '---------------------------------------------',
  ];
  variacion(parrafos);
  return parrafos;
}

const sistema = (): SistemaPatInverso => ({
  cedula: '0102030405', nombres: 'Ana María', apellidos: 'Pérez Gómez', carrera: 'Ingeniería de Prueba',
  titulo_tema: 'Plataforma ficticia de seguimiento académico', correo_institucional: 'ana.perez@live.uleam.edu.ec',
  modalidad: 'GRUPAL', estudiante_id: 'e1',
  integrantes: [{ id: 'e1', nombres: 'Ana María', apellidos: 'Pérez Gómez' }, { id: 'e2', nombres: 'Luis', apellidos: 'Andrade Ficticio' }],
  candidatos: [{ id: 'c1', nombres: 'Sandra Jackeline', apellidos: 'Soledispa Pereira' }, { id: 'c2', nombres: 'Luis', apellidos: 'Mendoza Prueba' }],
});

describe('parsearPatOficial', () => {
  it('rechaza la plantilla vacía porque no trae los datos llenados', () => {
    const vacia = lleno((parrafos) => {
      for (let i = 0; i < parrafos.length; i += 1) {
        if (parrafos[i]?.includes(':')) parrafos[i] = parrafos[i]!.split(':')[0] + ':';
      }
      parrafos.splice(parrafos.indexOf('Manabí'), 1);
      parrafos.splice(parrafos.indexOf('Manta'), 1);
      parrafos.splice(parrafos.indexOf('Tarqui'), 1);
      parrafos.splice(parrafos.indexOf('La asignación manual de temas de prueba retrasa el inicio del proceso.'), 1);
      parrafos.splice(parrafos.indexOf('Aplicación profesional de prueba'), 1);
      parrafos.splice(parrafos.indexOf('Plataforma ficticia de seguimiento académico'), 1);
    });
    expect(() => parsearPatOficial(vacia)).toThrow(BadRequestException);
    expect(() => parsearPatOficial(vacia)).toThrow(/no tiene los datos llenados/);
  });

  it('lee el formato oficial llenado con datos ficticios', () => {
    const extraido = parsearPatOficial(lleno());
    expect(extraido).toMatchObject({
      cedula: '0102030405', fecha_nacimiento: '18/05/2002', paralelo: 'A', sexo: 'Femenino',
      provincia: 'Manabí', canton: 'Manta', parroquia: 'Tarqui',
      correo_institucional: 'ana.perez@live.uleam.edu.ec', correo_personal: 'ana.perez@example.com',
      modalidad_detalle: 'Aplicación profesional de prueba',
      titulo_provisional: 'Plataforma ficticia de seguimiento académico',
      mecanismo: 'GRUPAL', nombres_grupales: 'Luis Andrade Ficticio',
      tutor_solicitado: 'Ing. Sandra Jackeline Soledispa Pereira, Mg',
      firmante: 'Ana María Pérez Gómez',
    });
    expect(extraido.articulaciones).toEqual({ investigacion: false, vinculacion: false, docencia: false, ninguna: true });
    expect(extraido.discapacidades.every((item) => !item.marcada)).toBe(true);
  });

  it('acepta variaciones de etiqueta sin acento y con la cédula en la misma línea', () => {
    const parrafos = lleno();
    parrafos[parrafos.indexOf('Cédula de Ciudadanía: 0102030405')] = 'Cedula de Ciudadania: 0102030405';
    parrafos[parrafos.indexOf('Fecha de Nacimiento: 18/05/2002')] = 'Fecha de nacimiento : 18/05/2002';
    expect(parsearPatOficial(parrafos)).toMatchObject({ cedula: '0102030405', fecha_nacimiento: '18/05/2002' });
  });

  it('rechaza un documento ajeno que no es el PAT-04-F-002', () => {
    expect(() => parsearPatOficial(['Contrato de arrendamiento', 'Arrendatario: Ana Pérez', 'Canon: 100'])).toThrow(/PAT-04-F-002/);
  });

  it('la vista previa conserva los datos del sistema cuando el Word difiere y reconoce al tutor candidato', () => {
    const vista = vistaPatInverso(parsearPatOficial(lleno((parrafos) => {
      parrafos[parrafos.indexOf('Carrera: Ingeniería de Prueba')] = 'Carrera: Software';
    })), sistema());
    expect(vista.diferencias).toContainEqual({ campo: 'carrera', word: 'Software', sistema: 'Ingeniería de Prueba' });
    expect(vista.errores).toEqual([]);
    expect(vista.tutor).toMatchObject({ candidato_id: 'c1', confianza: 'alta' });
    expect(vista.datos).toMatchObject({ fecha_nacimiento: '2002-05-18', tiene_discapacidad: false, telefono_convencional_no_aplica: true });
    expect(vista.contenido).toMatchObject({ modalidad_detalle: 'Aplicación profesional de prueba', articulaciones: ['NINGUNA'], confirma_problematica: true });
  });
});

describe('parrafosDocxOficial', () => {
  const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const docx = (cuerpo: string, extra: Array<[string, string]> = []) => {
    const zip = new PizZip();
    zip.file('[Content_Types].xml', '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<Relationships/>');
    zip.file('word/document.xml', `<w:document xmlns:w="urn:word"><w:body>${cuerpo}</w:body></w:document>`);
    for (const [nombre, contenido] of extra) zip.file(nombre, contenido);
    return zip.generate({ type: 'nodebuffer' }) as Buffer;
  };

  it('lee los párrafos del document.xml y rechaza un docx manipulado o con macros', () => {
    const parrafos = parrafosDocxOficial(docx(lleno().map((texto) => `<w:p><w:r><w:t>${texto}</w:t></w:r></w:p>`).join('')), mime);
    expect(parsearPatOficial(parrafos).cedula).toBe('0102030405');
    expect(() => parrafosDocxOficial(Buffer.from('esto no es un zip'), mime)).toThrow(/no es un documento Word/);
    expect(() => parrafosDocxOficial(docx('<w:p><w:t>Contrato</w:t></w:p>', [['word/vbaProject.bin', 'macro']]), mime)).toThrow(/macros/);
  });
});
