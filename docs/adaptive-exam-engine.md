# Adaptive Exam Engine decisions

## Current data contract

The Exam Center stores syllabus nodes, sessions, reviews, practice records, plans,
and settings in its existing state snapshot. That state is synchronized by the
existing account/PostgreSQL sync path. This change adds optional topic/session
fields to that contract and therefore does not require a database migration.
Older clients can ignore those fields; newer clients default missing evidence
to zero instead of inferring mastery from `estado === concluido`.

## Mastery and completion

`estado`/`contentCompleted` describe syllabus coverage. `masteryPct` and
`masteryState` describe knowledge evidence. Session evidence combines retrieval
accuracy, confidence, and reported autonomy; exercise volume determines the
bounded weight of new evidence. Study minutes are analytics only and do not
increase mastery. Accuracy is aggregated from correct/attempt totals, while
recent performance and learning evidence are retained as bounded histories.

The labels are `not_started` (no evidence), `learning` (<35), `developing`
(35–64), `consolidated` (65–84), and `mastered` (85+). These labels describe an
estimate and are not an exam outcome prediction.

## Priority formula

Priority is a normalized 0–100 weighted score: mastery gap (0.30), syllabus
importance (0.20), review due-ness (0.16), weak exercise performance (0.14),
forgetting/staleness (0.08), difficulty (0.05), and exam urgency (0.07).
Weights are rationale-based defaults and can be overridden with
`settings.priorityWeights`; callers may override through `scoreTopic` context.
Prerequisite blockers exclude a topic until known prerequisites reach 60%
mastery. Missing prerequisite IDs are invalid and also block rather than silently
allowing advanced topics. The validator reports missing IDs and cycles.

Importance is sourced from the syllabus catalog when available. No exam incidence
probability is fabricated. The time-to-exam activity policy switches toward
practice/retrieval in the final 90 days and prioritizes exercise practice in the
last 21 days when evidence exists.

## Review scheduling

Review scheduling is FSRS-inspired, not a claim of implementing the full FSRS
model. It stores a stability estimate in days and estimated difficulty. A lapse
(weak retrieval/confidence or very high felt difficulty) contracts stability
and schedules one-day review; successful recall expands stability, then derives
the next interval from stability and recall quality. Legacy `intervalDays` and
`intervalIndex` continue to be written for compatibility.

## Weekly timetable

The engine's weekly range is Monday–Sunday. The bulk timetable import checks
fixed recurring events and current-week variable events at 15-minute resolution
between 08:00 and 22:00. It imports the generated week once, skips sessions for
which no slot remains, and does not catch up all missed sessions on the next day.
Regeneration replaces only unfinished engine-generated events; completed plan
items remain. The timetable event's visible title is the topic title; source
metadata is stored separately. Existing timetable save hooks continue to sync
the weekly data.

## Curriculum relationships

The bundled syllabus currently does not provide an authoritative prerequisite
graph. The engine validates explicitly configured `blockedBy`/`prerequisiteIds`
and never invents relationships. A curriculum prerequisite dataset should be
added only with a cited curricular source and reviewed mapping.

## Remaining scope

This iteration improves evidence tracking, priorities, review timing, weakness
detection, and timetable placement. Full exam mock scheduling, school-test
integration, a user-facing prerequisite graph editor, and a calibrated
probability-of-readiness model remain future work; no readiness probability is
shown as a guaranteed outcome.
