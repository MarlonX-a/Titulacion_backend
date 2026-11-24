import { BadRequestException } from '@nestjs/common';

export interface DiscapacidadPatOficial {
  tipo: 'VISUAL' | 'FISICA' | 'AUDITIVA' | 'INTELECTUAL' | 'PSICOLOGICA' | 'LENGUAJE' | 'OTRA';
  marcada: boolean;
  grado: string;
  /** Texto junto a «Otras:», distinto del grado. */
  detalle: string;
}

/** Campos leídos del Word institucional PAT-04-F-002 (el que llena el estudiante, no la plantilla etiquetada). */
export interface PatOficialExtraido {
  facultad_extension: string;
  carrera: string;
  nombres_apellidos: string;
  nivel: string;
  curso: string;
  paralelo: string;
  cedula: string;
  fecha_nacimiento: string;
  edad: string;
  sexo: string;
  nacionalidad: string;
  estado_civil: string;
  certificado_votacion: string;
  provincia: string;
  canton: string;
  parroquia: string;
  correo_institucional: string;
  correo_personal: string;
  celular: string;
  telefono_convencional: string;
  discapacidades: DiscapacidadPatOficial[];
  modalidad_detalle: string;
  titulo_provisional: string;
  problematica: string;
  articulaciones: { investigacion: boolean; vinculacion: boolean; docencia: boolean; ninguna: boolean };
  mecanismo: 'INDIVIDUAL' | 'GRUPAL' | '';
  nombres_grupales: string;
  tutor_solicitado: string;
  firmante: string;
}

const ENCABEZADOS = [
  'datos informativos del estudiante',
  'problematica del trabajo de integracion curricular',
  'articulacion del trabajo de integracion curricular con funciones sustantivas',
  'mecanismo de desarrollo y presentacion',
  'tutor/a solicitado/a',
  'firma de responsabilidad',
] as const;

const DISCAPACIDADES: Array<{ etiqueta: string; tipo: DiscapacidadPatOficial['tipo'] }> = [
  { etiqueta: 'visual', tipo: 'VISUAL' },
  { etiqueta: 'fisica', tipo: 'FISICA' },
  { etiqueta: 'auditiva', tipo: 'AUDITIVA' },
  { etiqueta: 'intelectual', tipo: 'INTELECTUAL' },
  { etiqueta: 'psicologica', tipo: 'PSICOLOGICA' },
  { etiqueta: 'lengua', tipo: 'LENGUAJE' },
  { etiqueta: 'otras', tipo: 'OTRA' },
];

/** Localiza celdas por el texto de su etiqueta y exige que el documento sea el formato oficial. */
export function parsearPatOficial(parrafos: string[]): PatOficialExtraido {
  const textos = parrafos.map((parrafo) => parrafo.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const normalizados = textos.map(normalizar);
  for (const encabezado of ENCABEZADOS) {
    if (!normalizados.some((texto) => texto === encabezado || texto.startsWith(`${encabezado}:`))) {
      throw new BadRequestException('El documento no tiene la estructura del formato PAT-04-F-002.');
    }
  }
  const extraido = vacio();
  let discapacidadActual: DiscapacidadPatOficial | null = null;
  for (let i = 0; i < textos.length; i += 1) {
    const normal = normalizados[i] ?? '';
    if (normal === 'trabajo de integracion curricular' && !extraido.modalidad_detalle && !extraido.titulo_provisional) {
      extraido.modalidad_detalle = textos[i + 1] ?? '';
      extraido.titulo_provisional = textos[i + 2] ?? '';
      continue;
    }
    if (normal === 'mecanismo de desarrollo y presentacion') {
      const mecanismo = leerMecanismo(textos, normalizados, i + 1);
      extraido.mecanismo = mecanismo.mecanismo;
      extraido.nombres_grupales = mecanismo.nombres;
      continue;
    }
    if (normal === 'tutor/a solicitado/a') {
      extraido.tutor_solicitado = tomarHasta(textos, normalizados, i + 1, new Set(['firma de responsabilidad']));
      continue;
    }
    if (normal === 'problematica del trabajo de integracion curricular') {
      extraido.problematica = tomarHasta(textos, normalizados, i + 1, new Set(['articulacion del trabajo de integracion curricular con funciones sustantivas']));
      continue;
    }
    if (normal.startsWith('nombres del estudiante que postula')) {
      const siguiente = normalizados[i + 1] ?? '';
      extraido.firmante = resto(textos[i] ?? '') || (siguiente.startsWith('firma') || siguiente.startsWith('nota ') ? '' : (textos[i + 1] ?? ''));
      continue;
    }
    const discapacidad = DISCAPACIDADES.find((item) => normal === item.etiqueta || normal.startsWith(`${item.etiqueta}:`));
    if (discapacidad) {
      const detalle = resto(textos[i] ?? '');
      const siguiente = textos[i + 1] ?? '';
      discapacidadActual = { tipo: discapacidad.tipo, marcada: esMarca(detalle) || esMarca(siguiente), grado: '', detalle: esMarca(detalle) ? '' : detalle };
      extraido.discapacidades.push(discapacidadActual);
      continue;
    }
    if (normal.startsWith('grado de discapacidad') && discapacidadActual) {
      discapacidadActual.grado = resto(textos[i] ?? '') || (esMarca(textos[i + 1] ?? '') ? '' : textoSiNoEsEtiqueta(textos[i + 1] ?? '', normalizados[i + 1] ?? ''));
      if (esMarca(textos[i + 1] ?? '') && !discapacidadActual.marcada) discapacidadActual.marcada = true;
      continue;
    }
    const campo = campoDe(normal);
    if (!campo) {
      marcarArticulacion(extraido, normalizados[i - 1] ?? '', textos[i] ?? '');
      continue;
    }
    const valor = resto(textos[i] ?? '') || textoSiNoEsEtiqueta(textos[i + 1] ?? '', normalizados[i + 1] ?? '');
    asignar(extraido, campo, valor);
    if (campo.startsWith('articulacion_') && esMarca(valor)) marcarPorCampo(extraido, campo);
    if (campo.startsWith('articulacion_') && esMarca(textos[i + 1] ?? '')) marcarPorCampo(extraido, campo);
  }
  completarCorreos(extraido, textos);
  if (!extraido.cedula || !extraido.nombres_apellidos || !extraido.titulo_provisional || !extraido.problematica) {
    throw new BadRequestException('El formato PAT-04-F-002 no tiene los datos llenados (cédula, estudiante, título o problemática).');
  }
  return extraido;
}

export function normalizar(valor: string): string {
  return valor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[°º]/g, '').replace(/\s+/g, ' ').trim();
}

function vacio(): PatOficialExtraido {
  return {
    facultad_extension: '', carrera: '', nombres_apellidos: '', nivel: '', curso: '', paralelo: '', cedula: '',
    fecha_nacimiento: '', edad: '', sexo: '', nacionalidad: '', estado_civil: '', certificado_votacion: '',
    provincia: '', canton: '', parroquia: '', correo_institucional: '', correo_personal: '', celular: '',
    telefono_convencional: '', discapacidades: [], modalidad_detalle: '', titulo_provisional: '', problematica: '',
    articulaciones: { investigacion: false, vinculacion: false, docencia: false, ninguna: false },
    mecanismo: '', nombres_grupales: '', tutor_solicitado: '', firmante: '',
  };
}

function campoDe(normal: string): string | null {
  const etiquetas: Array<[string, string]> = [
    ['facultad/extension/sede', 'facultad_extension'],
    ['facultad/extension', 'facultad_extension'],
    ['nombres y apellidos del estudiante', 'nombres_apellidos'],
    ['n de certificado de votacion', 'certificado_votacion'],
    ['no. de certificado de votacion', 'certificado_votacion'],
    ['no de certificado de votacion', 'certificado_votacion'],
    ['certificado de votacion', 'certificado_votacion'],
    ['fecha de nacimiento', 'fecha_nacimiento'],
    ['cedula de ciudadania', 'cedula'],
    ['estado civil', 'estado_civil'],
    ['provincia de residencia', 'provincia'],
    ['canton de residencia', 'canton'],
    ['parroquia de residencia', 'parroquia'],
    ['telefono celular', 'celular'],
    ['telefono convencional', 'telefono_convencional'],
    ['correos electronicos', 'correos'],
    ['se articula con proyectos y programas de investigacion', 'articulacion_investigacion'],
    ['se articula con proyectos y programas de vinculacion', 'articulacion_vinculacion'],
    ['se articula con proyectos de asignaturas', 'articulacion_docencia'],
    ['ninguna', 'articulacion_ninguna'],
    ['paralelo', 'paralelo'],
    ['nacionalidad', 'nacionalidad'],
    ['carrera', 'carrera'],
    ['nivel', 'nivel'],
    ['curso', 'curso'],
    ['edad', 'edad'],
    ['sexo', 'sexo'],
  ];
  const limpio = normal.replace(/\./g, '');
  if (limpio.includes('programas de investigacion')) return 'articulacion_investigacion';
  if (limpio.includes('programas de vinculacion')) return 'articulacion_vinculacion';
  if (limpio.includes('proyectos de asignaturas')) return 'articulacion_docencia';
  return etiquetas.find(([etiqueta]) => limpio === etiqueta || limpio.startsWith(`${etiqueta}:`) || limpio.startsWith(`${etiqueta} `))?.[1] ?? null;
}

function asignar(extraido: PatOficialExtraido, campo: string, valor: string): void {
  if (campo === 'correos' || campo.startsWith('articulacion_')) return;
  const destino = extraido as unknown as Record<string, string>;
  if (campo in destino && !destino[campo]) destino[campo] = valor.trim();
}

function resto(parrafo: string): string {
  const corte = parrafo.indexOf(':');
  return corte < 0 ? '' : parrafo.slice(corte + 1).trim();
}

function esMarca(valor: string): boolean {
  return normalizar(valor) === 'x';
}

function textoSiNoEsEtiqueta(texto: string, normal: string): string {
  if (!texto || campoDe(normal) || ENCABEZADOS.some((encabezado) => normal === encabezado) || DISCAPACIDADES.some((item) => normal === item.etiqueta || normal.startsWith(`${item.etiqueta}:`))) return '';
  if (/^(grupal|individual)\b/.test(normal) || normal === 'firma' || normal.startsWith('nota ')) return '';
  return texto.trim();
}

function tomarHasta(textos: string[], normalizados: string[], desde: number, paradas: Set<string>): string {
  const partes: string[] = [];
  for (let i = desde; i < textos.length; i += 1) {
    const normal = normalizados[i] ?? '';
    if (paradas.has(normal) || ENCABEZADOS.some((encabezado) => normal === encabezado)) break;
    if (campoDe(normal) || normal.startsWith('nota ')) break;
    partes.push(textos[i] ?? '');
  }
  return partes.join('\n').trim();
}

function leerMecanismo(textos: string[], normalizados: string[], desde: number): { mecanismo: 'INDIVIDUAL' | 'GRUPAL' | ''; nombres: string } {
  for (let i = desde; i < textos.length; i += 1) {
    const normal = normalizados[i] ?? '';
    if (normal === 'tutor/a solicitado/a' || normal === 'firma de responsabilidad') break;
    if (normal === 'individual' || normal.startsWith('individual:')) return { mecanismo: 'INDIVIDUAL', nombres: resto(textos[i] ?? '') };
    if (normal === 'grupal' || normal.startsWith('grupal:')) {
      const enLaMisma = resto(textos[i] ?? '');
      const siguientes = tomarHasta(textos, normalizados, i + 1, new Set(['tutor/a solicitado/a', 'firma de responsabilidad']));
      return { mecanismo: 'GRUPAL', nombres: [enLaMisma, siguientes].filter(Boolean).join('\n') };
    }
  }
  return { mecanismo: '', nombres: '' };
}

function marcarArticulacion(extraido: PatOficialExtraido, etiquetaAnterior: string, marca: string): void {
  if (!esMarca(marca)) return;
  const campo = campoDe(etiquetaAnterior);
  if (campo) marcarPorCampo(extraido, campo);
}

function marcarPorCampo(extraido: PatOficialExtraido, campo: string): void {
  if (campo === 'articulacion_investigacion') extraido.articulaciones.investigacion = true;
  if (campo === 'articulacion_vinculacion') extraido.articulaciones.vinculacion = true;
  if (campo === 'articulacion_docencia') extraido.articulaciones.docencia = true;
  if (campo === 'articulacion_ninguna') extraido.articulaciones.ninguna = true;
}

function completarCorreos(extraido: PatOficialExtraido, textos: string[]): void {
  const correos = textos.map((texto) => /^\d+\)\s*(.*)$/.exec(texto)?.[1]?.trim() ?? '').filter(Boolean);
  if (!extraido.correo_institucional && correos[0]) extraido.correo_institucional = correos[0];
  if (!extraido.correo_personal && correos[1]) extraido.correo_personal = correos[1];
}
