# Backend del Sistema de Gestión del Proceso de Titulación

API REST con NestJS 12 y TypeScript, organizada como un monolito modular.
Las reglas del proyecto están en `AGENTS.md`.

## Estado actual

El backend incluye configuración validada, Swagger/OpenAPI, módulos del proceso
de titulación y ahora autenticación propia con contraseñas, sesiones y carga
administrativa de estudiantes mediante Excel.
`GET /` conserva la respuesta `Hello World!` de la plantilla inicial. Ya están
implementadas las cuentas de usuario y los perfiles básicos de estudiante y
docente, además de la configuración de períodos en estado `BORRADOR` y la
habilitación de estudiantes por período con resolución de condicionados.
La autenticación institucional Microsoft/OIDC y la autenticación local de
demostración se retiraron. Las cuentas usarán correo y contraseña propia; el
primer acceso con clave temporal exige cambiarla.

Se utiliza PostgreSQL 17. El desarrollo nuevo usa el esquema limpio
`titulacion_dev`; el esquema anterior `local_demo` se conserva intacto y no se
utiliza para el nuevo flujo.
La integración de Observe permanece desactivada.

Dependencias de base de datos: `@nestjs/typeorm` 12.0.2, `typeorm` 0.3.31 y
`pg` 8.23.1. Se usó el parche 0.3.31 en lugar del 0.3.28 previsto para corregir
la [vulnerabilidad del generador de migraciones](https://github.com/typeorm/typeorm/security/advisories/GHSA-2rp8-mm9q-fp49).

## Instalación y ejecución

Las herramientas actuales del proyecto requieren Node.js `22.22.3` o superior
en la rama 22, o `24.15.0` o superior en la rama 24.

Desde la raíz del backend:

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Configura las credenciales de PostgreSQL en `.env` antes de iniciar el backend.
`DB_PASSWORD=CAMBIAR_PASSWORD` es únicamente un ejemplo, no una contraseña real.
No incluyas `.env` en Git. También puedes proporcionar todas las variables desde
el entorno de ejecución; en ese caso no necesitas el archivo.

La base indicada en `DB_NAME` debe existir y PostgreSQL debe estar iniciado.
La aplicación no crea bases de datos ni usuarios de PostgreSQL.

```powershell
npm run db:check
npm run start:dev
```

Con la configuración de desarrollo:

- [Aplicación](http://localhost:3000/)
- [Swagger](http://localhost:3000/docs)
- [OpenAPI JSON](http://localhost:3000/docs-json)

Después de cambiar variables de entorno, reinicia el proceso.

## Variables de entorno

El backend lee `.env`. Una variable definida en el entorno de ejecución tiene
prioridad sobre la misma variable del archivo.

| Variable                                                     | Valores permitidos                                             | Predeterminado si se omite                        |
| ------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------- |
| `NODE_ENV`                                                   | `development`, `test`, `production`                            | `development`                                     |
| `PORT`                                                       | Entero decimal entre `1` y `65535`                             | `3000`                                            |
| `SWAGGER_ENABLED`                                            | Exactamente `true` o `false`                                   | `true` fuera de producción; `false` en producción |
| `DB_HOST`                                                    | Host no vacío                                                  | `localhost`                                       |
| `DB_PORT`                                                    | Entero decimal entre `1` y `65535`                             | `5432`                                            |
| `DB_SCHEMA`                                                  | Identificador de esquema PostgreSQL                            | `titulacion_dev`                                  |
| `DB_USERNAME`                                                | Usuario PostgreSQL no vacío                                    | Obligatorio                                       |
| `DB_PASSWORD`                                                | Contraseña no vacía                                            | Obligatorio                                       |
| `DB_NAME`                                                    | Nombre de base de datos no vacío                               | Obligatorio                                       |
| `JWT_PRIVATE_KEY_PATH`, `JWT_PUBLIC_KEY_PATH`                | Rutas a claves RS256 persistentes                              | Generadas localmente; obligatorias en producción  |
| `AUTH_ISSUER`                                                | Emisor de los JWT propios                                      | `http://127.0.0.1:3000` en desarrollo             |
| `AUTH_ORIGINS`                                               | Lista exacta de orígenes web                                   | Vacía; producción debe definir los orígenes       |
| `REDIS_HOST`, `REDIS_PORT`                                   | Redis/BullMQ para límites y trabajos                           | `127.0.0.1`, `6379`                               |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`                        | Servidor de correo                                             | Mailpit local en puerto `1025`                    |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Almacenamiento privado compatible con S3                       | SeaweedFS en `127.0.0.1:8333`                     |
| `OUTBOX_ENCRYPTION_KEY_PATH`                                 | Clave externa para cifrar claves temporales/códigos pendientes | Generada localmente                               |

Un valor vacío o inválido detiene el arranque e identifica la variable afectada,
sin incluir su valor en el error. `PORT` se convierte a número y
`SWAGGER_ENABLED` a booleano antes de usarlos. `DB_PORT` también se convierte
a número. Las credenciales de base de datos son obligatorias en todos los
entornos, incluidas las pruebas, que usan valores ficticios.

La autenticación usa claves RSA persistentes. Genéralas una sola vez y conserva
`/.secrets` fuera de Git y de respaldos públicos. El `sub` JWT es el UUID interno
de usuario; los permisos y el estado de la cuenta se consultan en PostgreSQL.
En producción se exige HTTPS, claves persistentes, Redis, SMTP y almacenamiento
privado configurados.

`.env.example` habilita Swagger explícitamente. Para deshabilitarlo, usa
`SWAGGER_ENABLED=false`. Para aplicar el comportamiento automático según
`NODE_ENV`, elimina o comenta la línea `SWAGGER_ENABLED`.

### Preparar servicios de desarrollo

El archivo `docker-compose.dev.yml` proporciona Redis, almacenamiento S3 local
(SeaweedFS con cifrado SSE-S3) y Mailpit. AIStor permanece disponible bajo el
perfil opcional `aistor`, conservando su volumen. Antes de iniciar los servicios,
genera la clave persistente de SeaweedFS; el comando no reemplaza una clave ya
existente:

```powershell
npm run storage:prepare-dev
```

La clave se guarda en `.secrets/seaweedfs.env`, ignorado por Git. No la elimines
ni la regeneres mientras existan archivos cifrados en el volumen.
Si
Docker Desktop está instalado:

```powershell
docker compose -f docker-compose.dev.yml up -d
npm run auth:keys
npm run db:prepare-auth
npm run usuario:bootstrap-admin
npm run start:dev
```

`auth:keys` crea claves privadas locales ignoradas por Git y no sobrescribe
archivos existentes. El comando `db:prepare-auth` crea únicamente el esquema
`titulacion_dev` y ejecuta las migraciones; no modifica `public` ni
`local_demo`. En desarrollo el backend crea el bucket privado de SeaweedFS al
recibir la primera importación. Mailpit muestra los mensajes locales en
[http://localhost:8025](http://localhost:8025).

El backend escucha en `127.0.0.1` fuera de producción. No publiques estos
servicios ni sus credenciales de desarrollo en Internet.

Para ejecutar la compilación en producción desde PowerShell:

```powershell
npm run build
$env:NODE_ENV = 'production'
$env:SWAGGER_ENABLED = 'false'
npm run start:prod
```

## Conexión y migraciones

`DatabaseModule` usa las mismas opciones de conexión que el `DataSource` del CLI.
El arranque espera a PostgreSQL y realiza hasta tres intentos, con 1 segundo
entre intentos y un máximo de 5 segundos para establecer cada conexión.
La aplicación cierra su conexión al apagarse. Los errores de inicialización
no imprimen credenciales.

`synchronize`, `dropSchema`, `migrationsRun` e `installExtensions` están
desactivados. Iniciar la API y ejecutar `db:check` no crea tablas ni ejecuta
migraciones. `db:check` comprueba `SELECT 1`, cierra la conexión y termina con
código `0` si funciona o `1` si falla.

Desde la raíz del backend, los comandos disponibles son:

```powershell
# Ver migraciones disponibles y aplicadas
npm run migration:show

# Generar una migración al incorporar o modificar entidades
npm run migration:generate -- src/database/migrations/NombreDelCambio

# Crear una migración para escribir SQL manualmente cuando corresponda
npm run migration:create -- src/database/migrations/NombreDelCambio

# Comprobar usuarios, perfiles y concurrencia en un esquema temporal aislado
npm run db:verify-perfiles

# Comprobar restricciones y concurrencia de períodos en esquema temporal
npm run db:verify-periodos

# Comprobar habilitados, lotes, auditoría y concurrencia en esquema temporal
npm run db:verify-habilitados

# Comprobar grupos, invitaciones, cupos y pertenencia concurrente
npm run db:verify-grupos

# Comprobar autenticación, esquema limpio y reversión protegida
npm run db:verify-auth

# Comprobar límites tutoriales, prioridad, concurrencia y auditoría
npm run db:verify-carga-tutorial

# Crear titulacion_dev y aplicar migraciones pendientes (solo cuando se decida)
npm run db:prepare-auth

# Registrar el primer administrador; solicita su clave personal de forma oculta
npm run usuario:bootstrap-admin

# Revertir únicamente la última migración aplicada, ejecutando su down()
npm run migration:revert
```

Las migraciones crean `usuario`, `estudiante`, `docente`, `periodo_titulacion`,
`lote_importacion`, `estudiante_habilitado`, `grupo`, `grupo_integrante`,
`invitacion`, `postulacion`, conflictos, asignaciones de tema, credenciales,
sesiones, recuperación de contraseña, correo pendiente y preparaciones de
importación, además de la tabla base `auditoria`.
`db:verify-perfiles`
genera un esquema temporal con nombre aleatorio y comprueba restricciones,
unicidad, vinculación de perfiles y protección al revertir con datos; al
terminar elimina únicamente ese esquema temporal. El nombre anterior
`db:verify-usuarios` se conserva como alias. Para crear las tablas reales de
desarrollo, ejecuta `migration:run` explícitamente. Si no hay diferencias de esquema,
`migration:generate` no genera archivos y termina con código `1`; eso no indica
un fallo de conexión. Revisa el SQL generado y el DER antes de aplicar cambios.

TypeORM puede crear la tabla técnica `migrations` al consultar o ejecutar
migraciones por primera vez. Esa tabla registra las migraciones aplicadas y no
forma parte del dominio de titulación.

Los comandos que necesitan conexión compilan previamente y cargan
`dist/database/data-source.js`. Las entidades se descubrirán como
`*.entity.js` dentro de `dist`, y las migraciones como `*.js` en
`dist/database/migrations`. Los archivos fuente se mantienen en TypeScript y
las migraciones se guardan en `src/database/migrations`. No se requieren
`ts-node`, Docker ni cambios manuales del esquema para esta etapa.

## Validación y documentación

La configuración compartida de la aplicación está en `src/config/setup-app.ts`;
el arranque y las pruebas HTTP usan la misma función.

Las entradas HTTP utilizan clases DTO con decoradores de
`class-validator`. La validación global transforma el body a su clase DTO y
rechaza datos inválidos o propiedades no declaradas con HTTP `400`.
Las conversiones de campos deben declararse explícitamente con
`class-transformer` cuando correspondan. Las reglas de negocio pertenecen a
los servicios de cada módulo.

Swagger documenta los endpoints disponibles. El controlador para comprobar
DTO existe únicamente en las pruebas, no en la aplicación.

## Autenticación

`POST /auth/login` acepta correo y contraseña. La contraseña se almacena con
Argon2id. Una clave temporal enviada por correo permite obtener un token de
primer acceso válido diez minutos, limitado a `POST /auth/change-initial-password`.
Las contraseñas personales admiten entre 15 y 128 caracteres; no se recortan ni
normalizan.

Los tokens de acceso RS256 duran 15 minutos. La sesión tiene un máximo absoluto
de ocho horas y se renueva mediante un refresh token aleatorio rotado en cada
uso, guardado en cookie `HttpOnly`, `SameSite=Strict` y protegido por origen y
CSRF. Cambiar o recuperar la contraseña invalida las sesiones. La recuperación
siempre devuelve un mensaje genérico para no revelar si existe la cuenta.

Rutas disponibles: `POST /auth/login`, `POST /auth/change-initial-password`,
`POST /auth/refresh`, `POST /auth/logout`, `POST /auth/change-password`,
`POST /auth/forgot-password`, `POST /auth/reset-password` y `GET /auth/me`.
En Swagger, copia el `access_token` y usa **Authorize**. El refresh requiere
cookie y origen permitido, por lo que normalmente se usa desde el frontend.
Las claves no se registran en respuestas, auditoría ni logs.

## Usuarios

Después de aplicar la migración, `POST /usuarios` permite a un ADMIN activo
registrar una cuenta permitida por dominio y encola el envío de una clave
temporal individual. `POST /usuarios/:id/reenviar-acceso` solo está disponible
mientras la cuenta requiera cambio inicial. `GET /usuarios` lista cuentas paginadas y
`GET /usuarios/me` devuelve la cuenta activa vinculada al `sub` del token.
Los roles confiables se leen desde PostgreSQL y no desde el JWT. El email se
normaliza a minúsculas. `ultimo_acceso` registra la última solicitud autorizada
a la API, no un evento del proveedor de inicio de sesión.

Para crear el primer ADMIN ejecuta `npm run usuario:bootstrap-admin` en una
terminal interactiva después de aplicar la migración. Solicita correo,
nombres, apellidos y una contraseña personal con entrada oculta. Solo permite
la inicialización si todavía no existe ningún ADMIN.

El correo de ESTUDIANTE debe terminar en `@live.uleam.edu.ec`. DOCENTE y ADMIN
pueden usar `@uleam.edu.ec` o `@live.uleam.edu.ec`. No existe registro público.
`id_externo_sso` se conserva nullable únicamente para los registros históricos;
no se incluye en altas ni se utiliza durante la autenticación.

## Importación de estudiantes desde Excel

ADMIN elige un período en `BORRADOR`, descarga `GET
/importaciones/estudiantes/plantilla` y carga el archivo en
`POST /periodos/:periodoId/importaciones/estudiantes/validar`. La carga se
valida en segundo plano; consulta su progreso y vista previa mediante
`GET /periodos/:periodoId/importaciones/estudiantes/:id`. Solo una preparación
sin errores puede confirmarse con `POST
/periodos/:periodoId/importaciones/estudiantes/:id/confirmar`.

La hoja debe llamarse `Estudiantes`; sus columnas, en este orden, son:
`email`, `nombres`, `apellidos`, `cedula`, `matricula`, `carrera`, `nivel`,
`condicion_ingreso`, `requisito_pendiente`. Se aceptan `.xlsx` de hasta 5 MiB y
1000 filas. Cédula y matrícula deben guardarse como texto para preservar ceros.
La confirmación crea cuentas ESTUDIANTE, perfiles y habilitaciones, genera una
clave temporal individual y la pone en cola para correo. Las filas regulares
quedan admitidas; las condicionadas quedan pendientes. Las reimportaciones no
cambian claves, estados ni decisiones previas.

Los mensajes de desarrollo se pueden leer en Mailpit en
[http://localhost:8025](http://localhost:8025). Las claves temporales vencen
en 72 horas. La persona debe iniciar sesión con `POST /auth/login` y establecer
su contraseña desde `POST /auth/change-initial-password`; luego puede usar la
API normalmente. El correo institucional real requiere un remitente SMTP
autorizado, todavía pendiente.

## Perfiles de estudiantes y docentes

Un ADMIN activo crea perfiles para cuentas existentes desde `POST /estudiantes`
y `POST /docentes`. Primero registra o consulta las cuentas en `/usuarios` y
usa su `id` como `usuario_id`. La cuenta debe estar activa y tener el rol que
corresponde al perfil. No se crean perfiles automáticamente al iniciar sesión.

`GET /estudiantes` y `GET /docentes` muestran listados paginados solo a ADMIN;
`GET /estudiantes/:id` y `GET /docentes/:id` permiten consultar un perfil por
UUID. Cada estudiante puede consultar `/estudiantes/me` y cada docente
`/docentes/me`. Estos endpoints devuelven un resumen de la cuenta vinculada y
no exponen `id_externo_sso`.

Las cédulas deben contener diez dígitos, código provincial 01–24 o 30 y checksum
módulo 10 válido. El perfil de estudiante todavía no habilita participación en
un período. El campo `habilitado_tutoria` del docente empieza en `false` si no
se indica otro valor al crearlo.

## Períodos de titulación

Un ADMIN puede crear, consultar y editar períodos mientras estén en estado
`BORRADOR`. Los endpoints están disponibles en `/periodos` y
`/periodos/:id`; el listado usa `page` y `limit`, y `PATCH /periodos/:id`
actualiza solo los campos enviados. El estado y el ID los asigna el servidor.

Al crear un período se debe indicar código, nombre, fechas de inicio y fin de
postulaciones, fecha de inicio de titulación y máximo predeterminado de
integrantes. Las fechas deben incluir zona horaria, por ejemplo:
`2026-11-02T08:00:00-05:00`. La API verifica que el fin de postulaciones sea
posterior al inicio y que la titulación comience al cierre o después; devuelve
las fechas en UTC. PostgreSQL protege también esas reglas y la unicidad exacta
del código.

Los estados posteriores a `BORRADOR` están definidos en el modelo, pero sus
transiciones se implementarán cuando estén disponibles las validaciones de
estudiantes habilitados y condicionados.

## Estudiantes habilitados

En un período `BORRADOR`, ADMIN puede habilitar un perfil existente desde
`POST /periodos/:periodoId/habilitados`. Una habilitación `REGULAR` queda con
ingreso `ADMITIDO`; una `CONDICIONADA` necesita el requisito pendiente y queda
en `PENDIENTE`. Primero se registra la cuenta y el perfil de estudiante; la
habilitación es un paso separado.

`GET /periodos/:periodoId/habilitados` permite a ADMIN consultar el listado
paginado y filtrar por condición, situación de ingreso y estado. El detalle se
consulta en `GET /periodos/:periodoId/habilitados/:id`. Cada estudiante puede
consultar exclusivamente su registro en
`GET /periodos/:periodoId/habilitados/me`.

ADMIN resuelve un caso condicionado pendiente en
`POST /periodos/:periodoId/habilitados/:id/resolver-ingreso`, indicando
`ADMITIDO` o `NO_ADMITIDO`. Para `NO_ADMITIDO` debe registrar una observación.
La fecha y el responsable provienen del servidor y la cuenta autenticada. El
requisito original se conserva y cada alta o resolución registra una fila de
auditoría dentro de la misma transacción.

El alta manual solo se permite mientras el período está en `BORRADOR`. ADMIN
puede resolver condicionados pendientes tanto en `BORRADOR` como en
`POSTULACION_ABIERTA`, siempre antes de `fecha_inicio_titulacion`. El resultado
`NO_ADMITIDO` no cambia el estado separado de habilitación; grupos y
asignaciones aplicarán la decisión cuando esos módulos estén disponibles.
La tabla `lote_importacion` queda preparada para conservar la relación del DER,
aunque la importación de Excel todavía no está implementada.

## Líneas de investigación

El catálogo de `/lineas-investigacion` es global y no pertenece a un período.
ADMIN puede crear, editar, desactivar y reactivar líneas; DOCENTE y ESTUDIANTE
pueden consultar únicamente las activas. Las líneas se conservan: no se
eliminan físicamente y el código no se libera al desactivarlas. El código es
único exacto (distingue mayúsculas y minúsculas); el nombre puede repetirse.

La creación requiere `codigo` y `nombre`; la descripción es opcional. El
listado acepta `page` y `limit` (por defecto 1 y 20, máximo 100). ADMIN puede
ver todo el catálogo o filtrar con `activa=true|false`. Los otros roles solo
ven activas; pedir `activa=false` devuelve `403`, y una línea inactiva se oculta
como `404` en el detalle. ADMIN puede cambiar `activa` desde
`PATCH /lineas-investigacion/:id`; enviar `descripcion: null` la limpia.
Altas y cambios se registran en `auditoria` dentro de la misma transacción; un
PATCH sin cambios no añade un registro de auditoría.

Aplicar las migraciones en `titulacion_dev` mediante `npm run db:prepare-auth`;
no se insertan líneas de ejemplo.

## Temas de titulación

ADMIN puede registrar temas en estado `BORRADOR` desde
`POST /periodos/:periodoId/temas`, indicando una línea activa, un docente
proponente, título, descripción y obligatoriamente los límites mínimo y máximo
de integrantes. El máximo del período no se copia automáticamente al tema.
Los límites deben ser positivos y el máximo no puede ser menor que el mínimo.

ADMIN puede editar parcialmente un tema mientras esté en `BORRADOR` y el
período esté en `BORRADOR` o `POSTULACION_ABIERTA` dentro del plazo. También
puede consultar el listado, filtrarlo por línea, docente, estado o por una
cantidad de integrantes incluida en el rango del tema, y revisar
`GET /periodos/:periodoId/temas/:id/historial`. Un cambio sin modificaciones
no crea una entrada nueva. Cada alta, edición y publicación guarda el antes y
el después en el historial y en la auditoría dentro de la misma transacción.

ADMIN publica un borrador con
`POST /periodos/:periodoId/temas/:id/publicar`. La línea debe seguir activa y
el docente proponente debe tener una cuenta activa con rol `DOCENTE`. Se puede
publicar antes de abrir el período para preparar el catálogo o durante el
plazo de postulación. Al publicar, el tema pasa a `PUBLICADO`; en esta etapa
no se editan temas publicados.

DOCENTE puede listar y consultar únicamente los temas que tiene como
proponente; necesita una cuenta activa y un perfil docente. `habilitado_tutoria`
no es requisito para proponer temas. ESTUDIANTE consulta únicamente temas
`PUBLICADO` cuando el período está `POSTULACION_ABIERTA` y tiene una cuenta
activa, perfil y habilitación `HABILITADO` del mismo período con situación de
ingreso `PENDIENTE` o `ADMITIDO`. Una situación pendiente permite ver el
catálogo, aunque deberá resolverse antes del inicio de titulación.

ADMIN abre el período con `POST /periodos/:id/abrir-postulacion`. Solo puede
hacerlo cuando la hora del servidor está dentro del intervalo configurado:
inicio incluido y fin excluido. La apertura y la publicación quedan auditadas;
no se realizan cambios automáticos de estado. El catálogo continúa siendo de
consulta después del fin del plazo mientras el período siga
`POSTULACION_ABIERTA`; abrir el período no habilita todavía el envío de
postulaciones.

Para probarlo desde Swagger, prepara una cuenta DOCENTE y su perfil, crea una
línea activa y un período con fechas que incluyan el momento actual. Registra y
publica un tema, abre el período y consulta el catálogo con un estudiante
habilitado. Para preparar temas antes de abrir, publícalos mientras el período
sigue en `BORRADOR`. También puedes resolver un condicionado pendiente después
de abrir el período, antes de la fecha de inicio de titulación. La migración
se aplica en `titulacion_dev` con `npm run db:prepare-auth`; no se insertan
temas de ejemplo.

Para probar el flujo desde Swagger, crea una cuenta con rol `ESTUDIANTE`, crea
su perfil usando `POST /estudiantes`, crea un período con `POST /periodos` y
registra su habilitación. Usa `admin@example.test` para las operaciones
administrativas y la cuenta importada para consultar `/me`. Aplica las
migraciones en `titulacion_dev` con `npm run db:prepare-auth`.

## Grupos e invitaciones

Con un período en `POSTULACION_ABIERTA` y dentro de su plazo, un estudiante
activo con perfil y habilitación `HABILITADO` (situación `PENDIENTE` o
`ADMITIDO`) crea un grupo con `POST /periodos/:periodoId/grupos`. El creador es
el representante. Solo este puede invitar con
`POST /periodos/:periodoId/grupos/:grupoId/invitaciones`; el destinatario ve
sus invitaciones en `GET /periodos/:periodoId/invitaciones/me` y las acepta,
rechaza o el representante cancela mediante las acciones documentadas en
Swagger. Al incorporarse el segundo estudiante el grupo pasa a `ACTIVO`.
`max_integrantes_default` del período limita el grupo y una aceptación no
reserva cupo. La pertenencia única por período se protege en PostgreSQL.

Las consultas `/grupos/me` y el detalle están limitados a integrantes activos
(ADMIN puede consultar todos los grupos). Las invitaciones vencidas se muestran
como `EXPIRADA`; la primera resolución posterior persiste el vencimiento y lo
audita. La pertenencia se conserva si cambia la situación académica del
estudiante, pero nuevas invitaciones y aceptaciones se bloquean mientras haya
integrantes incompatibles.

Durante el plazo de postulación, cualquier integrante puede salir mediante
`POST /periodos/:periodoId/grupos/:id/salir`, indicando un motivo. El
representante debe transferir primero el cargo si quedan compañeros; si queda
solo, su salida disuelve el grupo. El representante puede cambiarlo con
`POST /periodos/:periodoId/grupos/:id/cambiar-representante`, eligiendo un
integrante activo y elegible. Las invitaciones pendientes se cancelan al hacer
la transferencia y el nuevo representante puede enviar otras.

El representante puede disolver el grupo con
`POST /periodos/:periodoId/grupos/:id/disolver`. ADMIN puede hacer lo mismo,
retirar a un integrante con
`POST /periodos/:periodoId/grupos/:id/integrantes/:estudianteId/retirar` y
asignar un reemplazo al retirar al representante. ADMIN puede reorganizar
grupos con postulación abierta o cerrada hasta antes del inicio de titulación;
las acciones de estudiantes solo están disponibles dentro del plazo. Cada
retiro conserva fecha, motivo e historial. Quien salga podrá crear o integrar
otro grupo, pero no regresar al mismo.

Para probarlo, importa dos estudiantes en un período en borrador, abre el plazo,
inicia sesión con la cuenta del primer estudiante, crea el grupo e invita al
segundo. Lee su clave temporal en Mailpit, establece la contraseña personal,
acepta la invitación y verifica `/grupos/me` con ambas cuentas.

La integridad de los estados de grupo y las salidas, transferencias y
disoluciones se comprueban con `npm run db:verify-grupos` en un esquema
temporal aislado.

## Postulaciones individuales y grupales

Con un período `POSTULACION_ABIERTA` dentro de las fechas, ADMIN publica un
tema y cada estudiante habilitado puede registrar `POST /periodos/:periodoId/postulaciones`
con `tema_id` y modalidad `INDIVIDUAL` o `GRUPAL`. Para postular
individualmente debe estar fuera de todo grupo activo del período. Para la
modalidad grupal, debe actuar el representante de un grupo `ACTIVO` con al
menos dos integrantes; el backend cuenta la composición y vuelve a comprobar
la habilitación de todos. Los condicionados con situación `PENDIENTE` sí pueden
participar.

Las solicitudes comienzan en `PENDIENTE`. ADMIN y DOCENTE pueden consultar el
listado (cada docente solo ve solicitudes dirigidas a sus temas); el estudiante
consulta las suyas en `/periodos/:periodoId/postulaciones/me`. El detalle está
limitado a ADMIN, proponente y participantes. La respuesta muestra la situación
académica vigente de cada participante, no datos de contacto ni SSO.

El titular individual o representante puede cancelar con un motivo mediante
`POST /periodos/:periodoId/postulaciones/:id/cancelar` durante el plazo. ADMIN
puede hacerlo con postulaciones abiertas o cerradas antes del inicio de
titulación. La cancelación conserva la fila y su auditoría, libera la
postulación activa y permite crear otra solicitud; no reabre la composición de
un grupo.

La primera postulación grupal congela permanentemente sus integrantes e
invitaciones: no se podrá añadir ni retirar miembros, salir o disolver el grupo.
Se permite transferir la representación entre los mismos integrantes. Un
grupo puede registrar nuevas postulaciones con esa misma composición, incluso
al mismo tema después de cancelar la anterior. Una postulación individual
activa impide crear grupos o aceptar invitaciones. Al postular se conserva una
lista ordenada de docentes habilitados para tutoría. Aún no se evalúan ni
aceptan postulaciones ni se comprueba disponibilidad por asignaciones; esas
etapas quedan pendientes.

Para una prueba manual, prepara un tema publicado y un período actualmente
abierto, con dos estudiantes habilitados. Como primer estudiante, registra y
cancela una postulación individual; luego crea el grupo, invita al segundo
estudiante y acepta la invitación desde su cuenta. El representante registra la
postulación `GRUPAL` con `tutores_propuestos` en el orden de preferencia;
consulta el resultado desde `/me` en ambas cuentas y
comprueba `composicion_cerrada: true` en el grupo. Si cancela la solicitud, la
composición seguirá cerrada, aunque el mismo grupo podrá volver a postular.

La migración se aplica en `titulacion_dev` con `npm run db:prepare-auth`.
`npm run db:verify-postulaciones`
comprueba la migración, las restricciones, las operaciones concurrentes, la
integración con grupos/invitaciones y la reversión protegida en un esquema
temporal aislado; no crea postulaciones en el esquema local.

## Tutores propuestos

Antes de postular, el docente debe tener perfil, cuenta activa con rol `DOCENTE` y `habilitado_tutoria=true`. Consulta candidatos con `GET /periodos/:periodoId/temas/:temaId/tutores-disponibles`; el proponente del tema aparece primero si está habilitado. Al registrar una postulación, envía el arreglo ordenado `tutores_propuestos` junto con `tema_id` y `modalidad`. Por ejemplo:

```json
{
  "tema_id": "UUID-del-tema-publicado",
  "modalidad": "INDIVIDUAL",
  "tutores_propuestos": [
    "UUID-del-docente-preferido",
    "UUID-del-segundo-docente"
  ]
}
```

Las preferencias no se pueden editar ni borrar y no constituyen asignación. Se consultan en `GET /periodos/:periodoId/postulaciones/:id/tutores-propuestos`. Si una postulación existente quedó sin propuestas, el titular o representante puede completarlas una sola vez mediante `POST /periodos/:periodoId/postulaciones/:id/tutores-propuestos`, durante el plazo y mientras siga `PENDIENTE`. La comprobación de migración, restricciones, concurrencia y reversión protegida se ejecuta con `npm run db:verify-tutores-propuestos` en un esquema aislado.

La migración se aplica en `titulacion_dev` con `npm run db:prepare-auth`. No crea tutores ni postulaciones de ejemplo.

## Cierre de postulaciones y conflictos

Cuando haya vencido `fecha_fin_postulacion`, ADMIN cierra el período mediante
`POST /periodos/:id/cerrar-postulacion`. El cierre es manual y queda auditado;
no cambia las postulaciones ni inicia la titulación. Los condicionados todavía
pendientes pueden resolverse después del cierre y antes del inicio de
titulación.

ADMIN consulta los temas con competencia en `GET
/periodos/:periodoId/conflictos` y sus candidaturas en `GET
/periodos/:periodoId/temas/:temaId/conflicto`. La elegibilidad se calcula con
los participantes y habilitaciones actuales. Para registrar la decisión de la
comisión, usa `POST
/periodos/:periodoId/temas/:temaId/conflicto/resolver` con criterio,
justificación, puntajes si aplican y todas las postulaciones elegibles. El
sistema conserva la ganadora y sus participantes hasta que ADMIN formalice la
asignación.

La migración se aplica en `titulacion_dev` con `npm run db:prepare-auth`.
`npm run db:verify-conflictos` verifica el cierre, la
detección con estudiantes condicionados, la resolución, auditoría y
reversibilidad en un esquema aislado.

Flujo manual: registra dos postulaciones elegibles al mismo tema, espera el
vencimiento del período, ciérralo desde Swagger, consulta las candidaturas y
registra la decisión de la comisión. Las rutas solo están disponibles para
ADMIN.

## Asignación definitiva de temas

Con el período en `POSTULACION_CERRADA`, ADMIN asigna un tema desde la
postulación con `POST /periodos/:periodoId/postulaciones/:id/asignar-tema` y
un `motivo`. Si hay una sola candidatura elegible, puede asignarla
directamente; si existe una competencia registrada, solo puede asignar a la
ganadora y las candidaturas actuales deben estar cubiertas por esa resolución.
La operación acepta la postulación ganadora, crea la asignación vigente, cambia
el tema a `ASIGNADO`, rechaza las demás candidaturas a ese tema y guarda
historial y auditoría en una transacción.

ADMIN y el docente proponente consultan `GET
/periodos/:periodoId/asignaciones-tema`; el estudiante consulta sus asignaciones
actuales e históricas en `GET
/periodos/:periodoId/asignaciones-tema/me`. El detalle está disponible para
ADMIN, proponente y participantes. Las respuestas del catálogo de temas
incluyen `disponible` y `postulaciones_abiertas`.

Si ADMIN resuelve un condicionado como `NO_ADMITIDO`, el sistema anula dentro
de la misma transacción su asignación individual o la asignación completa del
grupo, anula la postulación aceptada y devuelve el tema a `PUBLICADO`. Se
conservan el grupo, sus integrantes, las preferencias de tutor y la decisión de
conflicto. Después del inicio de titulación, esta resolución tardía requiere
que el período esté cerrado; `ADMITIDO` debe registrarse antes de esa fecha.

La migración añade la tabla `asignacion_tema` y amplía las transiciones
protegidas de postulaciones. Confirma `DB_SCHEMA=titulacion_dev`, revisa las
migraciones pendientes con `npm run migration:show` y aplícalas con
`npm run migration:run`. No se generan asignaciones de ejemplo.
`npm run db:verify-asignaciones-tema` comprueba conflictos, asignación
concurrente, auditoría y anulación por `NO_ADMITIDO` en un esquema temporal.

## Configuración de carga tutorial

ADMIN configura el máximo de trabajos por docente para cada período con
`POST /periodos/{periodoId}/config-carga-tutorial`. Enviar `docente_id: null`
(o no enviarlo) crea el límite global; indicar el UUID de un perfil docente
crea un límite específico. El máximo y `bloquear_al_superar` son decisiones
administrativas, sin valores predeterminados académicos. El perfil específico
prevalece sobre el global en ambos campos. La consulta efectiva está disponible
para ADMIN por docente y para DOCENTE sobre su propio perfil; si no hay límite
aplicable, devuelve `SIN_CONFIGURACION` y `configuracion: null`.

ADMIN puede listar y editar configuraciones mientras el período no esté
ARCHIVADO. No se eliminan físicamente; toda alta y cambio efectivo queda
auditado. Todavía no se cuentan tutorías ni se asignan tutores: esa lógica se
incorporará con las asignaciones definitivas y requerirá una configuración
aplicable.

Después de confirmar `DB_SCHEMA=titulacion_dev`, revisa y aplica la migración
explícitamente con `npm run migration:show` y `npm run migration:run`. El
verificador `npm run db:verify-carga-tutorial` prueba prioridad, restricciones,
unicidad concurrente, auditoría atómica y reversión en un esquema temporal; no
crea configuraciones en `titulacion_dev`.

## Asignación definitiva y reemplazo de tutores

Con el período en `POSTULACION_CERRADA` o `EN_CURSO`, ADMIN puede asignar un
tutor propuesto o un docente habilitado para tutoría mediante
`POST /periodos/{periodoId}/asignaciones-tema/{id}/asignar-tutor`. Para cambiarlo,
usa `POST /periodos/{periodoId}/asignaciones-tutor/{id}/reemplazar` e indica el
nuevo docente y el motivo. Cada trabajo cuenta como una tutoría y requiere una
configuración de carga aplicable. El modo advertir permite guardar e informa el
exceso; el modo bloquear rechaza la operación. Las asignaciones anteriores se
conservan en el historial.

DOCENTE consulta su carga en `GET
/periodos/{periodoId}/carga-tutorial/me`; ADMIN puede consultar cualquier perfil
docente. El listado y las consultas propias de asignaciones incluyen registros
vigentes, reemplazados y anulados.

La migración se comprueba en un esquema temporal mediante
`npm run db:verify-asignaciones-tutor`.

## Plantillas PAT por período

ADMIN publica una versión con `POST
/periodos/{periodoId}/plantillas-pat`, enviando los campos `version` y `archivo`
como `multipart/form-data`. Se admiten PDF y DOCX de hasta 10 MiB. La publicación
activa la versión nueva y conserva las anteriores; el período debe existir y no
estar archivado. La versión exacta no se puede repetir dentro del período.

ADMIN consulta el historial con `GET /periodos/{periodoId}/plantillas-pat` y
descarga cualquier versión mediante `GET
/periodos/{periodoId}/plantillas-pat/{id}/descarga`. ADMIN y estudiantes
habilitados pueden consultar `GET
/periodos/{periodoId}/plantillas-pat/vigente` y solicitar su descarga en `GET
/periodos/{periodoId}/plantillas-pat/vigente/descarga`. La descarga entrega una
URL privada temporal, válida por cinco minutos. El estudiante no necesita una
asignación de tema para obtenerla.

Después de confirmar `DB_SCHEMA=titulacion_dev`, revisa y aplica explícitamente
las migraciones pendientes con `npm run migration:show` y `npm run migration:run`.
`npm run db:verify-plantillas-pat` comprueba unicidad, publicaciones
concurrentes, protección del período archivado y reversión protegida en un
esquema temporal. La aplicación no publica plantillas de ejemplo.

## Carga y versionado del PAT

El titular de un trabajo individual o el representante actual de un grupo puede
entregar una versión con `POST
/periodos/{periodoId}/asignaciones-tema/{asignacionId}/documentos-pat`, enviando
`plantilla_id` y `archivo` como `multipart/form-data`. La asignación de tema debe
seguir vigente, el período estar en `POSTULACION_CERRADA` o `EN_CURSO`, y la
plantilla seleccionada debe continuar activa. Se admiten PDF y DOCX válidos de
hasta 10 MiB. Cada carga recibe una versión consecutiva y SHA-256; los archivos
anteriores se conservan y no pueden alterarse ni eliminarse.

ADMIN, los integrantes del trabajo y su tutor vigente pueden consultar el
historial en `GET .../documentos-pat`, la última versión en `GET
.../ultima`, y descargar la última o una versión histórica mediante las rutas
`/descarga`. Las URL firmadas duran cinco minutos. Cada versión inicia como
`PENDIENTE` y ADMIN puede revisarla una sola vez en `POST
.../documentos-pat/{documentoId}/revision` con resultado `APROBADO`, `OBSERVADO`
o `RECHAZADO`. Observar o rechazar exige observaciones; quienes tengan acceso
al trabajo pueden leer la revisión con `GET
.../documentos-pat/{documentoId}/revision`. Los metadatos incluyen `revision` y
`detalle_revision`.

Después de la primera entrega, solo se admite una nueva versión cuando la última
fue `OBSERVADO` o `RECHAZADO`. Una versión pendiente o aprobada bloquea otra
carga. ADMIN puede revisar versiones antiguas aún no revisadas; ese resultado
no cambia la situación de la versión más reciente. Revisiones, observaciones y
versiones anteriores se conservan como historial.

Las revisiones nuevas requieren período `POSTULACION_CERRADA` o `EN_CURSO` y
asignación de tema vigente. Las consultas históricas continúan disponibles
después del archivo o anulación, aunque no se aceptan revisiones nuevas.

El flujo de prueba es: entregar un PAT, consultarlo como ADMIN, registrar una
observación, leerla con la cuenta estudiante, cargar una corrección y aprobar
esa versión. La revisión no cambia automáticamente el estado del tema, período
ni asignación.

La migración se ejecuta explícitamente tras confirmar
`DB_SCHEMA=titulacion_dev`. `npm run db:verify-documentos-pat` verifica la
migración y sus restricciones en un esquema temporal; no carga documentos de
ejemplo. El barrido de archivos fallidos conserva solicitudes en PostgreSQL y
reintenta aunque Redis no esté disponible, verificando que el objeto no esté
referenciado antes de eliminarlo.

La migración de revisiones se aplica explícitamente con `npm run migration:run`
tras confirmar `DB_SCHEMA=titulacion_dev`. `npm run db:verify-revisiones-pat`
comprueba las versiones históricas, reglas de corrección, revisiones únicas e
inmutables, concurrencia, auditoría atómica y reversión protegida en un esquema
temporal aislado.

## Verificación

```powershell
npm run lint
npm run test
npm run test:e2e
npm run build
npx tsc --noEmit --incremental false
```

Las pruebas cubren configuración, validación DTO, autenticación propia,
primer acceso, cookies y origen/CSRF, permisos, altas y consultas de usuarios,
perfiles, períodos e habilitaciones, resolución de condicionados, apertura de
período, publicación y visibilidad del catálogo, rutas y DTO de
grupos/invitaciones, permisos, auditoría, duplicados, filtros, paginación,
Swagger, parser XLSX y compatibilidad de `GET /`.

Las pruebas HTTP sustituyen `DatabaseModule` por un módulo de pruebas y usan
variables ficticias. Pueden ejecutarse sin PostgreSQL y no utilizan la
contraseña del `.env` local. La conexión real se verifica con `npm run db:check`;
las migraciones de usuarios y perfiles, sus restricciones y las altas
concurrentes se comprueban con `npm run db:verify-perfiles`; para períodos se
usa `npm run db:verify-periodos`; para habilitados, lotes y auditoría se usa
`npm run db:verify-habilitados`. Estos comandos operan en esquemas temporales
aislados. El catálogo global y sus restricciones, altas concurrentes,
auditoría atómica y reversión protegida se comprueban con
`npm run db:verify-lineas`.
Los temas, su historial, restricciones, transiciones concurrentes de apertura
y publicación, atomicidad de auditoría y reversión protegida se comprueban con
`npm run db:verify-temas`.
Grupos, pertenencia única concurrente, cupo máximo, activación, auditoría y
reversión protegida se comprueban con `npm run db:verify-grupos` en un esquema
temporal aislado.
Asignaciones de tutores, carga concurrente y reemplazos se comprueban con
`npm run db:verify-asignaciones-tutor`; plantillas PAT, versiones únicas y
publicaciones concurrentes se comprueban con `npm run db:verify-plantillas-pat`.
