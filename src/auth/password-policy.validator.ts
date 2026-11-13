/** Mensaje único para toda contraseña rechazada por la política: no revela qué regla falló. */
export const MENSAJE_POLITICA_CLAVE = 'La contraseña es fácil de adivinar: no uses tus datos personales, secuencias, caracteres repetidos ni contraseñas comunes.';

/** Longitud mínima de un dato personal para rechazar contraseñas que lo contienen. */
const MIN_DATO_CONTENIDO = 4;

/** Contraseñas comunes de 12 o más caracteres (normalizadas: minúsculas, sin tildes ni símbolos). */
const CLAVES_COMUNES = new Set([
  'contrasena123', 'contrasena1234', 'contrasenasegura', 'micontrasena123', 'password1234', 'password12345',
  'password123456', 'passwordpassword', 'qwertyuiop123', 'qwerty123456', 'qwertyuiopasdf', 'asdfghjkl123',
  'iloveyou1234', 'administrador', 'administrador1', 'administrador123', 'bienvenido123', 'bienvenido2024',
  'bienvenido2025', 'bienvenido2026', 'universidad123', 'uleam12345678', 'uleammanta2026', 'estudiante123',
  'estudiante1234', 'docente123456', 'titulacion123', 'titulacion2026', 'teamo12345678', 'abc123abc123',
  'changeme12345', 'letmein123456', 'welcome123456', 'secreto123456',
]);

export interface DatosPersonalesClave {
  email: string;
  nombres?: string | null;
  apellidos?: string | null;
  /** Cédula, matrícula u otros identificadores de la cuenta. */
  identificadores?: Array<string | null | undefined>;
}

/** Minúsculas y sin tildes; `ñ` pasa a `n`. */
function normalizar(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Solo letras y dígitos, para comparar sin separadores (`juan.perez` = `juanperez`). */
function compacto(value: string): string {
  return normalizar(value).replace(/[^a-z0-9]/g, '');
}

function esCaracterRepetido(clave: string): boolean {
  return /^(.)\1*$/su.test(clave);
}

/** Secuencia monótona de paso 1 en toda la cadena (`abcdefghijkl`, `987654321`). */
function esSecuencia(clave: string): boolean {
  if (clave.length < 3) return false;
  const paso = clave.charCodeAt(1) - clave.charCodeAt(0);
  if (paso !== 1 && paso !== -1) return false;
  for (let i = 2; i < clave.length; i += 1) {
    if (clave.charCodeAt(i) - clave.charCodeAt(i - 1) !== paso) return false;
  }
  return true;
}

/** La clave es exactamente una combinación (en cualquier orden y con repeticiones) de nombres y apellidos. */
function esCombinacionDeNombres(clave: string, partes: string[]): boolean {
  if (!clave || partes.length === 0) return false;
  const alcanzable = Array.from({ length: clave.length + 1 }, () => false);
  alcanzable[0] = true;
  for (let fin = 1; fin <= clave.length; fin += 1) {
    alcanzable[fin] = partes.some((parte) => parte.length <= fin && alcanzable[fin - parte.length] === true && clave.endsWith(parte, fin));
  }
  return alcanzable[clave.length] === true;
}

/**
 * Política de contraseñas nuevas (diseño S1, §4). La longitud (12–128) la valida el DTO; aquí
 * se rechazan las contraseñas adivinables a partir de los datos de la cuenta. Devuelve `true`
 * si la contraseña es aceptable.
 */
export function cumplePoliticaClave(password: string, datos: DatosPersonalesClave): boolean {
  const clave = normalizar(password);
  const claveCompacta = compacto(password);
  if (esCaracterRepetido(clave) || esSecuencia(clave) || esSecuencia(claveCompacta)) return false;
  if (CLAVES_COMUNES.has(claveCompacta)) return false;

  const local = compacto(datos.email.split('@', 1)[0] ?? '');
  const identificadores = (datos.identificadores ?? []).filter((item): item is string => typeof item === 'string').map(compacto);
  for (const dato of [local, ...identificadores]) {
    if (!dato) continue;
    if (claveCompacta === dato) return false;
    if (dato.length >= MIN_DATO_CONTENIDO && claveCompacta.includes(dato)) return false;
  }

  const partes = [datos.nombres, datos.apellidos]
    .filter((item): item is string => typeof item === 'string')
    .flatMap((item) => normalizar(item).split(/\s+/))
    .map(compacto)
    .filter(Boolean);
  return !esCombinacionDeNombres(claveCompacta, partes);
}
