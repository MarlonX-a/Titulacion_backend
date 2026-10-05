# Backend del Sistema de Gestión del Proceso de Titulación

API REST con NestJS 12 y TypeScript, organizada como un monolito modular.
Las reglas del proyecto están en `AGENTS.md`.

## Estado actual

Etapas implementadas: configuración por variables de entorno, validación HTTP
global, Swagger/OpenAPI, conexión a PostgreSQL mediante TypeORM y validación
base de autenticación JWT institucional mediante JWKS.
`GET /` conserva la respuesta `Hello World!` de la plantilla inicial. Ya están
implementadas las cuentas de usuario y los perfiles básicos de estudiante y
docente, además de la configuración de períodos en estado `BORRADOR` y la
habilitación de estudiantes por período con resolución de condicionados.
Importaciones Excel y los módulos posteriores continúan para etapas posteriores.

Se utiliza PostgreSQL 17 para aprovechar la instalación local existente, en
lugar del PostgreSQL 16 indicado en el C4. La base de desarrollo es
`titulacion_bd`; las tablas del DER se incorporarán junto con cada módulo.
El proveedor institucional real y los módulos del proceso siguen pendientes.
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

| Variable          | Valores permitidos                  | Predeterminado si se omite                        |
| ----------------- | ----------------------------------- | ------------------------------------------------- |
| `NODE_ENV`        | `development`, `test`, `production` | `development`                                     |
| `AUTH_MODE`       | `institutional`, `local`            | `institutional`                                   |
| `PORT`            | Entero decimal entre `1` y `65535`  | `3000`                                            |
| `SWAGGER_ENABLED` | Exactamente `true` o `false`        | `true` fuera de producción; `false` en producción |
| `DB_HOST`         | Host no vacío                       | `localhost`                                       |
| `DB_PORT`         | Entero decimal entre `1` y `65535`  | `5432`                                            |
| `DB_SCHEMA`       | Identificador de esquema PostgreSQL | `public`                                          |
| `DB_USERNAME`     | Usuario PostgreSQL no vacío         | Obligatorio                                       |
| `DB_PASSWORD`     | Contraseña no vacía                 | Obligatorio                                       |
| `DB_NAME`         | Nombre de base de datos no vacío    | Obligatorio                                       |
| `OIDC_ISSUER`     | Emisor JWT HTTPS                    | Obligatorio en producción; opcional en desarrollo |
| `OIDC_AUDIENCE`   | Audiencia JWT de esta API           | Obligatorio en producción; opcional en desarrollo |
| `JWKS_URI`        | Dirección HTTPS del JWKS            | Obligatorio en producción; opcional en desarrollo |
| `LOCAL_AUTH_PASSWORD` | Clave de las cuentas de prueba     | Obligatoria solo con `AUTH_MODE=local`            |

Un valor vacío o inválido detiene el arranque e identifica la variable afectada,
sin incluir su valor en el error. `PORT` se convierte a número y
`SWAGGER_ENABLED` a booleano antes de usarlos. `DB_PORT` también se convierte
a número. Las credenciales de base de datos son obligatorias en todos los
entornos, incluidas las pruebas, que usan valores ficticios.

La autenticación se configura con `OIDC_ISSUER`, `OIDC_AUDIENCE` y `JWKS_URI`.
En desarrollo y pruebas pueden quedar omitidas hasta que la universidad
proporcione los datos; si se configura una, deben definirse las tres. La
aplicación permite HTTP únicamente para servicios en localhost durante
desarrollo y pruebas. En producción exige URLs HTTPS y las tres variables.
Los comentarios de `.env.example` muestran dónde añadir esos valores sin
inventar los del proveedor.

`.env.example` habilita Swagger explícitamente. Para deshabilitarlo, usa
`SWAGGER_ENABLED=false`. Para aplicar el comportamiento automático según
`NODE_ENV`, elimina o comenta la línea `SWAGGER_ENABLED`.

### Inicio de sesión local para pruebas

El modo institucional es el predeterminado. Para probar las rutas protegidas
sin el proveedor de la universidad, configura en tu `.env`:

```dotenv
AUTH_MODE=local
DB_SCHEMA=local_demo
LOCAL_AUTH_PASSWORD=escribe-una-clave-de-prueba-de-16-caracteres
```

La clave debe tener al menos 16 caracteres. En modo local, NestJS escucha solo
en `127.0.0.1` y exige PostgreSQL en una dirección local. Este modo no inicia
en producción, no admite configuración OIDC simultánea y usa el esquema
`local_demo` para mantener aisladas las cuentas ficticias.

Prepara explícitamente el esquema y las cuatro cuentas de prueba:

```powershell
npm run auth:local:setup
npm run start:dev
```

En [Swagger](http://localhost:3000/docs), ejecuta `POST /auth/local/login` con
uno de estos correos y la clave común de `LOCAL_AUTH_PASSWORD`:

| Cuenta | Correo |
| --- | --- |
| Administrador | `admin@example.test` |
| Docente | `docente@example.test` |
| Estudiante | `estudiante@example.test` |
| Segundo estudiante | `estudiante2@example.test` |

Copia el `access_token` de la respuesta y pégalo en **Authorize** como Bearer
token. Así puedes consultar el listado de usuarios como ADMIN y el perfil
propio con las otras cuentas. Los tokens duran 15 minutos y las claves se
regeneran al reiniciar la aplicación, por lo que debes iniciar sesión de nuevo.

Para volver al modo institucional, cambia `AUTH_MODE=institutional`, usa
`DB_SCHEMA=public` y elimina `LOCAL_AUTH_PASSWORD`. Las cuentas ficticias
permanecerán en `local_demo`; no se copian a `public`.

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

# Aplicar migraciones pendientes en la base de desarrollo
npm run migration:run

# Registrar el primer administrador cuando tengas su sub institucional
npm run usuario:bootstrap-admin

# Preparar exclusivamente las cuentas locales de pruebas
npm run auth:local:setup

# Revertir únicamente la última migración aplicada, ejecutando su down()
npm run migration:revert
```

Las migraciones crean `usuario`, `estudiante`, `docente`, `periodo_titulacion`,
`lote_importacion`, `estudiante_habilitado`, `grupo`, `grupo_integrante`,
`invitacion` y la tabla base `auditoria`.
`db:verify-perfiles`
genera un esquema temporal con nombre aleatorio, comprueba restricciones,
unicidad, la concurrencia del primer ADMIN y de la vinculación de perfiles, la
preparación idempotente de cuentas locales y la protección al revertir con
datos; al terminar elimina únicamente ese esquema temporal. El nombre anterior
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

Las rutas de la API requieren `Authorization: Bearer <token>` salvo aquellas
marcadas como públicas. `GET /` continúa siendo público. `GET /auth/me` valida
firma RS256, emisor, audiencia, expiración y subject mediante las claves del
JWKS configurado, y devuelve `{ subject, issuer }`. Aún no representa una cuenta
de usuario ni determina roles.

Cuando la autenticación está omitida en desarrollo, una ruta protegida responde
`401` si no recibe token y `503` si recibe uno, porque todavía no existe una
configuración institucional para verificarlo. Un token incorrecto responde
`401`; si no es posible consultar las claves necesarias, responde `503`. Nunca
se registran tokens ni se devuelven errores internos del proveedor.

El modo local usa `POST /auth/local/login`, disponible únicamente con
`AUTH_MODE=local`. Sus tokens RS256 duran 15 minutos y sus claves cambian al
reiniciar. El modo exige `DB_SCHEMA=local_demo`, utiliza las cuatro cuentas
ficticias descritas arriba y no acepta tokens institucionales ni roles enviados
por el cliente. En modo institucional, la ruta responde 404 y no aparece en
Swagger.

## Usuarios

Después de aplicar la migración, `POST /usuarios` permite a un ADMIN activo
registrar una cuenta; `GET /usuarios` lista cuentas paginadas y
`GET /usuarios/me` devuelve la cuenta activa vinculada al `sub` del token.
Los roles confiables se leen desde PostgreSQL y no desde el JWT. El email se
normaliza a minúsculas. `ultimo_acceso` registra la última solicitud autorizada
a la API, no un evento del proveedor de inicio de sesión.

Para crear el primer ADMIN ejecuta `npm run usuario:bootstrap-admin` en una
terminal interactiva, después de aplicar la migración. El comando pregunta por
el identificador institucional y solo permite una inicialización si todavía no
existe una cuenta ADMIN. No lo ejecutes con un `sub` inventado: la cuenta debe
coincidir con la identidad que enviará el proveedor institucional.

Las respuestas de usuario omiten `id_externo_sso`; el campo se envía al crear
la cuenta y se usa internamente para vincularla con el token.

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

Aplicar la nueva migración explícitamente después de comprobar que
`DB_SCHEMA=local_demo`, con `npm run migration:run`. No se insertan líneas de
ejemplo.

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
se aplica explícitamente con `npm run migration:run` después de confirmar
`DB_SCHEMA=local_demo`; no se insertan temas de ejemplo.

Para probar el flujo desde Swagger, crea una cuenta con rol `ESTUDIANTE`, crea
su perfil usando `POST /estudiantes`, crea un período con `POST /periodos` y
registra su habilitación. Usa `admin@example.test` para las operaciones
administrativas y `estudiante@example.test` para consultar `/me`. Aplica la
migración explícitamente después de verificar que `DB_SCHEMA=local_demo`.

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
integrantes incompatibles. En esta etapa todavía no se puede salir, cambiar de
representante ni disolver un grupo.

Para probarlo, prepara las cuatro cuentas con `npm run auth:local:setup`, crea
explícitamente los perfiles de `estudiante@example.test` y
`estudiante2@example.test`, habilita a ambos en un período con máximo de al
menos dos integrantes, abre la postulación y entra en Swagger con el primer
estudiante. Crea el grupo e invita al segundo; inicia sesión como el segundo,
consulta sus invitaciones, acepta y verifica `/grupos/me` con ambas cuentas.
La preparación local solo crea cuentas; no genera perfiles, habilitaciones,
grupos ni invitaciones.

## Verificación

```powershell
npm run lint
npm run test
npm run test:e2e
npm run build
npx tsc --noEmit --incremental false
```

Las pruebas cubren configuración, validación DTO, autenticación con JWKS local,
permisos, altas y consultas de usuarios, perfiles, períodos e habilitaciones,
resolución de condicionados, apertura de período, publicación y visibilidad del
catálogo, rutas y DTO de grupos/invitaciones, permisos, auditoría, duplicados,
filtros, paginación, Swagger y compatibilidad de `GET /`.

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
