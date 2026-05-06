# PitchBook To HubSpot Triage Design

Date: 2026-05-06

## Context

This design follows the workflow shape from the `KhazP/vibe-coding-prompt-template` repository: research, PRD, technical design, agent instructions, then implementation. For this project, the immediate deliverable is the technical design for an MVP Vibe app that ingests PitchBook alert emails, identifies relevant service triggers, matches companies to HubSpot, and stages pending follow-up actions for review.

The app will be built for the Chatham Vibes platform and should align with the attached `build` skill. That means a production-first app structure, connector-aware design, a clear split between JSX UI and server-side jobs, and internal records as the source of truth for review before any external writeback.

## Problem Statement

Each morning, several PitchBook alert emails arrive containing news, transaction, and company updates. The business wants an automated system that:

- ingests those emails from the live mailbox on a schedule,
- extracts individual alert items,
- determines whether each item is a relevant service opportunity,
- matches the company to HubSpot with an explicit confidence bucket,
- assigns a likely owner for high-confidence matches,
- creates a draft HubSpot company note as a pending action rather than writing directly to HubSpot,
- and provides a UI for review, override, and later downstream routing.

The matching and relevance logic must handle imperfect company naming and language variation. The system should prefer transparency over false certainty and should surface uncertainty through clear review buckets.

## Goals

- Automate daily ingestion from the live Outlook mailbox before users start their day.
- Support manual `.msg` upload through the app for testing, replay, and pipeline verification.
- Identify relevant service triggers using a configurable keyword and phrase library, assisted by AI for contextual interpretation.
- Validate relevant or uncertain triggers with one additional external source when available.
- Query HubSpot only after trigger relevance has been evaluated.
- Use AI as both a first-pass evaluator and a second-pass validator for exact and near company matches.
- Bucket results into `high-confidence match`, `possible match`, and `no match`.
- Auto-assign the likely company owner only for high-confidence matches.
- Generate a draft HubSpot company note as a pending internal action instead of pushing directly to HubSpot.
- Provide an analyst-facing UI with searchable override controls for possible matches.

## Non-Goals For MVP

- Sending RM emails.
- Writing company notes directly into HubSpot without review.
- Auto-tagging company owners inside HubSpot.
- General-purpose mailbox administration beyond the targeted PitchBook workflow.
- Perfect autonomous matching. The MVP explicitly preserves human override paths.

## MVP Workflow

1. A scheduled job runs daily before 8:00 AM in `America/New_York`.
2. The job reads the live Outlook mailbox and finds the targeted PitchBook alert emails.
3. Each source email is parsed into one or more normalized alert items.
4. Each alert item runs through relevance classification before any HubSpot lookup.
5. Relevant or uncertain items attempt to find one corroborating external source when available.
6. Relevant items query HubSpot for candidate company matches.
7. AI validates the best apparent match and runs a second pass over near matches.
8. The system assigns one of three match buckets:
   - `high-confidence match`
   - `possible match`
   - `no match`
9. High-confidence relevant items get a news card, assigned owner, and draft HubSpot company note stored as a pending action.
10. Possible matches get a news card plus one to three candidate companies surfaced in a searchable override control.
11. No-match or failed items are retained in explicit failure buckets with reasons.

Manual `.msg` uploads will enter the same normalized pipeline after upload so that testing and production use the same downstream logic.

## System Components

### 1. Scheduled Ingestion Job

Responsibilities:

- Run daily on a fixed schedule before users arrive.
- Pull targeted PitchBook emails from the live Outlook mailbox.
- Create `SourceEmail` records.
- Parse each email into normalized `AlertItem` records.
- Record parse failures without stopping the full batch.

This job should stay focused on message retrieval and extraction, not heavy enrichment.

### 2. Analysis And Enrichment Job

Responsibilities:

- Process new `AlertItem` records.
- Apply trigger relevance logic using configured phrases plus AI interpretation.
- Search for one corroborating external source when available.
- Query HubSpot for company candidates only after relevance evaluation.
- Validate exact and near matches using deterministic signals plus AI review.
- Assign match buckets and ownership.
- Generate `PendingAction` records for draft HubSpot company notes.

Separating analysis from ingest makes retries, prompt changes, and replay safer.

### 3. App UI

The UI is a review and control plane. It should support:

- daily triage views by processing status,
- filtering by owner,
- filtering by client or prospect,
- filtering by trigger type and alert type,
- visibility into match confidence and reasoning,
- manual `.msg` upload for testing,
- and override of candidate company selection.

Possible matches should show a dropdown or search-driven selector that displays:

- company name,
- ultimate parent,
- company owner,
- client status such as client or prospect.

### 4. Config Layer

The app should expose editable configuration for:

- target trigger keywords and phrases,
- phrase grouping or categorization,
- confidence thresholds,
- mailbox targeting inputs if needed,
- and review state defaults.

This allows business tuning without code deployment.

### 5. Pending Action Layer

Draft HubSpot company notes should be stored internally first. This preserves a clear approval boundary and allows future phases to push notes to HubSpot or send RM digests without redesigning the pipeline.

## Data Model

### SourceEmail

Stores one ingested PitchBook email.

Suggested fields:

- external message id
- source mailbox or folder
- received timestamp
- subject
- sender
- raw body
- parse status
- ingest run id

### AlertItem

Stores one extracted item from a source email.

Suggested fields:

- source email reference
- item type such as news, transaction, people, or company info
- source publication name
- source timestamp
- headline
- extracted company names
- normalized company names
- source URL
- raw excerpt
- relevance status
- relevance rationale
- corroboration status
- processing status

### ResearchEvidence

Stores corroborating source evidence.

Suggested fields:

- alert item reference
- source URL
- source title
- source snippet
- source type
- found status
- validation notes

### CompanyMatchCandidate

Stores one candidate HubSpot company considered for an alert item.

Suggested fields:

- alert item reference
- HubSpot company id
- company name
- ultimate parent
- company owner
- client status
- deterministic similarity signals
- AI validation summary
- confidence score
- candidate rank
- selected flag

### PendingAction

Stores internal downstream actions awaiting review or release.

Suggested fields:

- alert item reference
- chosen HubSpot company id
- proposed owner
- action type
- draft note body
- action status
- reviewer override state

## Relevance Classification

Relevance should be determined before HubSpot matching.

The logic is hybrid:

- a configurable trigger library supplies explicit keywords and phrases,
- deterministic phrase matching captures exact hits,
- AI classification interprets semantic variants and context such as `refinance`, `refinancing`, or more indirect language.

The output should be one of:

- `relevant`
- `not relevant`
- `uncertain`

Each decision must store a short rationale so users can understand why the system classified the item that way.

## External Validation

For relevant or uncertain items, the system should look for one additional external source when available. The rule is not to block progress when a second source cannot be found, but to record that fact explicitly.

Possible corroboration outcomes:

- corroborated by an external source,
- no corroborating source found,
- corroboration not available due to research failure.

This distinction matters for later trust and filtering.

## HubSpot Matching

HubSpot matching only begins after relevance classification.

The matching flow should be:

1. Build candidate companies from HubSpot using normalized company names and related metadata.
2. Score candidates with deterministic signals such as direct name similarity, alias similarity, and parent-company similarity.
3. Use AI to validate whether the top exact-looking candidate is the same entity as the alert company.
4. Run a second AI pass across near matches to decide whether one should be promoted, retained for review, or rejected.

The final bucket must always be explicit:

- `high-confidence match`
- `possible match`
- `no match`

### High-Confidence Match

Criteria:

- relevance is `relevant`,
- the selected HubSpot company clearly matches the alert company,
- there is no material ambiguity between multiple candidates.

Actions:

- create a news card,
- assign the likely owner,
- generate a draft HubSpot company note as a pending action.

### Possible Match

Criteria:

- the item is relevant,
- one or more plausible HubSpot candidates exist,
- but the system does not have enough certainty to auto-assign.

Actions:

- create a reviewable news card,
- attach one to three candidate companies,
- surface searchable override in the UI.

### No Match

Criteria:

- no plausible HubSpot candidate exists,
- or candidate ambiguity is too high to present a safe suggestion.

Actions:

- retain the item in a failure or review bucket with a reason code.

## Failure Buckets

The MVP should preserve explicit failure reasons rather than a single generic error state. At minimum:

- `parse failure`
- `not relevant trigger`
- `relevant but no corroborating source found`
- `relevant but no HubSpot candidate found`
- `multiple plausible HubSpot matches`
- `research failure`

These buckets should be filterable in the UI for tuning and operations.

## UI Views

The primary UI should expose views or filters for:

- relevant and high-confidence,
- relevant and possible match,
- relevant and no match,
- not relevant,
- failed processing.

Each alert card should expose:

- headline,
- source and date,
- extracted company,
- trigger classification,
- corroboration status,
- selected owner if applicable,
- confidence bucket,
- draft note preview,
- match rationale.

Possible matches should expose the searchable company override with the requested context fields.

## Note Generation

The draft HubSpot company note should be generated for relevant high-confidence items and stored as a pending action. The note should summarize:

- what happened,
- why it may matter as a service trigger,
- what source evidence supports it,
- and which company and owner the system believes it belongs to.

The MVP should not post the note automatically.

## Operational Controls

- Jobs must be retryable without duplicating records.
- Reprocessing should be possible for historical items after rule or prompt changes.
- Scheduled runs and manual uploads should share downstream logic.
- The system should preserve raw source data for auditability.
- AI-derived decisions should store short justifications for review.

## Testing Strategy

The MVP should be tested across four layers:

### Parsing Tests

- Parse sample `.msg` files into normalized `AlertItem` records.
- Confirm extraction of headline, source, company name, URL, and item type.

### Classification Tests

- Validate that configured triggers plus AI interpretation classify known relevant and non-relevant samples correctly.
- Validate rationale capture for each classification.

### Matching Tests

- Validate high-confidence exact matches.
- Validate plausible but ambiguous matches.
- Validate no-match cases.
- Validate second-pass AI review on near matches.

### End-To-End Tests

- Simulate a morning batch from mailbox ingest through pending-action creation.
- Validate that manual `.msg` upload enters the same pipeline.
- Validate that no direct HubSpot write occurs in the MVP.

## Risks And Mitigations

### Risk: AI overstates company identity confidence

Mitigation:

- keep deterministic candidate generation visible,
- store reasoning,
- expose override controls,
- auto-assign only on high-confidence outcomes.

### Risk: noisy or irrelevant PitchBook content

Mitigation:

- relevance check happens before HubSpot matching,
- trigger library is configurable,
- non-relevant and uncertain items remain reviewable.

### Risk: external corroboration is inconsistent

Mitigation:

- treat corroboration as a recorded signal, not a hard blocker,
- preserve explicit statuses for not found versus technical failure.

### Risk: operational distrust if failures are opaque

Mitigation:

- use explicit failure buckets,
- retain raw source records,
- show rationale on decisions.

## Recommended Implementation Sequence

1. Define app records and storage schema.
2. Build `.msg` parsing path first using the provided sample emails.
3. Build scheduled Outlook mailbox ingestion.
4. Implement relevance classification and trigger config.
5. Implement corroborating research.
6. Implement HubSpot candidate retrieval and AI validation.
7. Build the review UI and override controls.
8. Generate pending HubSpot note actions.
9. Add filtering, replay, and operational controls.

## Implementation Readiness

This design is intentionally scoped for an MVP that is automated, reviewable, and safe. It prioritizes ingestion, relevance, matching, and internal pending actions over direct CRM writeback or outbound notifications. That keeps the first release useful without taking on unnecessary operational risk.
