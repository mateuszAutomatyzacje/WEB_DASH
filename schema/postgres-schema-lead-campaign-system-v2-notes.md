# Postgres schema v2 — notes (what was added)

Cytowany tekst (luki v1) i jak to domknęliśmy:

> 1. Nie ma tabeli “send_attempts / deliveries / bounces / replies” jako osobnych rekordów.
>    • Masz eventy (możesz zapisywać step_sent, bounced, replied w lead_stage_events), ale jeśli chcesz precyzyjne metryki per wiadomość, to warto dodać np. message_attempts.
> 2. Nie ma twardej deduplikacji email/domain (na razie są pola email_sha256/domain_sha256, ale bez unique indexów).
>    • Można dodać później, jak ustalisz strategię (bo duplikaty czasem są “feature”, nie bug).
> 3. Nie ma pełnego modelu “worker pipeline” (SLA, notatki, outcome, follow‑ups).
>    • Jest minimum: lead_assignments + statusy.
> 4. Wymaga extensionów:
>    • pgcrypto (UUID) i citext (email).
>    • Na Railway zwykle działa, ale jak nie pozwoli, zrobimy fallback:
>    • UUID generowane aplikacyjnie, email jako text + lower().

W v2:
- Dodano `message_attempts` + `message_events` (telemetria per wiadomość).
- Dodano lekkie rozszerzenie worker pipeline: `lead_assignment_notes` + `sla_due_at`.
- Dedupe: zostawione jako **opcjonalne** unique indexy (zakomentowane) na `email_sha256/domain_sha256`.
- Dopisano enumy `message_direction` i `message_event_type`.

Plik do wgrania: `briefs/postgres-schema-lead-campaign-system-v2.sql`
