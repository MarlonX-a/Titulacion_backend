# Blocks 2, 3 and 4 — forced period transitions, topic reservation, programas

Date: 2026-11-15. Branch: `feat/filtro-facultad`. Audience: backend and frontend agents.
All identifiers and user-facing messages stay in Spanish; this document is the HTTP contract.

Common error shape (NestJS default): `{ "statusCode": number, "message": string | string[], "error": string }`.
`400` = DTO validation, `403` = role/resource, `404` = missing or not visible, `409` = business rule, `503` = PostgreSQL unavailable.

---

## Block 2 — Forced period transitions

### Endpoints (ADMIN only, unchanged paths)

| Method | Path | Body |
| --- | --- | --- |
| POST | `/periodos/:id/abrir-postulacion` | `TransicionPeriodoDto` (optional) |
| POST | `/periodos/:id/cerrar-postulacion` | `TransicionPeriodoDto` (optional) |
| POST | `/periodos/:id/iniciar-titulacion` | `TransicionPeriodoDto` (optional) |

`TransicionPeriodoDto`:

| Field | Type | Rules |
| --- | --- | --- |
| `forzar` | boolean, optional | default `false` |
| `motivo` | string, optional | trimmed; **required with 10–500 chars when `forzar=true`**; when sent without `forzar` it is still validated (10–500) and ignored |

Empty body `{}` or no body keeps the previous behavior exactly. Unknown properties → `400`.

Response: `200 PeriodoResponseDto` (unchanged shape: `id, codigo, nombre, fecha_inicio_postulacion, fecha_fin_postulacion, fecha_inicio_titulacion, estado, max_integrantes_default, facultad_id, facultad`). After a forced transition the adjusted date is visible in the response.

### Rules

State preconditions never change (abrir: BORRADOR or reopen from POSTULACION_CERRADA; cerrar: POSTULACION_ABIERTA; iniciar: POSTULACION_CERRADA). If the date guard is already satisfied, `forzar` is ignored and the normal transition (and normal audit action) runs.

When `forzar=true` and the date guard is not met, the relevant date is set to the database clock (`clock_timestamp()`) in the same transaction as the state change:

| Transition | Date set to now | Extra check (409 if it fails) |
| --- | --- | --- |
| abrir / reabrir | `fecha_inicio_postulacion` (only when now < inicio) | `fecha_fin_postulacion` must be > now: «No se puede forzar la apertura: la fecha fin de postulación ya pasó. Edita primero la fecha fin de postulación.» |
| cerrar | `fecha_fin_postulacion` | now must be > `fecha_inicio_postulacion` |
| iniciar | `fecha_inicio_titulacion` | now must be >= `fecha_fin_postulacion`: «No se puede forzar el inicio: el plazo de postulación aún no vence.» |

Audit (`auditoria`, same transaction): actions `ABRIR_POSTULACION_FORZADA`, `REABRIR_POSTULACION_FORZADA`, `CERRAR_POSTULACION_FORZADA`, `INICIAR_TITULACION_FORZADA` with
`valores_anteriores = { estado, <campo_fecha>: <fecha anterior> }` and
`valores_nuevos = { estado, <campo_fecha>: <now>, forzado: true, motivo }` (iniciar also keeps `condicionados_suspendidos`).

Scheduler (BullMQ `transiciones-periodo`): unchanged and idempotent. Each automatic transition re-reads state and dates under `FOR UPDATE`; after a forced transition the period is no longer in the source state, so the job returns `false` without changes or errors.

Closing postulación (manual, forced or automatic) also expires reservations still in `PENDIENTE_CONFIRMACION` (block 3).

---

## Block 3 — Topic reservation with mandatory confirmation

### New enum values

- `EstadoTema.RESERVADO` (`tema_estado_enum`).
- `EstadoPostulacion.PENDIENTE_CONFIRMACION` (`postulacion_estado_enum`).
- New enum `postulacion_confirmacion_estado_enum`: `PENDIENTE | CONFIRMADA | RECHAZADA`.
- Constant `RESERVA_CONFIRMACION_HORAS = 48` (`src/postulaciones/reserva-tema.ts`).

### New table `postulacion_confirmacion`

(Singular, following the codebase table naming: `postulacion`, `grupo_integrante`.)

| Column | Type |
| --- | --- |
| `id` | uuid PK |
| `postulacion_id` | uuid FK → postulacion |
| `estudiante_id` | uuid FK → estudiante |
| `estado` | `postulacion_confirmacion_estado_enum`, default `PENDIENTE` |
| `motivo` | text NULL (only for RECHAZADA) |
| `respondida_en` | timestamptz NULL (NULL iff PENDIENTE) |
| `creado_en` | timestamptz |

`UNIQUE (postulacion_id, estudiante_id)`. Trigger `TRG_postulacion_confirmacion_proteger`: no DELETE; UPDATE only PENDIENTE → CONFIRMADA/RECHAZADA with `respondida_en`, other columns immutable.

### Flow

1. The representative (or the individual student) `POST /periodos/:periodoId/postulaciones` (unchanged request). Only a `PUBLICADO` topic accepts it.
   - Group: postulación `PENDIENTE_CONFIRMACION`; one confirmation row per active member; the representative's row is `CONFIRMADA`.
   - Individual: the only participant already confirmed, so the postulación is created directly as `PENDIENTE`.
   - In both cases the topic goes `PUBLICADO → RESERVADO` in the same transaction (tema_historial + audit `RESERVAR_TEMA`).
   - A `RESERVADO` topic rejects other groups/students with `409`: «El tema está reservado por otro grupo o estudiante mientras se confirma o se resuelve su postulación.» (Lazy check: if the reserving postulación is an expired `PENDIENTE_CONFIRMACION`, it is expired first and the new postulación proceeds.)
2. Each other member confirms or rejects (endpoints below).
   - All rows `CONFIRMADA` → postulación `PENDIENTE` (topic stays `RESERVADO`), audit `CONFIRMAR_POSTULACION_COMPLETA`.
   - Any `RECHAZADA` → postulación `RECHAZADA` with `observacion` «Rechazada por un integrante del grupo (Nombres Apellidos)[: motivo]», topic back to `PUBLICADO`, notification `POSTULACION_RECHAZADA`. Note: the existing unique index `UQ_postulacion_tema_grupo_no_cancelada` means that group cannot postulate again to that same topic.
3. Expiration → postulación `CANCELADA` («Reserva vencida: …»), topic back to `PUBLICADO`, audit `EXPIRAR_RESERVA_POSTULACION` (system actor, `automatico: true`), notification `POSTULACION_CANCELADA`:
   - `PENDIENTE_CONFIRMACION` older than 48 h — swept every 60 s by the existing BullMQ job `transiciones-periodo`, plus lazy checks in create/confirm/reject;
   - when the period's postulación closes (inside the close transaction; manual, forced or automatic).
4. ADMIN assigns (`POST /periodos/:periodoId/postulaciones/:postulacionId/asignar-tema`, unchanged): accepts topic `RESERVADO` (new) or `PUBLICADO` (legacy) with postulación `PENDIENTE` → topic `ASIGNADO`.
5. Every cancel/annul path releases a `RESERVADO` topic back to `PUBLICADO` when no other active (`PENDIENTE_CONFIRMACION`/`PENDIENTE`) postulación of a non-archived period remains: student/admin cancel (`POST .../postulaciones/:id/cancelar`, now also accepts `PENDIENTE_CONFIRMACION`), no-admission cancellation, and archiving a period (open `PENDIENTE_CONFIRMACION`/`PENDIENTE` postulaciones of that period are cancelled with «Período archivado sin asignación.» before archiving, so archived history never holds a reservation).
6. Topic close/withdraw (`/temas/:id/cerrar`, `/retirar`) now also accept a `RESERVADO` topic and reject its `PENDIENTE_CONFIRMACION` postulaciones too.

`tema_historial.usuario_id` becomes nullable (only for automatic expirations, `cambios.automatico = true`); `TemaHistorialResponseDto.usuario_id` and `responsable` are now nullable.

### Endpoints (ESTUDIANTE)

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/postulaciones/confirmaciones-pendientes` | — | `200 ConfirmacionPostulacionResponseDto[]` |
| POST | `/postulaciones/:id/confirmar` | — (empty) | `200 ConfirmacionPostulacionResponseDto` |
| POST | `/postulaciones/:id/rechazar` | `{ motivo?: string }` trimmed, 1–500 | `200 ConfirmacionPostulacionResponseDto` |

`GET` returns the postulaciones in `PENDIENTE_CONFIRMACION` where the caller's row is `PENDIENTE` and the reservation has not expired, ordered by `vence_en` ascending.

`ConfirmacionPostulacionResponseDto`:

```json
{
  "postulacion_id": "uuid",
  "periodo_id": "uuid",
  "estado_postulacion": "PENDIENTE_CONFIRMACION | PENDIENTE | RECHAZADA | CANCELADA | …",
  "fecha_postulacion": "date-time",
  "vence_en": "date-time",
  "tema": { "id": "uuid", "titulo": "string", "tipo": "INDIVIDUAL|PAREJA|GRUPO", "estado": "RESERVADO|…" },
  "grupo": { "id": "uuid", "nombre": "string" } ,
  "representante": { "id": "uuid", "nombres": "string", "apellidos": "string" },
  "mi_confirmacion": { "estado": "PENDIENTE|CONFIRMADA|RECHAZADA", "respondida_en": "date-time|null" },
  "confirmaciones": [ { "estudiante_id": "uuid", "nombres": "string", "apellidos": "string", "estado": "…", "respondida_en": "date-time|null" } ]
}
```

(`grupo` is `null` for individual postulaciones; `representante` is the user who registered it.)

Rules and errors:

- Only students with a confirmation row in that postulación; otherwise `404` «No existe esa postulación visible para el usuario.»
- Idempotent: confirming an already `CONFIRMADA` row, or rejecting an already `RECHAZADA` row, returns `200` with the current state.
- `409` «La postulación ya no espera confirmaciones (estado: X).» when the postulación left `PENDIENTE_CONFIRMACION` (and the call is not an idempotent repeat).
- `409` «Ya confirmaste esta postulación; si el grupo no desea continuar, el representante puede cancelarla.» when rejecting after confirming.
- `409` «La reserva venció: …» when the reservation expired (the expiration is committed before answering).
- Locking order: período → tema → grupo → postulación → confirmation rows (same as create).

### Changes to existing responses

`PostulacionResponseDto` adds:

- `confirmaciones`: `Array<{ estudiante_id, nombres, apellidos, estado, respondida_en }>` (empty for legacy rows);
- `vence_en`: `date-time | null` (only while `PENDIENTE_CONFIRMACION`).

`TemaResponseDto.estado` may be `RESERVADO`; `disponible` stays `true` only for `PUBLICADO`. `postulaciones_abiertas` now counts `PENDIENTE_CONFIRMACION`, `PENDIENTE` and `EN_CONFLICTO`. The student catalog still lists only `PUBLICADO` topics.

### Database (migration `20261115100000-ReservaTemaConfirmacion`)

- Rebuilds `tema_estado_enum` and `postulacion_estado_enum` with the new values (same rebuild pattern as `BancoTemas`, because `ALTER TYPE … ADD VALUE` cannot be used inside the migration transaction).
- Recreates `UQ_postulacion_activa_grupo` / `UQ_postulacion_activa_estudiante` with `PENDIENTE_CONFIRMACION` among the active states; updates `validar_postulacion_y_bloquear_periodo`, `proteger_composicion_postulacion`, `validar_transicion_postulacion_asignacion` (new transitions `PENDIENTE_CONFIRMACION → PENDIENTE` without observación, `PENDIENTE_CONFIRMACION → RECHAZADA|CANCELADA` with observación) and `proteger_asignacion_tema` (accepts topic `RESERVADO`).
- `TRG_tema_estado_asignacion` needs no change (it only ties `ASIGNADO` to a VIGENTE assignment).
- **Exclusivity index** `UQ_postulacion_reserva_tema` on `postulacion(tema_id) WHERE estado IN ('PENDIENTE_CONFIRMACION','PENDIENTE') AND fecha_postulacion >= <migration timestamp>`.
  Decision on existing data: rows of `ARCHIVADO` periods are immutable (trigger) and legacy data may hold several `PENDIENTE` postulaciones per topic (the old competition model), so an unconditional unique index could not be created or would block topics forever. The index therefore covers only postulaciones created after the migration (`fecha_postulacion` is immutable). Legacy rows keep working: the migration marks as `RESERVADO` every `PUBLICADO` topic with a `PENDIENTE` postulación of a non-archived period, so new postulaciones are rejected by the insert trigger until the legacy ones are assigned/cancelled (legacy competing candidates still go through the conflicts module, which now also accepts `RESERVADO` topics). For all rows, exclusivity is also enforced by the insert trigger (topic must be `PUBLICADO`, row locked `FOR UPDATE`) plus the `RESERVADO` state.
- `down()` refuses when reservation data exists (`RESERVADO` topics with no legacy explanation, `PENDIENTE_CONFIRMACION` rows or confirmation rows).

---

## Block 4 — Programas and role COORDINADOR

### Role

`UsuarioRol.COORDINADOR` (`usuario_rol_enum` rebuilt in migration `20261115110000-ProgramasCoordinador`). Created by ADMIN through `POST /usuarios` (`rol: "COORDINADOR"`, institutional `@uleam.edu.ec` or `@live.uleam.edu.ec` email, same as DOCENTE/ADMIN). Login/session are role-agnostic.

COORDINADOR is added to these read endpoints: `GET /facultades`, `GET /lineas-investigacion`, `GET /lineas-investigacion/:id`, `GET /docentes`, `GET /docentes/:id`, `GET /temas`, `GET /temas/:id` (sees the whole bank like ADMIN), and to `POST /temas`, `PATCH /temas/:id`, `POST /temas/:id/publicar` (only for topics of programas they are responsible for).

### Table `programa`

| Column | Type / rule |
| --- | --- |
| `id` | uuid PK |
| `nombre` | varchar(150), unique per carrera (case/space-insensitive: `UQ_programa_carrera_nombre` on `(carrera_id, lower(btrim(nombre)))`) |
| `descripcion` | text NULL |
| `carrera_id` | uuid FK → carrera |
| `responsable_docente_id` | uuid NULL FK → docente |
| `responsable_usuario_id` | uuid NULL FK → usuario (must have rol COORDINADOR; trigger) |
| `max_temas` | smallint default 15, CHECK 1..50 |
| `activo` | boolean default true |
| `creado_en`, `actualizado_en` | timestamptz |

`CHECK (num_nonnulls(responsable_docente_id, responsable_usuario_id) = 1)`.
Trigger `TRG_programa_validar`: responsable usuario is COORDINADOR; `max_temas` cannot drop below the current number of non-RETIRADO topics; `carrera_id` cannot change while the programa has topics.

`tema` gains `programa_id uuid NULL FK → programa` and `categoria varchar(120) NULL`. Trigger `TRG_tema_programa`: the topic carrera must equal the programa carrera, and the number of non-RETIRADO topics of the programa must stay <= `max_temas` (programa row locked `FOR UPDATE`). Similar titles are allowed (no title-similarity rule exists).

### Endpoints

| Method | Path | Roles | Body / query |
| --- | --- | --- | --- |
| GET | `/programas` | ADMIN, COORDINADOR, DOCENTE, ESTUDIANTE | `page, limit, carrera_id?, facultad_id?, responsable_docente_id?, responsable_usuario_id?, mios?=true, activo?` |
| GET | `/programas/:id` | same | — |
| POST | `/programas` | ADMIN, COORDINADOR | `CreateProgramaDto` |
| PATCH | `/programas/:id` | ADMIN, COORDINADOR (own) | `UpdateProgramaDto` |

Visibility: ADMIN, COORDINADOR and DOCENTE read every programa (`mios=true` narrows to the caller's own: COORDINADOR by `responsable_usuario_id`, DOCENTE by `responsable_docente_id`). ESTUDIANTE only sees active programas of their own carrera (`carrera_id`/`facultad_id` cannot widen it). No DELETE: deactivate with `PATCH { activo: false }` (history is preserved).

`CreateProgramaDto`: `nombre` (trimmed, 1–150), `descripcion?` (trimmed, ≤ 2000, nullable), `carrera_id` (uuid), `responsable_docente_id?` (uuid), `responsable_usuario_id?` (uuid), `max_temas?` (int 1–50, default 15). Exactly one responsable (`400` otherwise). For COORDINADOR the responsable is forced to themselves (`responsable_usuario_id = caller`); sending another responsable → `403`. The docente responsable must belong to the programa carrera.

`UpdateProgramaDto`: all optional (`nombre`, `descripcion`, `carrera_id`, `responsable_docente_id`, `responsable_usuario_id`, `max_temas`, `activo`); setting one responsable clears the other. COORDINADOR can only edit programas where they are `responsable_usuario_id` and cannot change the responsable (`403`). Empty body → `400`.

`ProgramaResponseDto`:

```json
{
  "id": "uuid", "nombre": "string", "descripcion": "string|null",
  "carrera_id": "uuid", "carrera": { "id": "uuid", "codigo": "string", "nombre": "string" },
  "responsable_docente_id": "uuid|null", "responsable_usuario_id": "uuid|null",
  "responsable": { "tipo": "DOCENTE|COORDINADOR", "id": "uuid", "nombres": "string", "apellidos": "string" },
  "max_temas": 15, "temas_registrados": 3, "activo": true,
  "creado_en": "date-time", "actualizado_en": "date-time"
}
```

Errors: `404` programa/carrera/docente/usuario missing; `409` duplicated name in the carrera («Ya existe un programa con ese nombre en la carrera.»), responsable usuario not COORDINADOR active, docente of another carrera, `max_temas` below current topics, carrera change with topics.

### Topic changes

- `CreateTemaDto` / `UpdateTemaDto` accept `programa_id?: uuid | null` and `categoria?: string | null` (trimmed, 1–120). For COORDINADOR `programa_id` is required on create and must be a programa they are responsible for; on update they can only edit topics of their programas and cannot move them to a programa they do not manage (`403`).
- Rules (service + trigger): programa active (on assignment), same carrera as the topic («La carrera del tema debe coincidir con la del programa.»), limit («El programa alcanzó su máximo de N temas.») → `409`.
- `GET /temas` adds filter `programa_id`; `TemaResponseDto` adds `programa_id: uuid|null`, `programa: { id, nombre } | null`, `categoria: string|null`.
- Each topic is still assigned to one group (unchanged).
