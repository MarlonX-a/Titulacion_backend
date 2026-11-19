# Automatic PAT — autofill, direct delivery and generation fixes

Date: 2026-11-19. Branch: `feat/pat-automatico`. Audience: backend and frontend agents.
All identifiers and user-facing messages stay in Spanish; this document is the HTTP contract.

Common error shape (NestJS default): `{ "statusCode": number, "message": string | string[], "error": string }`.
`400` = DTO validation or missing data, `403` = role, `404` = missing or not visible (also: not your
assignment), `409` = business rule, `503` = PostgreSQL/storage unavailable.

All student routes below require a bearer token of role `ESTUDIANTE` (other roles → `403`) and a
current (`VIGENTE`) topic assignment where the student is the holder or an `ACTIVO` group member
(otherwise → `404 «No existe una asignación vigente propia.»`). Path params are UUIDs (`400` otherwise).

Prefix used below: `P = /periodos/:periodoId/asignaciones-tema/:asignacionId/pat/me`.

---

## 1. Endpoint summary

| Method | Path | Status | Notes |
| --- | --- | --- | --- |
| GET | `/estudiantes/me/datos-pat` | 200 | unchanged shape; `pendientes` uses the keys of §3 (personal subset) |
| PATCH | `/estudiantes/me/datos-pat` | 200 | unchanged; `curso` is accepted but no longer required (it is derived) |
| GET | `P` | 200 | unchanged shape; `pendientes` = content subset of §3 |
| PATCH | `P` | 200 | **new optional field** `tutor_propuesto_id` (§4) |
| GET | `P/tutores-propuestos` | 200 | unchanged |
| **GET** | **`P/resumen`** | 200 | **new** — everything the form needs (§2) |
| **GET** | **`P/generaciones`** | 200 | **new** — own generations, latest first (§5) |
| POST | `P/generaciones` | 202 | tutor now resolved automatically (§5.2); 400 `pendientes` uses §3 keys |
| GET | `P/generaciones/:id` | 200 | response gains `ciclo`, `procesando_desde`, `documento_pat_id` (§5.1) |
| GET | `P/generaciones/:id/descarga` | 200 | unchanged `{ url, expira_en }` (300 s) |
| POST | `P/generaciones/:id/reintentar` | 201 | fixed lookup (§5.4) |
| **POST** | **`P/generaciones/:id/entregar`** | 201 | **new** — deliver the generated PDF without signature (§6) |
| POST | `/periodos/:periodoId/asignaciones-tema/:asignacionId/documentos-pat` | 201 | optional signed upload; unchanged request; response gains `origen`/`firmado` |

Document read routes (`GET .../documentos-pat`, `/ultima`, `/:id`, `/descarga` variants, and the ADMIN
inbox `GET /periodos/:periodoId/documentos-pat/ultimas`) keep their paths; every `DocumentoPatResponseDto`
now carries `origen` and `firmado` (§7).

---

## 2. `GET P/resumen`

Single read for the PAT form. Nothing is written.

```jsonc
{
  "asignacion_tema_id": "uuid",
  "estudiante_id": "uuid",
  "automaticos": {
    "nombres":               { "valor": "José",                    "fuente": "USUARIO" },
    "apellidos":             { "valor": "Peña",                    "fuente": "USUARIO" },
    "cedula":                { "valor": "1300000000",              "fuente": "ESTUDIANTE" },
    "matricula":             { "valor": "1300000000",              "fuente": "ESTUDIANTE" },
    "correo_institucional":  { "valor": "e1300000000@live.uleam.edu.ec", "fuente": "USUARIO" },
    "carrera":               { "valor": "Tecnologías de la Información", "fuente": "CARRERA" },
    "facultad":              { "valor": "Facultad de Ciencias de la Vida y Tecnologías", "fuente": "FACULTAD" },
    "periodo":               { "valor": { "codigo": "2026-2", "nombre": "Titulación 2026-2" }, "fuente": "PERIODO" },
    "extension_pat":         { "valor": "Extensión Manta" /* or null */, "fuente": "PERIODO" },
    "nivel":                 { "valor": 8,                         "fuente": "ESTUDIANTE" },
    "curso":                 { "valor": "Octavo",                  "fuente": "ESTUDIANTE_NIVEL" },
    "tema_titulo":           { "valor": "Sistema de ...",          "fuente": "TEMA" },
    "problematica_sugerida": { "valor": "Descripción del tema",    "fuente": "TEMA" },
    "linea_investigacion":   { "valor": { "id": "uuid", "codigo": "L1", "nombre": "Software" }, "fuente": "LINEA_INVESTIGACION" },
    "articulaciones_sugeridas": { "valor": ["INVESTIGACION"],      "fuente": "LINEA_INVESTIGACION" },
    "modalidad":             { "valor": "INDIVIDUAL" /* | "GRUPAL" */, "fuente": "ASIGNACION_TEMA" },
    "tipo_tema":             { "valor": "PAREJA" /* INDIVIDUAL | PAREJA | GRUPO */, "fuente": "TEMA" },
    "integrantes":           { "valor": [{ "id": "uuid", "nombres": "…", "apellidos": "…", "matricula": "…" }], "fuente": "ASIGNACION_TEMA" },
    "modalidad_academica":   { "valor": "TRABAJO_INTEGRACION_CURRICULAR", "fuente": "PREDETERMINADO" /* or CONTENIDO_PAT if saved */ },
    "tutor": {
      "valor": { "docente_id": "uuid", "nombres": "Ana", "apellidos": "Docente", "tutor_propuesto_id": "uuid" /* null when ASIGNACION_TUTOR */ },
      "fuente": "ASIGNACION_TUTOR" /* | TUTOR_PROPUESTO_ELEGIDO | TUTOR_PROPUESTO_PREDETERMINADO | SIN_TUTOR (valor null) */
    }
  },
  "editables": {
    "personal": { /* saved values of §3.1 fields only; {} until the first PATCH */ },
    "contenido": {
      "problematica": "string",            // saved value, else problematica_sugerida
      "problematica_personalizada": false, // true when the student saved their own text
      "confirma_problematica": false,
      "articulaciones": ["INVESTIGACION"], // saved value, else articulaciones_sugeridas
      "tutor_propuesto_id": null           // saved choice (uuid) or null
    }
  },
  "pendientes": ["fecha_nacimiento", "confirma_problematica"],
  "listo_para_generar": false,             // pendientes.length === 0
  "tutores_propuestos": { "tutor_vigente": null, "data": [ /* TutorPropuestoPatDto, see GET P/tutores-propuestos */ ] }
}
```

`fuente` enum: `USUARIO | ESTUDIANTE | ESTUDIANTE_NIVEL | CARRERA | FACULTAD | PERIODO | TEMA |
LINEA_INVESTIGACION | ASIGNACION_TEMA | ASIGNACION_TUTOR | TUTOR_PROPUESTO_ELEGIDO |
TUTOR_PROPUESTO_PREDETERMINADO | SIN_TUTOR | PREDETERMINADO | CONTENIDO_PAT`.

Derivations:

- `curso`: ordinal of `estudiante.nivel` (`1 → Primero … 10 → Décimo`, otherwise `"<n>.º"`).
- `modalidad`: `INDIVIDUAL` when the assignment has `estudiante_id`, `GRUPAL` when it has `grupo_id`.
  `integrantes`: holder or ACTIVE group members, ordered by apellidos, nombres.
- `articulaciones_sugeridas`: `["INVESTIGACION"]` when the topic has a research line (always today), else `[]`.
- `tutor` resolution (same function used by generation): 1) current tutor (`asignacion_tutor` VIGENTE);
  2) the student's saved `tutor_propuesto_id` if it still belongs to the postulación; 3) the first entry of
  `tutores_propuestos.data` (same order as `GET P/tutores-propuestos`: topic proposer first, then
  `orden_prioridad`); 4) none → `fuente: SIN_TUTOR`, `valor: null`, pending `tutor_propuesto_id`.

## 3. Pending keys (single source of truth)

`pendientes` of `GET /estudiantes/me/datos-pat`, `GET/PATCH P`, `GET P/resumen` and the `400` of
`POST P/generaciones` all come from one function (`src/generaciones-pat/pat-pendientes.ts`).
Order is stable (the order below). Keys:

### 3.1 Personal (saved once per student in `estudiante_datos_pat`, reused for every assignment)

| Key | Pending when |
| --- | --- |
| `fecha_nacimiento` | empty (format `YYYY-MM-DD`, real, not future) |
| `paralelo`, `sexo`, `nacionalidad`, `estado_civil`, `provincia`, `canton`, `parroquia`, `celular` | empty |
| `tiene_discapacidad` | not a boolean |
| `correo_personal` | empty and `correo_personal_no_aplica !== true` |
| `telefono_convencional` | empty and `telefono_convencional_no_aplica !== true` |
| `certificado_votacion` | empty and `certificado_votacion_no_aplica !== true` |
| `discapacidades` | `tiene_discapacidad=true` and no category (`VISUAL, FISICA, AUDITIVA, INTELECTUAL, PSICOLOGICA, LENGUAJE, OTRA`) |
| `grado_discapacidad` | `tiene_discapacidad=true` and empty |
| `otra_discapacidad` | `discapacidades` contains `OTRA` and empty |

`curso` and `modalidad_academica` are no longer pending (derived/defaulted).

### 3.2 Content (per assignment and student, `contenido_pat_estudiante`)

| Key | Pending when |
| --- | --- |
| `problematica` | effective text (saved or topic description) is empty |
| `confirma_problematica` | not `true` |
| `articulaciones` | effective list (saved or suggested) is empty |
| `articulaciones_excluyentes` | list contains `NINGUNA` together with another value |

### 3.3 Other

| Key | Pending when |
| --- | --- |
| `tutor_propuesto_id` | no current tutor and the postulación has no proposed tutors |
| `extension_pat` | ADMIN has not configured `PATCH /periodos/:periodoId/datos-formato-pat` |

## 4. `PATCH P` (content)

Body `ActualizarContenidoPatDto` (all optional, unknown properties → 400):

| Field | Type | Rules |
| --- | --- | --- |
| `problematica` | string | ≤ 5000 |
| `confirma_problematica` | boolean | |
| `articulaciones` | string[] | each in `INVESTIGACION, VINCULACION, DOCENCIA, NINGUNA` |
| `modalidad_academica` | string | ≤ 120; optional override of the default |
| `tutor_propuesto_id` | uuid \| null | **new**. Must be a proposal of the assignment's postulación (`400 «El tutor elegido no pertenece a las propuestas de esta postulación.»`); `400 «El trabajo ya tiene un tutor vigente; no selecciones una propuesta.»` when a current tutor exists. `null` clears the choice. |

Allowed only with the period in `POSTULACION_CERRADA` or `EN_CURSO` (`409` otherwise).
Response: `{ asignacion_tema_id, estudiante_id, contenido, pendientes }` (content keys of §3.2).

## 5. Generations

### 5.1 `GeneracionPatResponse`

```jsonc
{
  "id": "uuid", "asignacion_tema_id": "uuid", "estudiante_id": "uuid",
  "version_diseno": 1,
  "ciclo": 1,                       // increments on retry and on stuck recovery
  "estado": "EN_COLA",              // EN_COLA | PROCESANDO | LISTO | FALLIDO
  "tamano_bytes": null,             // number when LISTO
  "hash_sha256": null,              // string when LISTO
  "solicitada_en": "date-time",
  "procesando_desde": null,         // date-time while/after PROCESANDO in the current cycle
  "generada_en": null,              // date-time when LISTO
  "error": null,                    // sanitized message only when FALLIDO
  "documento_pat_id": null          // id of the GENERADO delivery made from this generation, if any
}
```

### 5.2 `POST P/generaciones` → `202 { id, estado: "EN_COLA" }`

Body `GenerarPatDto`: `{ tutor_propuesto_id?: uuid }` — optional override; otherwise the tutor is resolved as in
§2. Errors: `400 { message: «Completa los datos obligatorios antes de generar el PAT.», pendientes: string[] }`
(keys of §3); `400` when `tutor_propuesto_id` is not a proposal of the postulación or a current tutor exists;
`409` period not in `POSTULACION_CERRADA`/`EN_CURSO` or assignment not current.
The frozen `instantanea` now includes the autofilled values (`curso`, `modalidad`, `linea_investigacion`,
`tipo_tema`, effective `contenido`) so later edits never change an existing PDF.

### 5.3 `GET P/generaciones` → `200 { data: GeneracionPatResponse[], total: number }`

The caller's generations for that assignment, latest first (`solicitada_en DESC`), at most 50.
Replaces frontend `sessionStorage` tracking.

### 5.4 `POST P/generaciones/:id/reintentar` → `201 { id, estado: "EN_COLA" }`

Looks up the generation by `id + asignacion_tema_id + estudiante_id` (same rule as every other read).
Only `FALLIDO` → `409 «Solo se pueden reintentar generaciones fallidas.»`; not found for this student → `404`; a concurrent change → `409 «Otra operación cambió la generación PAT; vuelve a consultarla.»`. Increments `ciclo` and publishes
BullMQ job `generar-pat` with `jobId = pat-{id}-{ciclo}`; a new cycle therefore never collides with the failed
job retained by `removeOnFail: false`. When an `EN_COLA` row is republished and the job with the same id is
in the failed set (e.g. it failed before changing state), the failed job is removed and re-added.

### 5.5 Stuck recovery (no endpoint)

The periodic republisher (every 5 s, only when `BACKGROUND_TASKS_ENABLED=true`) resets rows that stay in
`PROCESANDO` for more than 5 minutes (`GENERACION_PAT_ATASCADA_MS`, measured from `procesando_desde`, or
`solicitada_en` for rows created before this change) to `EN_COLA` with `ciclo + 1`, then republishes them.
A late worker of the old cycle cannot overwrite the row (cycle check), and its orphan file is cleaned.

## 6. `POST P/generaciones/:id/entregar` — direct delivery without signature

No body. Creates a new `documento_pat` version for the caller that **references the generated PDF**
(`origen: "GENERADO"`, `firmado: false`, same `ruta_almacenamiento`, `hash_sha256`, `tamano_bytes`).
Response `201 DocumentoPatResponseDto` (§7). Notifies ADMIN (`PAT_ENTREGADO`) and audits
`ENTREGAR_PAT_GENERADO`, like uploads.

Rules (same as the signed upload):

| Case | Status / message |
| --- | --- |
| generation not found for this student and assignment | `404 «No existe esa generación PAT.»` |
| generation not `LISTO` | `409 «La generación todavía no está disponible.»` |
| this generation was already delivered with `origen=GENERADO` | `409 «Esta generación ya fue entregada; genera una nueva versión del PAT para volver a entregar.»` |
| latest own version pending review | `409 «La última versión del PAT todavía está pendiente de revisión.»` |
| latest own version approved | `409 «La última versión del PAT ya fue aprobada y no admite otra entrega.»` |
| period not `POSTULACION_CERRADA`/`EN_CURSO` | `409 «La entrega PAT solo se permite con postulaciones cerradas o durante titulación.»` |
| assignment no longer current | `409 «La asignación de tema ya no está vigente.»` |
| not holder / active member | `403` / `404` |

The optional signed path stays `POST .../documentos-pat` (multipart `archivo` + `generacion_id`), now stored as
`origen: "FIRMADO"`, `firmado: true`, with the same rate limits (10/h, 1 concurrent).

**Storage decision — reference, not copy.** The delivered document points at the generation's object key
(`generaciones-pat/<uuid>.pdf`). It is safe because (a) `generacion_pat` rows are immutable history and cannot be
deleted (trigger), (b) the cleanup worker only removes keys that no `plantilla_pat`, `documento_pat` or
`generacion_pat` row references, and (c) the database trigger now enforces that a `GENERADO` document carries
exactly the generation's key, hash and size. Copying would duplicate storage and need an extra cleanup intention
for no integrity gain.

## 7. `DocumentoPatResponseDto` (all document reads, ADMIN inbox included)

New fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `origen` | `"GENERADO" \| "FIRMADO"` | `GENERADO`: delivered directly from a generation; `FIRMADO`: signed PDF uploaded (also every pre-existing row) |
| `firmado` | boolean | derived: `origen === "FIRMADO"` |

Other fields unchanged (`id, asignacion_tema_id, plantilla_id, estudiante_id, generacion_id, version,
nombre_archivo, formato, tamano_bytes, hash_sha256, fecha_carga, revision, detalle_revision, plantilla, cargador`).
For `GENERADO`, `nombre_archivo` is `PAT-generado.pdf`. Downloads work the same way (300 s signed URL, attachment).

## 8. Database (migration `20261119100000-PatAutomatico`)

- `documento_pat.origen varchar(20) NOT NULL DEFAULT 'FIRMADO'`, `CHECK (origen IN ('GENERADO','FIRMADO'))`,
  `CHECK (origen <> 'GENERADO' OR generacion_id IS NOT NULL)`; partial unique index
  `UQ_documento_pat_generacion_entregada (generacion_id) WHERE origen='GENERADO'`. Existing rows → `FIRMADO`.
- `generacion_pat.procesando_desde timestamptz NULL`.
- `proteger_generacion_pat()` additionally allows `PROCESANDO → EN_COLA` with `ciclo + 1` (stuck recovery).
- `proteger_documento_pat()`: `GENERADO` rows must copy the generation's key/hash/size and need no upload
  intention; `FIRMADO` rows keep the previous rules (upload intention required).
- `down` refuses to run while `GENERADO` documents exist.

## 9. Configuration

No new variables. `src/` no longer branches on `NODE_ENV === 'test'`: the generation republisher follows
`BACKGROUND_TASKS_ENABLED`, and tests compose the app without Redis through `createE2eTestingModule`
(which now also stubs the `generaciones-pat` queue and worker).
