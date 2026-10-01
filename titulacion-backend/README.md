# Backend del Sistema de Gestión del Proceso de Titulación

API REST con NestJS 12 y TypeScript, organizada como un monolito modular.
Las reglas del proyecto están en `AGENTS.md`.

## Estado actual

Etapas implementadas: configuración por variables de entorno, validación HTTP
global, Swagger/OpenAPI y conexión a PostgreSQL mediante TypeORM.
`GET /` conserva la respuesta `Hello World!` de la plantilla inicial.

Se utiliza PostgreSQL 17 para aprovechar la instalación local existente, en
lugar del PostgreSQL 16 indicado en el C4. La base de desarrollo es
`titulacion_bd`; las tablas del DER se incorporarán junto con cada módulo.
La autenticación institucional y los módulos de titulación siguen pendientes.
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
| `PORT`            | Entero decimal entre `1` y `65535`  | `3000`                                            |
| `SWAGGER_ENABLED` | Exactamente `true` o `false`        | `true` fuera de producción; `false` en producción |
| `DB_HOST`         | Host no vacío                       | `localhost`                                       |
| `DB_PORT`         | Entero decimal entre `1` y `65535`  | `5432`                                            |
| `DB_USERNAME`     | Usuario PostgreSQL no vacío         | Obligatorio                                       |
| `DB_PASSWORD`     | Contraseña no vacía                 | Obligatorio                                       |
| `DB_NAME`         | Nombre de base de datos no vacío    | Obligatorio                                       |

Un valor vacío o inválido detiene el arranque e identifica la variable afectada,
sin incluir su valor en el error. `PORT` se convierte a número y
`SWAGGER_ENABLED` a booleano antes de usarlos. `DB_PORT` también se convierte
a número. Las credenciales de base de datos son obligatorias en todos los
entornos, incluidas las pruebas, que usan valores ficticios.

`.env.example` habilita Swagger explícitamente. Para deshabilitarlo, usa
`SWAGGER_ENABLED=false`. Para aplicar el comportamiento automático según
`NODE_ENV`, elimina o comenta la línea `SWAGGER_ENABLED`.

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

# Aplicar migraciones pendientes
npm run migration:run

# Revertir únicamente la última migración aplicada, ejecutando su down()
npm run migration:revert
```

Todavía no hay entidades ni migraciones de dominio. No es necesario ejecutar
`migration:create` ahora. Si no hay diferencias de esquema, `migration:generate`
no genera archivos y termina con código `1`; eso no indica un fallo de conexión.
Revisa el SQL generado y el DER antes de aplicar una migración.

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

Las futuras entradas HTTP deben utilizar clases DTO con decoradores de
`class-validator`. La validación global transforma el body a su clase DTO y
rechaza datos inválidos o propiedades no declaradas con HTTP `400`.
Las conversiones de campos deben declararse explícitamente con
`class-transformer` cuando correspondan. Las reglas de negocio pertenecen a
los servicios de cada módulo.

Swagger documenta la API existente; todavía no hay login ni endpoints del
proceso de titulación. El controlador para comprobar DTO existe únicamente
en las pruebas, no en la aplicación.

## Verificación

```powershell
npm run lint
npm run test
npm run test:e2e
npm run build
```

Las pruebas cubren los valores predeterminados, configuración inválida,
validación de DTO, transformación, rechazo de propiedades adicionales,
Swagger habilitado/deshabilitado y compatibilidad de `GET /`.

Las pruebas HTTP sustituyen `DatabaseModule` por un módulo de pruebas y usan
variables ficticias. Pueden ejecutarse sin PostgreSQL y no utilizan la
contraseña del `.env` local. La conexión real se verifica con `npm run db:check`.
