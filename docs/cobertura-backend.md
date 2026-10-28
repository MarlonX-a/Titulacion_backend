# Matriz de cobertura del backend

Revisión estática del código y las pruebas versionadas, actualizada para la
etapa de archivo de períodos. `VERIFICADO` indica que hay una prueba automatizada
o verificación reproducible relacionada; `PARCIAL` indica que hay implementación,
pero la evidencia no cubre todo el requisito o su operación real; `PENDIENTE`
identifica trabajo no implementado o sin evidencia; `SUSTITUIDO_POR_DECISION`
registra un cambio de alcance aprobado. La matriz no afirma que los servicios de
producción estén desplegados.

## Requisitos funcionales

| ID | Cobertura / referencia principal | Evidencia disponible | Estado | Brecha / siguiente acción |
| --- | --- | --- | --- | --- |
| RF-01 | Grupos: alta y representante automático | `test/grupos-invitaciones.e2e-spec.ts`, `db:verify-grupos` | VERIFICADO | Añadir recorrido integral autenticado con datos persistidos. |
| RF-02 | Invitaciones, estados y vencimiento | `src/invitaciones`, `db:verify-grupos` | PARCIAL | Ampliar evidencia HTTP para cada resolución y expiración concurrente. |
| RF-03 | Pertenencia única y composición cerrada | Restricciones de grupos/postulaciones, `db:verify-grupos` | PARCIAL | Probar carreras entre cada cambio de composición y postulación. |
| RF-04 | Postulación grupal y rango del tema | `src/postulaciones`, `db:verify-postulaciones` | PARCIAL | Completar HTTP de rango y concurrencia con servicios reales. |
| RF-05 | Catálogo estudiantil con filtros | `src/temas/temas.controller.ts`, `src/temas/temas.service.ts` | PARCIAL | Añadir pruebas de contrato por rol, filtros y disponibilidad. |
| RF-06 | Detalle y resúmenes de tema | DTO de temas y Swagger | PARCIAL | Verificar campos y privacidad en pruebas HTTP. |
| RF-07 | Disponibilidad y postulaciones abiertas | Servicio de temas consulta asignaciones y postulaciones | PARCIAL | Cubrir concurrencia y exactitud del contador. |
| RF-08 | Postulación individual/grupal y plazo | `src/postulaciones`, `db:verify-postulaciones` | PARCIAL | Completar límites temporales y carreras con invitaciones/asignaciones. |
| RF-09 | Rechazo de postulaciones incompatibles | Validación y restricciones de postulaciones | PARCIAL | Consolidar casos de integración para elegibilidad y duplicados. |
| RF-10 | Preferencias ordenadas de tutor | `src/postulaciones`, `db:verify-tutores-propuestos` | PARCIAL | Extender pruebas de reemplazo idempotente y prioridades simultáneas. |
| RF-11 | Proponente sugerido primero | Consulta de tutores disponibles y orden de propuestas | PARCIAL | Añadir aserción HTTP que pruebe prioridad y bandera de proponente. |
| RF-12 | Descargar plantilla PAT vigente | `src/plantillas-pat`, `db:verify-plantillas-pat` | PARCIAL | Verificar descarga firmada integrada con SeaweedFS en CI o entorno documentado. |
| RF-13 | Carga y versionado PAT | `src/documentos-pat`, `db:verify-documentos-pat` | PARCIAL | Mantener prueba integrada de almacenamiento y hashes en entorno real. |
| RF-14 | Correcciones con versiones e historial | `src/revisiones-pat`, `db:verify-revisiones-pat` | PARCIAL | Cubrir carga concurrente frente a revisión con servicios reales. |
| RF-15 | Seguimiento de estado del proceso | Endpoints propios de grupos, postulaciones y asignaciones | PARCIAL | Añadir una consulta consolidada de seguimiento si la interfaz la requiere. |
| RF-16 | Notificación en aplicación y correo | `src/notificaciones` (bandeja, contador y `POST /notificaciones/leer-todas` limitado al usuario actual), `db:verify-notificaciones` | PARCIAL | Ampliar pruebas de destinatarios y entrega SMTP real con Mailpit. |
| RF-17 | Crear, configurar, iniciar, cerrar y archivar períodos | `src/periodos`, verificadores de período e inicio y archivo; `GET /periodos/:id/resumen` (ADMIN, indicadores agregados en una consulta, `resumen-periodo.service.spec.ts`) y `condicionados_pendientes` por período solo para ADMIN (`consultas-agregadas.e2e-spec.ts`); reapertura POSTULACION_CERRADA → POSTULACION_ABIERTA (`REABRIR_POSTULACION`) y edición de la fecha fin en POSTULACION_CERRADA con prueba HTTP | PARCIAL | Completar pruebas HTTP autenticadas del ciclo entero y conservar historial. |
| RF-18 | Habilitados manuales/importados y resolución de ingreso | `src/habilitados` (respuestas ADMIN con correo, cédula, carrera, nivel y `resuelto_por`; candidatos de invitación sin datos personales, `habilitados.service.spec.ts`), `src/importaciones`, `db:verify-habilitados` | PARCIAL | Sincronización institucional no está integrada; validar Excel real al recibirlo. |
| RF-19 | Registrar/importar docentes | `src/docentes` (alta atómica cuenta+perfil, `PATCH /docentes/:id`), `src/importaciones` (plantilla XLSX propia de docentes), `db:verify-importacion-docentes`, `db:verify-usuarios` | PARCIAL | Alta, edición e importación implementadas con pruebas unitarias y HTTP; la importación no tiene prueba HTTP porque `ImportacionesModule` no se carga en e2e. Confirmar con la institución la cédula como clave inicial. |
| RF-20 | Registrar temas con referencias y rango | `src/temas`, `db:verify-temas` | PARCIAL | Aumentar pruebas HTTP con repositorios reales y referencias incompatibles. |
| RF-21 | Editar, publicar, cerrar y retirar con historial | `POST .../temas/:id/cerrar`, `/retirar` (motivo) y reapertura CERRADO → PUBLICADO por `/publicar`; historial, auditoría, `temas.service.spec.ts`, HTTP y `db:verify-postulaciones` | PARCIAL | Edición de temas publicados sigue fuera de alcance; cubrir carrera cierre/postulación en verificador aislado. |
| RF-22 | Consultar postulaciones por período/tema/estado | `src/postulaciones` (filtro `modalidad`; integrantes, habilitaciones y `tutores_propuestos` cargados en lote, `tutores-propuestos.service.spec.ts`), Swagger | PARCIAL | Ampliar filtros y autorización de recurso en HTTP. |
| RF-23 | Resolver competencia y guardar puntajes | `src/conflictos` (el listado incluye candidaturas con `grupo_nombre` y resolución, cargadas en lote), `db:verify-conflictos` | PARCIAL | Completar concurrencia y elegibilidad histórica en verificador aislado. |
| RF-24 | Asignar tema y anular por condición o manualmente | `src/asignaciones-tema` (incluye `POST .../asignaciones-tema/:id/anular` con causa y motivo, flujo compartido con la anulación por incumplimiento), `db:verify-asignaciones-tema` | PARCIAL | Validar todos los casos grupales y carreras con tutor vigente. |
| RF-25 | Cierre de disponibilidad y rechazo de candidaturas | Asignación y cierre/retiro manual de tema rechazan las postulaciones PENDIENTE y EN_CONFLICTO con auditoría y aviso; `db:verify-postulaciones` | PARCIAL | Ampliar verificación aislada con postulaciones EN_CONFLICTO y concurrencia con nuevas postulaciones. |
| RF-26 | Ver prioridades y proponente de tutores postulados | Endpoint de tutores propuestos | PARCIAL | Añadir prueba de contrato con proponente no habilitado. |
| RF-27 | Asignar y reemplazar tutor | `src/asignaciones-tutor`, `db:verify-asignaciones-tutor` | PARCIAL | Cubrir carga concurrente y rollback integral de historial/auditoría. |
| RF-28 | Prioridad visual del docente proponente | Orden del listado de tutores propuestos | PARCIAL | Comprobar orden en endpoint de asignación de tutor. |
| RF-29 | Configurar límites globales/específicos | `src/carga-tutorial` (incluye desactivación de límites específicos), `db:verify-carga-tutorial` | PARCIAL | Cobertura concurrente está aislada; ampliar HTTP de precedencia. |
| RF-30 | Advertir o bloquear exceso de carga | Persistencia centralizada de carga tutorial | PARCIAL | Probar escenarios de advertencia/bloqueo con asignaciones simultáneas. |
| RF-31 | Revisar cada PAT | `src/revisiones-pat`, bandeja `GET /periodos/:id/documentos-pat/ultimas` (ADMIN, última versión y revisión por asignación VIGENTE, `documentos-pat-periodo.spec.ts`), `db:verify-revisiones-pat` | PARCIAL | Revisar nombres de verificadores y ampliar resultados por versión. |
| RF-32 | Observaciones y consulta estudiantil | DTO y autorización de revisión PAT | PARCIAL | Añadir recorrido HTTP estudiante-ADMIN completo. |
| RF-33 | Publicar y versionar plantilla | `src/plantillas-pat`, verificador de plantillas | PARCIAL | Verificar persistencia de objeto y sustituciones concurrentes en SeaweedFS. |
| RF-34 | Trazabilidad completa | Auditoría compartida, historiales por dominio y `GET /auditoria` (ADMIN, paginado, filtros por entidad, acción, actor, fechas y texto libre); `auditoria-consulta.service.spec.ts`, HTTP `consultas-admin.e2e-spec.ts`, `db:verify-auditoria`. Historial de importaciones `GET /periodos/:id/importaciones/estudiantes` y `GET /importaciones/docentes` (incluye vencidas) | PARCIAL | Revisar que cada caso de uso relevante registre auditoría. |
| RF-35 | Generar siete reportes administrativos | `src/reportes`, `db:verify-exportaciones` | PARCIAL | Comprobar contenido contra conjuntos grandes y fixtures de cada tipo. |
| RF-36 | Exportar PDF/XLSX/CSV en segundo plano | `src/exportaciones`, BullMQ | PARCIAL | Ejecución integrada Redis/SeaweedFS aún depende del entorno local. |
| RF-37 | Consulta docente de temas y postulaciones | Rutas de temas y postulaciones con filtro docente | PARCIAL | Añadir prueba HTTP de aislamiento entre docentes. |
| RF-38 | Consultar tutorías asignadas | `src/asignaciones-tutor` | PARCIAL | Cobertura de autorización histórica y reemplazos por recurso. |
| RF-39 | Consultar carga tutorial frente al límite | `src/carga-tutorial`; `GET /periodos/:id/carga-tutorial` (ADMIN, todos los docentes con la misma regla de límite efectivo, sin consultas por docente, `carga-tutorial-persistencia.service.spec.ts`) | PARCIAL | Añadir prueba HTTP para configuración ausente y exceso de carga. |

## Requisitos no funcionales

| ID | Cobertura / decisión | Evidencia disponible | Estado | Brecha / siguiente acción |
| --- | --- | --- | --- | --- |
| RNF-01 | Autenticación propia aprobada; sustituye OIDC/LDAP | Auth por correo, Argon2id y claves RS256 | SUSTITUIDO_POR_DECISION | Documentar la aprobación institucional en artefactos del proyecto. |
| RNF-02 | TLS se configura en despliegue | Validación de configuración de producción | PARCIAL | Terminar proxy TLS y comprobar TLS 1.2+ en infraestructura productiva. |
| RNF-03 | Roles en cada operación protegida | Guard global y pruebas HTTP de auth | PARCIAL | Auditoría sistemática de rutas y permisos en matriz de seguridad. |
| RNF-04 | Autorización a nivel de recurso | Comprobaciones de pertenencia en servicios | PARCIAL | Completar pruebas cruzadas de usuario y recurso para cada endpoint. |
| RNF-05 | Cola para trabajo pesado | BullMQ para correo, importación y exportación | PARCIAL | Medir objetivo de 3 segundos bajo carga representativa. |
| RNF-06 | Concurrencia al abrir postulaciones | Restricciones y verificadores de dominio | PARCIAL | Ejecutar pruebas de carga con concurrencia definida por el equipo. |
| RNF-07 | Alta disponibilidad operativa | No se define en código de aplicación | PENDIENTE | Diseñar despliegue, mantenimiento y recuperación. |
| RNF-08 | PostgreSQL y restricciones relacionales | Migraciones y verificadores aislados | PARCIAL | Ejecutar todos los verificadores en CI y cerrar huecos detectados. |
| RNF-09 | Validación de PDF/DOCX por contenido | Validador compartido de archivos PAT | PARCIAL | Añadir corpus de archivos malformados y pruebas integradas. |
| RNF-10 | Colas asíncronas | BullMQ + Redis en correo, notificaciones y exportaciones | PARCIAL | Verificar reinicios y recuperación en entorno integrado. |
| RNF-11 | Copias y restauración de datos | No implementado por la API | PENDIENTE | Definir backups y ejecutar simulacro de restauración. |
| RNF-12 | S3/SeaweedFS y URL firmada | Almacenamiento privado y URLs temporales | PARCIAL | Comprobar política y restauración de objetos en operación. |
| RNF-13 | SHA-256 de documentos | Entidades y servicios PAT | VERIFICADO | Mantener prueba de comparación del hash del archivo descargado. |
| RNF-14 | Tamaño y obligatoriedad de archivos | Límites multipart y DTO/servicios | PARCIAL | Añadir pruebas de frontera del límite en integración. |
| RNF-15 | WCAG 2.1 AA | Requisito de frontend fuera de este repositorio | PENDIENTE | Verificar en el repositorio frontend. |
| RNF-16 | UI en español, móvil y mensajes claros | UI fuera del backend; API retorna errores en español | PARCIAL | Validar idioma, responsive y accesibilidad en frontend. |
| RNF-17 | Política institucional de contraseñas sustituida | Política propia aprobada: 15–128 caracteres y primer acceso | SUSTITUIDO_POR_DECISION | Validar aceptación formal y documentar el cambio. |
| RNF-18 | JWT propio RS256 y sesión renovable sustituyen JWKS | Pruebas de auth y migración de credenciales/sesión | SUSTITUIDO_POR_DECISION | Probar rotación de claves y flujo de revocación en despliegue. |
| RNF-19 | Evitar doble asignación | Serialización, locks e índices únicos | PARCIAL | Ejecutar de forma continua verificadores afectados en CI. |
| RNF-20 | API de sincronización académica sustituida por Excel | Importación administrativa versionada y validada | SUSTITUIDO_POR_DECISION | Confirmar plantilla real y futura integración institucional. |
| RNF-21 | Operaciones críticas atómicas | Transacciones y auditoría en servicios | PARCIAL | Completar pruebas de rollback de cada escritura multi-entidad. |
| RNF-22 | Monolito modular NestJS/TypeScript | Módulos separados y TypeScript estricto | PARCIAL | El frontend React se mantiene en repositorio separado. |
| RNF-23 | Pruebas automatizadas de reglas críticas | Suites unitarias, HTTP y verificadores DB | PARCIAL | Ampliar las pruebas y su ejecución automatizada en CI. |
| RNF-24 | REST documentado con OpenAPI | Swagger en `/docs` y `/docs-json` | VERIFICADO | Mantener contratos actualizados con cada cambio. |
| RNF-25 | Escalado horizontal de workers | Workers BullMQ separados lógicamente | PARCIAL | Verificar despliegue multi-worker y límites de recursos. |
| RNF-26 | Despliegue mediante contenedores | Compose de servicios de desarrollo | PARCIAL | Preparar imagen de backend y despliegue productivo. |
| RNF-27 | Compatibilidad de navegadores | Frontend fuera de alcance backend | PENDIENTE | Validar en pruebas de frontend. |
| RNF-28 | Protección de datos personales | DTO limitan exposición y mensajes se minimizan | PARCIAL | Revisión legal, retención y evaluación de privacidad pendientes. |
| RNF-29 | Monitoreo y logs centralizados | Observe está desactivado; logs Nest locales | PENDIENTE | Definir plataforma y alertas de operación. |
| RNF-30 | Fechas con zona local institucional | TIMESTAMPTZ y `America/Guayaquil` donde aplica | PARCIAL | Revisar todos los reportes y exportaciones temporales. |
| RNF-31 | No borrar historial | Estados, triggers restrictivos y reversión protegida | PARCIAL | Auditar eliminaciones físicas y políticas de retención restantes. |
| RNF-32 | Correo asíncrono | Outbox PostgreSQL, BullMQ y Mailpit | PARCIAL | Configurar remitente SMTP institucional autorizado. |
| RNF-33 | Exportaciones con expiración | Caducidad y bloqueo de descarga | PARCIAL | Comprobar limpieza automática con almacenamiento integrado. |
| RNF-34 | Auditoría de acciones relevantes | AuditoriaService con usuario, cambios, IP y fecha; consulta ADMIN `GET /auditoria` con índices `IDX_auditoria_fecha_hora` e `IDX_auditoria_usuario` (migración `20261027100000`) y ocultamiento defensivo de claves sensibles | PARCIAL | Revisar cobertura por caso de uso. Los valores de docentes incluyen la cédula, que coincide con la clave temporal inicial de las cuentas importadas. |

## Decisiones de infraestructura y autenticación

- PostgreSQL 17 es la versión de desarrollo/CI elegida; el C4 menciona PostgreSQL
  16. La diferencia es una decisión de implementación aprobada, no una
  migración de motor.
- SeaweedFS es el almacenamiento local aprobado; AIStor permanece opcional. Los
  objetos no se guardan en PostgreSQL.
- El login Microsoft/OIDC y la demo de contraseña común se retiraron mediante la
  decisión aprobada de correo/contraseña propia. SMTP institucional real queda
  pendiente de autorización y configuración.
- Las pruebas aisladas no demuestran disponibilidad, TLS, backups, recuperación,
  rendimiento ni cumplimiento legal del entorno productivo.

## Backlog priorizado derivado de brechas

1. Completar cierre funcional del período y pruebas de su ciclo; el endpoint de
   archivo pertenece a la etapa vigente.
2. Revisar autorización por recurso y añadir pruebas HTTP cruzadas por rol.
3. Incorporar al CI los verificadores PostgreSQL críticos, en grupos que
   respeten el tiempo límite del workflow.
4. Completar recorridos integrados PAT, notificaciones y exportaciones con
   Redis, SeaweedFS y Mailpit.
5. Ajustar importación al Excel oficial y registrar docentes si la plantilla
   institucional lo incluye.
6. Preparar operación productiva: TLS, backups/restauración, monitoreo, SMTP,
   secretos, almacenamiento y privacidad.
7. Coordinar los requisitos de interfaz y accesibilidad con el repositorio
   frontend.
