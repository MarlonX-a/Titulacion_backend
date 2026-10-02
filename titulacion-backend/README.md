# Backend del Sistema de Gestión del Proceso de Titulación

API REST con NestJS 12 y TypeScript, organizada como un monolito modular.
Las reglas del proyecto están en `AGENTS.md`.

## Estado actual

Etapas implementadas: configuración por variables de entorno, validación HTTP
global, Swagger/OpenAPI, conexión a PostgreSQL mediante TypeORM y validación
base de autenticación JWT institucional mediante JWKS.
`GET /` conserva la respuesta `Hello World!` de la plantilla inicial.

Se utiliza PostgreSQL 17 para aprovechar la instalación local existente, en
lugar del PostgreSQL 16 indicado en el C4. La base de desarrollo es
`titulacion_bd`; las tablas del DER se incorporarán junto con cada módulo.
El proveedor institucional real, los perfiles de estudiante/docente y módulos
del proceso siguen pendientes. La integración de Observe permanece desactivada.

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

Prepara explícitamente el esquema y las tres cuentas de prueba:

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

# Comprobar la migración de usuarios en un esquema temporal aislado
npm run db:verify-usuarios

# Aplicar migraciones pendientes en la base de desarrollo
npm run migration:run

# Registrar el primer administrador cuando tengas su sub institucional
npm run usuario:bootstrap-admin

# Preparar exclusivamente las cuentas locales de pruebas
npm run auth:local:setup

# Revertir únicamente la última migración aplicada, ejecutando su down()
npm run migration:revert
```

La migración inicial crea la entidad `usuario`. `db:verify-usuarios` genera un
esquema temporal con nombre aleatorio, comprueba restricciones, unicidad, la
concurrencia del primer ADMIN, la preparación idempotente de cuentas locales y
la protección al revertir con datos; al terminar elimina únicamente ese esquema
temporal. Para crear la tabla real de desarrollo,
ejecuta `migration:run` explícitamente. Si no hay diferencias de esquema,
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
reiniciar. El modo exige `DB_SCHEMA=local_demo`, utiliza las tres cuentas
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

## Verificación

```powershell
npm run lint
npm run test
npm run test:e2e
npm run build
```

Las pruebas cubren configuración, validación DTO, autenticación con JWKS local,
permisos, altas, duplicados, paginación, Swagger y compatibilidad de `GET /`.

Las pruebas HTTP sustituyen `DatabaseModule` por un módulo de pruebas y usan
variables ficticias. Pueden ejecutarse sin PostgreSQL y no utilizan la
contraseña del `.env` local. La conexión real se verifica con `npm run db:check`;
la migración de usuarios, sus restricciones y la inicialización concurrente se
comprueban con `npm run db:verify-usuarios`.
