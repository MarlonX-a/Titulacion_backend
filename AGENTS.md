# AGENTS.md

Esta guía es la referencia de trabajo para personas y agentes que contribuyan al
backend. Léela antes de cambiar código y actualízala cuando cambien las decisiones
del proyecto o sus pasos operativos.

## Guía rápida para continuar el trabajo

### Ubicación del proyecto

La raíz del repositorio es la carpeta que contiene `.git`, `package.json`, `src/`
y este archivo. El proyecto ya no está dentro de una subcarpeta
`titulacion-backend`; ejecuta los comandos desde la raíz actual. El Compose de
desarrollo se llama `docker-compose.yml`.

### Comandos habituales

```powershell
npm ci
```

En una terminal, inicia las dependencias y deja visibles sus logs:

```powershell
docker compose up
```

En otra terminal, inicia NestJS:

```powershell
npm run start:dev
```

Para dejar Docker ejecutándose en segundo plano, usa `docker compose up -d`;
puedes seguir los logs con `docker compose logs -f` y detener los contenedores con
`docker compose down`. Este último comando conserva los volúmenes.

En otra terminal, las comprobaciones disponibles son:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

No ejecutes migraciones contra `public` ni `local_demo`. Para desarrollo, el
esquema aprobado es `titulacion_dev`; antes de `npm run migration:run`, confirma
el valor efectivo de `DB_SCHEMA` y revisa `npm run migration:show`. Los
verificadores `db:verify-*` deben usar esquemas temporales y limpiarlos al
terminar. Nunca muestres ni copies secretos de `.env` en la salida o en la guía;
usa `.env.example` como referencia.

### Estado del backend

El código contiene módulos para autenticación y usuarios, períodos, perfiles y
habilitaciones, líneas y temas, grupos e invitaciones, postulaciones, conflictos,
asignaciones de tema y tutor, carga tutorial, PAT, notificaciones, importaciones,
reportes y exportaciones. La presencia de un módulo no demuestra por sí sola que
todos sus requisitos tengan pruebas suficientes: revisa el caso de uso, DTO,
autorización, migración y pruebas que correspondan antes de ampliarlo.

GitHub Actions ejecuta lint, TypeScript estricto, pruebas unitarias y HTTP,
compilación y una verificación de migraciones de exportaciones en PostgreSQL.
SonarCloud está configurado con Automatic Analysis; comprueba el Quality Gate en
SonarCloud después de integrar cambios en la rama analizada. No añadas el token
de Sonar al workflow sin cambiar primero esa configuración.

### Pendientes conocidos y orden sugerido

1. **Archivo de períodos y revisión final de cobertura funcional.** Es el
   siguiente alcance funcional acordado. Antes de definir transiciones, permisos
   o efectos del archivo, contrasta los requisitos, el DER y el código; conserva
   el historial y no inventes reglas que los documentos no indiquen.
2. **Cerrar brechas de verificación.** Revisar las pruebas de concurrencia,
   restricciones PostgreSQL, reversión protegida y atomicidad de auditoría de
   todos los módulos críticos. El CI actual ejecuta automáticamente solo el
   verificador de exportaciones; ampliar el workflow de forma deliberada.
3. **Revisar los comandos `db:verify-*`.** Algunos nombres reutilizan archivos de
   verificación de dominios relacionados. Confirma que cada comando cubra las
   restricciones que anuncia, en particular perfiles, tutores propuestos y
   revisiones PAT, antes de depender de su nombre como evidencia.
4. **Importación Excel institucional (implementada).** Se usa la primera hoja
   del libro; la fila de encabezados se detecta en las primeras 20 filas por la
   celda `Identificación` y se exigen `Identificación`, `Apellidos`, `Nombres`,
   `nivel`, `ACADEMICO` e `INGLES` (sin importar mayúsculas ni tildes); las
   demás columnas se ignoran. La carrera se toma del título (`CARRERA
   SOFTWARE`). El correo es `e{cedula}@live.uleam.edu.ec`, la matrícula es la
   cédula y la clave temporal inicial es la cédula, con cambio obligatorio en
   el primer acceso. SI/SI en ACADEMICO/INGLES crea la habilitación
   `HABILITADO`/`ADMITIDO`; cualquier otra combinación válida crea
   `SUSPENDIDO`/`NO_ADMITIDO` (ambas REGULAR, resueltas por el ADMIN que
   importó). Se admiten filas ocultas por autofiltro. La importación sigue
   permitida solo en períodos BORRADOR. Pendiente: confirmar con la
   institución si la cédula como clave inicial es aceptable en producción.
5. **Preparar el despliegue real.** La salida SMTP institucional autorizada,
   secretos de producción, almacenamiento, Redis, PostgreSQL, copias de
   seguridad y operación del entorno deben configurarse con sus responsables;
   no sustituirlos por credenciales inventadas.
6. **Frontend.** La interfaz de inicio de sesión y carga de Excel no forma parte
   de este repositorio backend; coordinarla como trabajo separado.
7. Revisar la matriz de cobertura funcional y no funcional en
   [`docs/cobertura-backend.md`](docs/cobertura-backend.md) antes de elegir una
   brecha nueva; actualizar su estado cuando se agregue evidencia.

La lista es una guía, no una afirmación de que los puntos posteriores estén
terminados o bloqueados. Verifica el estado actual del código, CI y servicios
antes de marcar trabajo como completado.

## 1. Contexto del proyecto

Este repositorio contiene el backend del:

**Sistema de Gestión del Proceso de Titulación**

El sistema gestiona el proceso de titulación universitario, incluyendo:

- períodos de titulación;
- estudiantes habilitados;
- estudiantes regulares y condicionados;
- docentes;
- líneas de investigación;
- temas de titulación;
- grupos de estudiantes;
- invitaciones a grupos;
- postulaciones individuales y grupales;
- propuesta de tutores;
- resolución de conflictos;
- asignación de temas;
- asignación de tutores;
- control de carga tutorial;
- plantillas PAT;
- carga y versionado del PAT;
- revisión del PAT;
- notificaciones;
- reportes y exportaciones;
- importaciones;
- auditoría.

Los actores principales son:

- ESTUDIANTE
- DOCENTE
- ADMIN

ADMIN es un rol de usuario, no una entidad independiente.

---

# 2. Stack tecnológico

Backend:

- Node.js
- TypeScript
- NestJS
- API REST
- OpenAPI / Swagger
- PostgreSQL
- ORM definido por el proyecto
- JWT
- autenticación propia por correo y contraseña, con JWT RS256
- renovación segura de sesiones
- Microsoft/OIDC institucional no está disponible para este proyecto
- BullMQ
- Redis
- almacenamiento S3 compatible / SeaweedFS local
- Docker

No introducir nuevas tecnologías principales sin una razón técnica clara y sin respetar las decisiones existentes del proyecto.

---

# 3. Arquitectura

El backend se implementa como un:

**MONOLITO MODULAR**

NO convertir el proyecto en microservicios.

Todos los módulos se ejecutan dentro de una misma aplicación NestJS y comparten la infraestructura del backend, manteniendo separación lógica entre dominios.

Cada módulo debe tener responsabilidades claras.

Ejemplo conceptual:

src/
├── main.ts
├── app.module.ts
│
├── common/
│   ├── decorators/
│   ├── guards/
│   ├── interceptors/
│   ├── filters/
│   ├── pipes/
│   ├── exceptions/
│   ├── constants/
│   └── utils/
│
├── config/
│
├── database/
│
├── auth/
├── usuarios/
├── estudiantes/
├── docentes/
├── periodos/
├── habilitados/
├── lineas-investigacion/
├── temas/
├── grupos/
├── invitaciones/
├── postulaciones/
├── tutores-propuestos/
├── conflictos/
├── asignaciones-tema/
├── asignaciones-tutor/
├── carga-tutorial/
├── plantillas-pat/
├── documentos-pat/
├── revisiones-pat/
├── notificaciones/
├── importaciones/
├── exportaciones/
└── auditoria/

La estructura exacta puede evolucionar si existe una razón técnica, pero debe mantenerse el principio de monolito modular.

---

# 4. Organización interna de módulos

Mantener cada dominio autocontenido.

Ejemplo:

src/temas/
├── temas.module.ts
├── temas.controller.ts
├── temas.service.ts
├── dto/
│   ├── create-tema.dto.ts
│   ├── update-tema.dto.ts
│   └── query-tema.dto.ts
├── entities/
│   └── tema.entity.ts
└── enums/

No crear archivos gigantes.

No colocar toda la lógica del sistema en un único service.

No acceder directamente a responsabilidades internas de otro módulo cuando exista una API de servicio adecuada.

Evitar dependencias circulares.

---

# 5. Fuente de verdad funcional

Antes de implementar una funcionalidad, revisar:

1. requisitos funcionales;
2. reglas de negocio;
3. DER corregido;
4. diagrama C4;
5. código existente.

No inventar reglas de negocio.

Si existe contradicción entre código y documentación, NO modificar silenciosamente el comportamiento.

Informar la inconsistencia antes de realizar un cambio que pueda afectar el dominio.

---

# 6. Modelo de dominio

El modelo debe mantenerse alineado con el DER del proyecto.

Entidades principales:

- usuario
- estudiante
- docente
- periodo_titulacion
- estudiante_habilitado
- lote_importacion
- solicitud_exportacion
- linea_investigacion
- tema
- tema_historial
- grupo
- grupo_integrante
- invitacion
- postulacion
- tutor_propuesto
- asignacion_tema
- asignacion_tutor
- config_carga_tutorial
- resolucion_conflicto
- conflicto_participante
- plantilla_pat
- documento_pat
- revision_pat
- notificacion
- auditoria

No eliminar entidades, relaciones, restricciones o campos relevantes del DER sin autorización.

---

# 7. Reglas de negocio críticas

Estas reglas tienen prioridad alta y deben estar protegidas mediante validaciones, restricciones de base de datos y transacciones cuando corresponda.

## Usuarios

Roles válidos:

- ESTUDIANTE
- DOCENTE
- ADMIN

ADMIN es un rol dentro de usuario.

La autenticación vigente usa correo y contraseña propios del sistema. No hay
registro público ni login demo compartido. Los estudiantes solo pueden usar
`@live.uleam.edu.ec`; DOCENTE y ADMIN pueden usar `@uleam.edu.ec` o
`@live.uleam.edu.ec`. Las contraseñas se almacenan con Argon2id. Las claves
temporales permiten únicamente establecer una contraseña personal y no se
registran en auditoría, API o logs. Los tokens RS256 duran 15 minutos; las
sesiones tienen un máximo absoluto de ocho horas y refresh tokens rotativos
protegidos con cookie HttpOnly, origen y CSRF. Un cambio de contraseña revoca
las sesiones vigentes.

Las cuentas se crean por ADMIN o por importación confirmada de Excel. La
importación solo se admite con un período BORRADOR; validar genera vista previa
y confirmar vuelve a comprobar los datos dentro de la transacción que crea
usuarios, perfiles, habilitaciones, lote, auditoría y correo de acceso. En la
importación, la clave temporal inicial de cada estudiante es su cédula y debe
cambiarse en el primer acceso; las altas manuales conservan claves aleatorias.
El esquema nuevo de desarrollo es `titulacion_dev`; preservar el esquema
histórico `local_demo` sin cambios.

Docentes (RF-19): `POST /docentes` sin `usuario_id` crea en una transacción la cuenta
DOCENTE (clave temporal aleatoria y correo ACCESO cifrado, como `POST /usuarios`) y su
perfil, con auditoría `CREAR_USUARIO` y `CREAR_DOCENTE`; con `usuario_id` vincula una cuenta
existente (mezclar ambos es 400). `PATCH /docentes/:id` (ADMIN) edita nombres, apellidos,
estado ACTIVO/INACTIVO, cédula, título, departamento y `habilitado_tutoria` con auditoría
`EDITAR_DOCENTE` antes/después; el correo es el usuario de acceso y se rechaza con 400. Una
cédula repetida responde 409. Pasar a INACTIVO revoca las sesiones (`version_sesion` + 1 y
sesiones revocadas) y no altera tutorías VIGENTES, asignaciones ni límites de carga: el docente
inactivo deja de poder ingresar y el trigger de tutor ya impide asignarle tutorías nuevas.

Importación de docentes: plantilla XLSX propia (`GET /importaciones/docentes/plantilla`,
encabezados `cedula, nombres, apellidos, email, titulo, departamento, habilitado_tutoria` con
SI/NO sin importar mayúsculas ni tildes). `POST /importaciones/docentes/validar` →
`GET /importaciones/docentes/:id` → `POST /importaciones/docentes/:id/confirmar` (ADMIN, BullMQ,
una transacción SERIALIZABLE). No depende de un período: `preparacion_importacion.tipo`
(migración `20261020110000`) exige período para ESTUDIANTES y lo prohíbe para DOCENTES. Correo
@uleam.edu.ec o @live.uleam.edu.ec, clave temporal inicial = cédula con cambio obligatorio y
correo ACCESO cifrado. Conflictos con cuentas o cédulas existentes son errores por fila; los
registros idénticos se omiten.

---

## Períodos

`POST /periodos/:id/abrir-postulacion` abre desde BORRADOR y reabre desde
POSTULACION_CERRADA (auditoría `REABRIR_POSTULACION`), en ambos casos solo si la
fecha actual está en [`fecha_inicio_postulacion`, `fecha_fin_postulacion`); fuera
de ese plazo responde 409 pidiendo editar primero la fecha fin. Las postulaciones
existentes se conservan. `PATCH /periodos/:id` edita cualquier campo en BORRADOR;
en POSTULACION_CERRADA solo puede cambiar `fecha_fin_postulacion` (los demás
campos se aceptan solo si repiten su valor actual) y se mantiene la cronología
`fecha_fin_postulacion <= fecha_inicio_titulacion`. En los demás estados la
edición responde 409. Ningún trigger restringe CERRADA → ABIERTA.

---

## Estudiantes habilitados

Un estudiante debe estar habilitado para participar en un período.

Puede tener condición:

- REGULAR
- CONDICIONADO

Un estudiante condicionado puede participar en el proceso, pero su ingreso definitivo depende de resolver el requisito pendiente.

Estados de situación de ingreso:

- PENDIENTE
- ADMITIDO
- NO_ADMITIDO

La resolución del ingreso de un condicionado (`resolver-ingreso`) se permite con el
período en BORRADOR, POSTULACION_ABIERTA o POSTULACION_CERRADA y se rechaza en
EN_CURSO y ARCHIVADO. Se conserva la regla de fecha: ADMITIDO solo antes de
`fecha_inicio_titulacion`; un NO_ADMITIDO posterior a esa fecha requiere
POSTULACION_CERRADA. Las altas de habilitaciones siguen limitadas a BORRADOR.

Los condicionados pendientes no bloquean el inicio de titulación. Al iniciar,
en la misma transacción SERIALIZABLE y antes de pasar el período a EN_CURSO,
cada habilitación CONDICIONADO/PENDIENTE del período (bloqueada con
`ORDER BY id FOR UPDATE`) queda SUSPENDIDO/NO_ADMITIDO, con
`fecha_resolucion_ingreso`, `resuelto_por` del actor y la observación
«Requisito no resuelto antes del inicio de titulación.»; se conservan la
condición y el requisito. Cada suspensión se audita como
`SUSPENDER_HABILITACION_INICIO` y la auditoría `INICIAR_TITULACION` incluye
`condicionados_suspendidos`. Cada suspendido recibe además los mismos efectos que
una NO_ADMISIÓN manual (`HabilitadosService.aplicarNoAdmision`) y notificación
`INGRESO_RESUELTO` en app y correo asíncrono que explica la suspensión. El trigger de PostgreSQL sigue impidiendo un
período EN_CURSO con condicionados pendientes.

Efectos de toda NO_ADMISIÓN (manual o al iniciar), en la transacción que ya
bloqueó período y habilitación y en este orden:

1. `AsignacionTemaPersistenciaService.anularPorIncumplimiento`: asignación
   VIGENTE → ANULADA, tutor terminado, postulación ACEPTADA → ANULADA, tema
   republicado y aviso `TEMA_ANULADO`.
2. `PostulacionPersistenciaService.cancelarPendientesPorNoAdmision`: bloquea el
   grupo activo del estudiante y luego sus postulaciones; las PENDIENTE
   individuales y del grupo pasan a CANCELADA con el motivo como observación,
   auditoría `CANCELAR_POSTULACION_NO_ADMISION` y aviso
   `POSTULACION_CANCELADA` a los participantes activos. Una postulación grupal
   se cancela aunque el tema admita el nuevo tamaño, porque congela
   `num_integrantes` y exige participantes elegibles. EN_CONFLICTO no tiene
   transición a CANCELADA en PostgreSQL y hoy ningún flujo la produce; ACEPTADA
   la resuelve el paso 1.
3. `GrupoIntegrantePersistenciaService.retirarPorNoAdmision`: su pertenencia
   ACTIVO pasa a RETIRADO con `fecha_salida` y `motivo_salida` (auditoría
   `RETIRAR_INTEGRANTE_NO_ADMISION`). Si era representante, el cargo pasa a otro
   integrante activo (elegibles primero, ADMITIDO antes que PENDIENTE, luego
   antigüedad) con auditoría `CAMBIAR_REPRESENTANTE` y resolución de las
   invitaciones pendientes del grupo; el grupo queda EN_CONFORMACION con un
   integrante o DISUELTO sin integrantes (invitaciones pendientes resueltas).
   Es una acción administrativa: no aplica la ventana de plazo de
   `GrupoGestionService`. También aplica si el grupo ya tiene postulaciones
   (incluso CANCELADA): desde la migración `20261019100000` el trigger
   `proteger_composicion_postulacion` admite, como única excepción a la
   composición cerrada, el UPDATE ACTIVO → RETIRADO con `fecha_salida` que no
   cambia `grupo_id`, `periodo_id`, `estudiante_id` ni `fecha_ingreso`, cuando la
   habilitación del integrante está NO_ADMITIDO. El traspaso de representante
   (solo `rol_en_grupo`) ya era admitido porque no altera la composición; los
   cambios de estado del grupo y de invitaciones no están sujetos a ese trigger.
   Cualquier otro cambio (retirar a un ADMITIDO/PENDIENTE, altas, bajas físicas o
   alterar otros campos) sigue rechazado con 23514.
4. Notificación `INGRESO_RESUELTO`.

No existe un tipo de notificación propio para «integrante retirado»; los demás
integrantes se enteran por `POSTULACION_CANCELADA` e invitaciones canceladas.
Las invitaciones pendientes dirigidas al estudiante en otros grupos no se
cancelan (la aceptación ya exige una habilitación elegible).

---

## Grupos

Un estudiante puede pertenecer como máximo a un grupo activo por período.

Un grupo pertenece a un único período.

Un grupo debe tener un representante activo.

Para postulación grupal debe tener al menos 2 integrantes.

Una vez realizada la postulación, la composición del grupo queda cerrada según las reglas del sistema.

---

## Invitaciones

Solo estudiantes habilitados del mismo período pueden ser invitados.

Estados:

- PENDIENTE
- ACEPTADA
- RECHAZADA
- CANCELADA
- EXPIRADA

Solo puede existir una invitación pendiente por grupo y estudiante destinatario.

El emisor y destinatario no pueden ser el mismo estudiante.

---

## Temas

Estados:

- BORRADOR
- PUBLICADO
- CERRADO
- ASIGNADO
- RETIRADO

Un tema está disponible cuando:

1. está PUBLICADO;
2. no tiene una asignación VIGENTE.

Debe cumplirse:

min_integrantes >= 1

max_integrantes >= min_integrantes

Los cambios relevantes del tema deben conservarse en el historial.

Cierre, retiro y reapertura (RF-21/RF-25), solo ADMIN y con motivo obligatorio
(`POST /periodos/:periodoId/temas/:id/cerrar` y `/retirar`, cuerpo `{ motivo }`):

- CERRAR: PUBLICADO → CERRADO. RETIRAR: BORRADOR, PUBLICADO o CERRADO → RETIRADO
  (terminal).
- Se rechazan con 409 si el período está ARCHIVADO o el tema tiene asignación
  VIGENTE (estado ASIGNADO); no aplica la ventana de plazo de administración de
  temas.
- En la misma transacción SERIALIZABLE (período → tema → postulaciones en orden
  de id, `FOR UPDATE`), las postulaciones PENDIENTE o EN_CONFLICTO del tema pasan
  a RECHAZADA con observación «Tema cerrado|retirado: motivo», auditoría
  `RECHAZAR_POSTULACION_POR_CIERRE_TEMA` / `..._POR_RETIRO_TEMA` y aviso
  `POSTULACION_RECHAZADA`. El tema registra historial (con `cambios.motivo`) y
  auditoría `CERRAR_TEMA` / `RETIRAR_TEMA`.
- Reabrir: `POST .../temas/:id/publicar` sobre un tema CERRADO lo devuelve a
  PUBLICADO (auditoría `REABRIR_TEMA`, historial) si no tiene asignación VIGENTE
  y el período no está ARCHIVADO; las postulaciones rechazadas no se reactivan.
  Publicar un BORRADOR conserva sus reglas de plazo y referencias activas.

Ningún trigger de PostgreSQL restringe estas transiciones de tema; las de
postulación (PENDIENTE/EN_CONFLICTO → RECHAZADA con observación) ya estaban
permitidas.

---

## Postulaciones

Una postulación es:

- individual; o
- grupal.

Nunca ambas simultáneamente.

Debe cumplirse conceptualmente:

XOR(grupo_id, estudiante_id)

Postulación individual:

num_integrantes = 1

Postulación grupal:

num_integrantes >= 2

El número de integrantes debe estar dentro de:

[min_integrantes, max_integrantes]

del tema.

Un estudiante o grupo puede tener como máximo una postulación activa.

No permitir postulaciones:

- fuera de las fechas del período;
- a temas no disponibles;
- de estudiantes no habilitados;
- incompatibles con el rango de integrantes;
- duplicadas;
- simultáneamente individuales y grupales.

---

## Tutores propuestos

Una postulación puede proponer uno o varios docentes.

Cada propuesta tiene:

orden_prioridad >= 1

No repetir:

- docente dentro de la misma postulación;
- orden de prioridad dentro de la misma postulación.

El docente proponente del tema debe sugerirse primero cuando corresponda.

Una propuesta de tutor NO significa que el docente haya sido asignado.

---

## Asignación de tema

Una asignación debe provenir de una postulación aceptada.

Un tema puede tener como máximo una asignación VIGENTE.

Un grupo puede tener como máximo una asignación VIGENTE.

Un estudiante individual puede tener como máximo una asignación VIGENTE.

La asignación debe ser atómica.

Nunca implementar este proceso como:

1. consultar si existe;
2. si no existe, insertar;

sin protección de concurrencia.

Usar:

- transacciones;
- restricciones únicas;
- mecanismos apropiados de bloqueo cuando corresponda.

Debe evitarse la doble asignación ante solicitudes simultáneas.

Cuando un tema queda asignado:

- pasa a ASIGNADO;
- deja de recibir postulaciones;
- las demás postulaciones correspondientes se rechazan según la regla de negocio;
- se conserva el historial.

Las anulaciones NO eliminan físicamente la asignación.

Anulación manual: `POST /periodos/:periodoId/asignaciones-tema/:id/anular` (solo
ADMIN, cuerpo `{ causa: OTRA | INCUMPLIMIENTO_CONDICION, motivo }`). Transacción
SERIALIZABLE que bloquea el período (409 si está ARCHIVADO) y luego tema,
postulación y asignación (409 si no está VIGENTE). Los efectos los aplica
`AsignacionTemaPersistenciaService.anularBloqueada`, el mismo flujo que usa
`anularPorIncumplimiento`: asignación ANULADA con causa/motivo/responsable/fecha,
tutor vigente terminado, postulación ACEPTADA → ANULADA, tema ASIGNADO →
PUBLICADO con historial, auditorías y aviso `TEMA_ANULADO`. Con causa OTRA las
auditorías son `ANULAR_POSTULACION_MANUAL` y `REPUBLICAR_TEMA_ANULACION`. Las
postulaciones rechazadas previamente no se reactivan.

---

## Asignación de tutor

El ADMIN realiza la asignación definitiva.

Puede:

- confirmar un tutor propuesto;
- asignar directamente otro docente habilitado.

El docente proponente del tema y el tutor pueden ser personas diferentes.

Solo debe existir un tutor VIGENTE por asignación de tema.

Los reemplazos deben conservar:

- tutor anterior;
- motivo;
- fecha;
- responsable.

---

## Carga tutorial

La carga tutorial puede tener:

- límite global del período;
- límite específico por docente.

Un límite específico no se elimina: `POST /periodos/:pid/config-carga-tutorial/:id/desactivar`
(ADMIN, auditoría `DESACTIVAR_CONFIG_CARGA_TUTORIAL`) lo deja `activa = false` como historial.
La resolución efectiva (`CargaTutorialPersistenciaService` y el trigger
`proteger_asignacion_tutor`) ignora los inactivos y vuelve a aplicar el global. Un límite
inactivo no se modifica (409 en servicio, 23514 en PostgreSQL); el global no se desactiva. La
unicidad es parcial (`UQ_config_carga_tutorial_global` y
`UQ_config_carga_tutorial_docente_activa`), por lo que puede crearse un nuevo límite específico
para el mismo docente. `GET .../config-carga-tutorial` lista solo activos salvo
`incluir_inactivas=true`. Migración `20261020100000`.

El sistema debe determinar la configuración aplicable.

Al superar el límite:

- advertir; o
- bloquear;

dependiendo de la configuración.

No duplicar esta lógica en varios controladores o servicios.

Centralizarla en el dominio correspondiente.

---

## PAT

El PAT solo puede cargarse cuando existe una asignación de tema vigente.

Formatos permitidos:

- PDF
- DOCX

Cada carga genera una nueva versión.

Nunca sobrescribir versiones anteriores.

Cada documento debe registrar SHA-256.

Cada versión puede recibir una revisión.

Resultados:

- APROBADO
- OBSERVADO
- RECHAZADO

Si el resultado es OBSERVADO o RECHAZADO, las observaciones son obligatorias.

---

# 8. Conservación histórica

Regla fundamental:

**NO eliminar físicamente información histórica del proceso.**

No usar DELETE físico para registros históricos como:

- postulaciones rechazadas;
- asignaciones anuladas;
- tutores reemplazados;
- temas retirados;
- integrantes retirados;
- revisiones;
- versiones del PAT.

Utilizar estados y datos de trazabilidad.

Antes de implementar un DELETE preguntarse:

"¿Este registro forma parte del historial académico o administrativo?"

Si la respuesta es sí, no eliminarlo físicamente.

---

# 9. Transacciones

Usar transacciones en operaciones críticas.

Especialmente:

- postulaciones;
- aceptación/resolución de postulaciones;
- asignación de temas;
- anulación de asignaciones;
- asignación/reemplazo de tutores;
- resolución de estudiantes condicionados;
- operaciones que modifican varias entidades relacionadas.

Una operación crítica debe completarse totalmente o no realizar ningún cambio.

---

# 10. Base de datos

Base de datos:

PostgreSQL.

Usar:

- PK;
- FK;
- UNIQUE;
- CHECK;
- índices;
- restricciones únicas parciales cuando corresponda.

No depender exclusivamente de validaciones TypeScript para proteger invariantes críticas.

Las reglas que puedan romperse por concurrencia deben estar respaldadas por PostgreSQL.

Usar UUID donde lo establece el modelo.

Usar TIMESTAMPTZ para fechas y horas del dominio cuando corresponda.

---

# 11. DTO y validaciones

Toda entrada HTTP debe usar DTO.

Utilizar class-validator / class-transformer o las herramientas establecidas por el proyecto.

No aceptar directamente entidades ORM como body.

Ejemplo:

@Post()
create(@Body() dto: CreateTemaDto) {
  return this.temasService.create(dto);
}

Validar:

- tipos;
- UUID;
- enums;
- campos requeridos;
- tamaños;
- rangos;
- formatos.

Las validaciones estructurales pertenecen al DTO.

Las reglas de negocio pertenecen al dominio/service.

---

# 12. Controllers

Los controllers deben ser delgados.

Responsabilidades:

- recibir request;
- validar DTO;
- obtener usuario autenticado;
- ejecutar casos de uso/services;
- devolver respuesta HTTP.

NO colocar lógica compleja de negocio en controllers.

---

# 13. Services

Los services implementan casos de uso y reglas del dominio.

Evitar services excesivamente grandes.

Extraer lógica especializada cuando sea necesario.

Usar nombres que expresen intención.

Preferir:

asignarTema()

en lugar de:

updateData()

Preferir:

resolverConflicto()

en lugar de:

process()

---

# 14. Autenticación y autorización

La decisión aprobada reemplaza el diseño inicial OIDC/JWKS: se utiliza
correo/contraseña propia con JWT RS256 y claves persistentes. No reintroducir
proveedor externo ni modo local de demostración sin nueva autorización.

Aplicar autorización por roles:

- ESTUDIANTE
- DOCENTE
- ADMIN

La autorización NO termina en comprobar el rol.

También aplicar autorización a nivel de recurso.

Ejemplo:

Un estudiante no debe poder consultar o modificar postulaciones pertenecientes a otro estudiante o grupo sin autorización.

Un docente solo debe acceder a la información permitida de sus temas y tutorías.

---

# 15. Archivos

PAT y plantillas deben utilizar almacenamiento de objetos:

- S3 compatible; o
- SeaweedFS local durante desarrollo.

No guardar archivos binarios directamente en PostgreSQL salvo decisión explícita posterior.

Validar:

- extensión;
- MIME type;
- tamaño;
- obligatoriedad.

Los documentos PAT deben registrar hash SHA-256.

Las descargas deben utilizar URLs prefirmadas con vigencia limitada cuando corresponda.
En desarrollo, SeaweedFS es el proveedor local aprobado; AIStor queda como alternativa opcional. La clave SSE-S3 se conserva fuera de Git y no se rota si existen objetos cifrados.

---

# 16. Procesamiento asíncrono

Las operaciones pesadas deben ejecutarse mediante:

BullMQ + Redis.

Ejemplos:

- correos;
- notificaciones;
- exportaciones;
- reportes;
- importaciones masivas.

No bloquear una petición HTTP esperando tareas pesadas que pueden procesarse en segundo plano.

El worker sigue formando parte de la arquitectura del sistema; no interpretar esto como autorización para convertir cada módulo en microservicio.

---

# 17. Notificaciones

El sistema contempla:

- notificaciones dentro de la aplicación;
- correo electrónico.

Los eventos relevantes incluyen:

- invitaciones;
- cambios de postulación;
- asignación de tema;
- anulación;
- asignación/reemplazo de tutor;
- revisión del PAT;
- cambios en situación de ingreso.

El envío de correo debe ser asíncrono.

---

# 18. Auditoría

Las operaciones relevantes deben generar trazabilidad.

La auditoría contempla:

- usuario;
- acción;
- entidad;
- ID de entidad;
- valores anteriores;
- valores nuevos;
- IP;
- fecha/hora.

Consulta: `GET /auditoria` (solo ADMIN, `AuditoriaConsultaService`, SQL parametrizado y
calificado por esquema) pagina por `fecha_hora DESC, id DESC` con filtros `entidad_tipo`,
`entidad_id`, `accion`, `usuario_id`, `desde`/`hasta` (una fecha sin hora en `hasta` incluye
todo el día UTC) y `q` (ILIKE con comodines escapados sobre acción, tipo de entidad y correo del
actor). Devuelve el `id` bigint como texto, IP y valores completos; como defensa en profundidad
oculta claves con nombres de credenciales. Nunca auditar contraseñas, hashes, tokens ni claves
temporales. Índices `IDX_auditoria_fecha_hora` e `IDX_auditoria_usuario` (migración
`20261027100000`, `db:verify-auditoria`).

Historial de importaciones (ADMIN): `GET /periodos/:periodoId/importaciones/estudiantes` y
`GET /importaciones/docentes` listan preparaciones (con su lote si se completó), más recientes
primero y paginadas; las vencidas se listan con `expirada: true` (no 410).

No confundir:

logs técnicos

con:

auditoría funcional.

Son responsabilidades diferentes.

---

# 19. API REST

Mantener convenciones REST consistentes.

Ejemplos:

GET    /temas
GET    /temas/:id
POST   /temas
PATCH  /temas/:id

Para acciones de dominio que no representan CRUD simple se permiten endpoints explícitos.

Ejemplos conceptuales:

POST /grupos/:id/invitaciones
POST /invitaciones/:id/aceptar
POST /postulaciones
POST /postulaciones/:id/cancelar
POST /postulaciones/:id/asignar-tema
POST /asignaciones/:id/asignar-tutor
POST /documentos-pat/:id/revisiones

No forzar reglas de negocio complejas dentro de CRUD genérico.

---

# 20. OpenAPI

Documentar la API con Swagger/OpenAPI.

Documentar:

- endpoints;
- parámetros;
- DTO;
- respuestas;
- códigos HTTP;
- autenticación;
- errores relevantes.

La documentación debe mantenerse sincronizada con el comportamiento real.

---

# 21. Manejo de errores

Utilizar excepciones HTTP apropiadas.

Ejemplos:

400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity

Los errores deben explicar la regla incumplida.

Ejemplo:

"El estudiante ya pertenece a un grupo activo en este período."

Mejor que:

"Error al crear grupo."

No exponer:

- stack traces;
- secretos;
- credenciales;
- SQL interno;
- información sensible.

---

# 22. Seguridad

Nunca:

- hardcodear secretos;
- subir .env;
- registrar tokens en logs;
- confiar en IDs enviados por el cliente sin autorización;
- confiar únicamente en el frontend;
- interpolar SQL inseguro.

Toda operación protegida debe validar:

1. autenticación;
2. rol;
3. acceso al recurso;
4. reglas de negocio.

---

# 23. Código

Mantener TypeScript estricto.

Evitar `any`.

No usar `any` para solucionar errores de tipos.

Preferir:

- interfaces;
- tipos;
- DTO;
- enums;
- generics cuando aporten claridad.

Mantener funciones pequeñas y nombres descriptivos.

No añadir abstracciones innecesarias.

No sobreingenierizar.

---

# 24. Pruebas

Las reglas críticas deben tener pruebas automatizadas.

Priorizar pruebas de:

- estudiante en máximo un grupo activo;
- rango de integrantes;
- postulación individual vs grupal;
- una postulación activa;
- disponibilidad del tema;
- una asignación vigente por tema;
- una asignación vigente por estudiante/grupo;
- concurrencia en asignaciones;
- estudiantes condicionados;
- carga tutorial;
- versionado PAT;
- observaciones obligatorias;
- permisos por rol y recurso.

Cuando se corrija un bug de negocio, agregar una prueba que reproduzca el bug siempre que sea razonable.

---

# 25. Migraciones

Todo cambio de esquema debe realizarse mediante migración.

No modificar manualmente producción.

Antes de crear una migración:

1. revisar el DER;
2. comprobar restricciones existentes;
3. evaluar datos existentes;
4. evitar pérdida de información.

Nunca eliminar una columna o tabla histórica automáticamente sin revisar su impacto.

---

# 26. Variables de entorno

Configuración sensible mediante variables de entorno.

Ejemplos:

DATABASE_URL
REDIS_HOST
REDIS_PORT
JWT_PRIVATE_KEY_PATH
JWT_PUBLIC_KEY_PATH
AUTH_ISSUER
AUTH_ORIGINS
S3_ENDPOINT
S3_BUCKET
S3_ACCESS_KEY
S3_SECRET_KEY
SMTP_HOST
OUTBOX_ENCRYPTION_KEY_PATH

Mantener un `.env.example` sin secretos reales.

---

# 27. Dependencias

Antes de instalar una dependencia:

1. comprobar si el proyecto ya tiene una solución;
2. justificar su necesidad;
3. comprobar compatibilidad con la versión actual de NestJS;
4. evitar paquetes abandonados o redundantes.

No instalar librerías para resolver problemas triviales que pueden resolverse con el stack existente.

---

# 28. Instrucciones para agentes de IA

Cuando un agente reciba una tarea:

## Antes de modificar código

1. Leer este AGENTS.md.
2. Inspeccionar la estructura actual.
3. Identificar el módulo afectado.
4. Revisar entidades, DTO, services y tests relacionados.
5. Revisar migraciones relacionadas.
6. Entender la regla de negocio antes de programar.

NO comenzar creando archivos sin inspeccionar primero el código relacionado.

## Durante la implementación

- realizar cambios pequeños y coherentes;
- reutilizar código existente;
- respetar nombres y patrones existentes;
- mantener separación modular;
- preservar compatibilidad;
- evitar cambios fuera del alcance solicitado.

## Después de implementar

Ejecutar, cuando existan:

npm run lint
npm run test
npm run test:e2e
npm run build

Si alguna prueba falla:

- investigar la causa;
- no ocultarla;
- no eliminar la prueba solo para obtener verde.

---

# 29. Cambios prohibidos sin autorización

Un agente NO debe por iniciativa propia:

- convertir el monolito en microservicios;
- cambiar PostgreSQL por otra base de datos;
- cambiar REST por GraphQL;
- reemplazar NestJS;
- cambiar el ORM establecido;
- cambiar el sistema de autenticación;
- eliminar entidades del DER;
- eliminar restricciones importantes;
- eliminar datos históricos;
- desactivar validaciones;
- eliminar tests para hacer pasar el build;
- modificar contratos públicos innecesariamente;
- introducir breaking changes no solicitados.

---

# 30. Evitar sobreingeniería

Este es un proyecto académico real que debe poder desarrollarse, explicarse y mantenerse.

Priorizar:

1. corrección;
2. claridad;
3. reglas de negocio;
4. mantenibilidad;
5. pruebas;
6. seguridad.

No crear patrones complejos solo por parecer "enterprise".

No implementar CQRS, Event Sourcing, DDD completo, múltiples buses internos o arquitecturas distribuidas salvo que exista una necesidad real y se solicite expresamente.

El monolito modular debe permanecer entendible.

---

# 31. Forma de trabajar con tareas grandes

No implementar todo el sistema de una sola vez.

Dividir el trabajo por módulos/casos de uso.

Orden recomendado aproximado:

1. configuración base;
2. database;
3. auth;
4. usuarios;
5. estudiantes/docentes;
6. períodos;
7. estudiantes habilitados;
8. líneas de investigación;
9. temas;
10. grupos;
11. invitaciones;
12. postulaciones;
13. tutores propuestos;
14. conflictos;
15. asignación de tema;
16. carga tutorial;
17. asignación de tutor;
18. plantillas PAT;
19. documentos PAT;
20. revisiones PAT;
21. notificaciones;
22. importaciones/exportaciones;
23. auditoría.

Cada etapa debe quedar funcional antes de avanzar cuando sea posible.

---

# 32. Criterio para completar una tarea

Una tarea no está terminada únicamente porque compile.

Antes de considerarla completa verificar:

- cumple el requisito solicitado;
- respeta las reglas de negocio;
- respeta el DER;
- tiene validaciones;
- aplica autorización cuando corresponde;
- maneja errores;
- conserva historial cuando corresponde;
- utiliza transacción si es una operación crítica;
- no rompe otros módulos;
- tiene pruebas relevantes;
- compila;
- pasa lint;
- Swagger refleja el cambio cuando aplica.

---

# 33. Comunicación del agente

Cuando se solicite implementar una funcionalidad, explicar brevemente:

1. qué se modificará;
2. qué archivos se crearán/modificarán;
3. qué regla de negocio se está implementando.

Después del cambio indicar:

1. qué se implementó;
2. decisiones técnicas importantes;
3. migraciones creadas;
4. pruebas realizadas;
5. cualquier problema o decisión pendiente.

No afirmar que algo funciona si no fue ejecutado o comprobado.

Diferenciar claramente entre:

- implementado;
- verificado;
- pendiente.

---

# 34. Principio principal

Ante cualquier duda, preservar:

**integridad de datos + reglas de negocio + historial + modularidad.**

El objetivo no es generar la mayor cantidad de código posible.

El objetivo es construir correctamente el Sistema de Gestión del Proceso de Titulación respetando su documentación y su arquitectura de monolito modular.
