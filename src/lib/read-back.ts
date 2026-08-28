// The Read-back surface's pure logic (Issue #43) — design.md's "Interaction
// model and UI", surface 2: the trust moment where the clinician sees what
// wilson would write before anything is written. Kept out of the component
// for the same reason src/lib/start-surface.ts is: provable under vitest's
// node environment, the component stays a thin wrapper.
import { PUNCT_CHARS } from "./extraction-validator";
// The same two words the exporter writes and the facsimile shows, so the
// read-back panel reads as the same report rather than a second,
// differently-worded account of it (Issue #74, closes #61).
import { DECLINED_SENTINEL, UNKNOWN_SENTINEL } from "./form-3500-facsimile";
import { applyNarrativeProposals, type NarrativeProposal } from "./narrative-extract";
import type { FormFieldSpec } from "./form-3500-fields";
import type { ReadBackHandoff } from "./start-surface";
import type { ProposedAction, TalkSession } from "./talk";

// Non-global, unlike extraction-validator.ts's own use of this character
// class: this gets `.test()`-ed once per character below, and a `/g`
// flag's `lastIndex` would go stale after the first match and start
// returning false forever.
const PUNCT_TEST = new RegExp(PUNCT_CHARS);

interface NormalizedText {
  normalized: string;
  // map[i] = index into the ORIGINAL text (not an NFKC-transformed
  // intermediate) that produced normalized[i]. Deliberately skips NFKC —
  // extraction-validator.ts's grounding check applies it for maximum
  // matching power, but a bulk NFKC pass can change codepoint count
  // (ellipsis "…" → "...", ligatures, decomposed accents), and this
  // module's correctness requirement is stricter: every mapped index
  // must be a REAL position in the text actually being sliced for
  // display, never an approximation (reviewer pass, finding — the
  // original version indexed into the NFKC string while callers sliced
  // the raw one, silently highlighting the wrong span). Since a quote is
  // always extracted verbatim from this exact narrative, skipping NFKC
  // here costs at most an occasional missed match on exotic input — safe,
  // because "ambiguous or unlocatable quotes produce NO highlight" is
  // already the accepted fallback.
  map: number[];
}

function normalizeForMatch(text: string): NormalizedText {
  const chars: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const raw = text[i];
    if (PUNCT_TEST.test(raw)) continue;
    const lower = raw.toLowerCase();
    if (/\s/.test(lower)) {
      if (map.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      chars.push(" ");
      map.push(i);
      pendingSpace = false;
    }
    for (const ch of lower) {
      chars.push(ch);
      map.push(i);
    }
  }
  return { normalized: chars.join(""), map };
}

// The correctness risk the issue itself names: a highlight on the wrong
// span misattributes a value to words the clinician didn't say. "unique"
// is the only status that ever produces a rendered highlight — the panel,
// not the highlighting, remains the complete/authoritative list (AC),
// so a missed highlight here is a cosmetic loss, never a silent mis-fill.
export type QuoteSpanResult =
  | { status: "unique"; start: number; end: number }
  | { status: "ambiguous" }
  | { status: "not-found" };

function searchNormalized(normNarrative: string, map: number[], quoteText: string): QuoteSpanResult {
  const normQuote = normalizeForMatch(quoteText).normalized;
  if (normQuote.length === 0) return { status: "not-found" };

  const occurrences: number[] = [];
  let from = 0;
  for (;;) {
    const idx = normNarrative.indexOf(normQuote, from);
    if (idx === -1) break;
    occurrences.push(idx);
    from = idx + 1;
  }

  if (occurrences.length === 0) return { status: "not-found" };
  if (occurrences.length > 1) return { status: "ambiguous" };

  const matchStart = occurrences[0];
  const matchEnd = matchStart + normQuote.length - 1;
  return { status: "unique", start: map[matchStart], end: map[matchEnd] + 1 };
}

// Finds the (unique, ambiguous, or absent) occurrence of `quoteText` in
// `narrative`, under the same case/punctuation/whitespace rule the
// grounding validator accepted the quote against. Normalizes the
// narrative fresh on every call — fine for a one-off lookup; a caller
// checking many quotes against the same narrative should use
// buildHighlightSegments instead, which normalizes once.
export function findQuoteSpan(narrative: string, quoteText: string): QuoteSpanResult {
  const { normalized, map } = normalizeForMatch(narrative);
  return searchNormalized(normalized, map, quoteText);
}

export interface HighlightSegment {
  text: string;
  // Indexes into the `proposals` array passed to buildHighlightSegments,
  // in no particular order. Empty for unhighlighted text. More than one
  // entry means two proposals' quotes cover the same stretch of prose —
  // AC's "overlapping quotes" case — rendered as one segment carrying
  // both, not two competing/nested marks.
  proposalIndexes: number[];
}

// A proper interval overlay, not "highlight everything any quote
// touches": two proposals whose spans overlap only partially still
// produce distinct segments for their non-shared portions. Normalizes
// `narrative` once and reuses it for every proposal's search, rather
// than once per proposal.
export function buildHighlightSegments(narrative: string, proposals: NarrativeProposal[]): HighlightSegment[] {
  const { normalized, map } = normalizeForMatch(narrative);
  const spans: { start: number; end: number; index: number }[] = [];
  proposals.forEach((proposal, index) => {
    const result = searchNormalized(normalized, map, proposal.quote.text);
    if (result.status === "unique") {
      spans.push({ start: result.start, end: result.end, index });
    }
  });

  const boundaries = new Set<number>([0, narrative.length]);
  for (const span of spans) {
    boundaries.add(span.start);
    boundaries.add(span.end);
  }
  const points = [...boundaries].sort((a, b) => a - b);

  const segments: HighlightSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i];
    const segEnd = points[i + 1];
    const covering = spans.filter((span) => span.start <= segStart && segEnd <= span.end).map((span) => span.index);
    segments.push({ text: narrative.slice(segStart, segEnd), proposalIndexes: covering });
  }
  return segments;
}

function actionsEqual(a: ProposedAction, b: ProposedAction): boolean {
  if (a.fieldId !== b.fieldId || a.type !== b.type) return false;
  return a.type === "answer" && b.type === "answer" ? a.value === b.value : true;
}

// --- the value <- quote pairing the panel renders (Issue #73, #60) -------
//
// design.md: the read-back confirm "is the correspondence check", and a
// value paired with a quote "must present it as a reading of the quote".
// The panel used to show values alone, so the surface whose whole job is
// letting a clinician verify wilson read them correctly withheld the
// evidence they would check against — and it rendered an ambiguous-quote
// proposal identically to a cleanly grounded one, which are different
// claims about how far to trust the reading.
//
// Three statuses, deliberately three and not two: "this quote appears
// twice in your narrative, so I can't point at which one" and "I can't
// match this to your words at all" mean different things, and collapsing
// them would hide the second behind the first.
export type QuoteReadingStatus = "grounded" | "ambiguous" | "unlocatable";

export interface QuoteReading {
  status: QuoteReadingStatus;
  quoteText: string;
  // The reading itself, e.g. `read from “admitted her overnight”`.
  framing: string;
  // Why this reading is less than solid — null when it is grounded.
  note: string | null;
}

// The panel's own clinician-facing strings, in lib so ready.test.ts's
// no-submission-claims check and its bare-text coverage guard can reach
// them (the pattern Issue #45 established for the closing surfaces).
export const READ_BACK_COPY = {
  heading: "Here’s what I’d write",
  editToggle: "Edit narrative",
  panelHeading: "What I’d write from this",
  panelEmpty: "Nothing to fill in yet — you can still continue.",
  confirmCta: "Looks right",
  reExtractCta: "Re-extract",
  reExtractPending: "Reading through what you wrote…",
  cancelCta: "Cancel",
  narrativeEditLabel: "Edit the narrative",
  retryCta: "Try again",
  ambiguousNote: "those words appear more than once, so I can’t point at which one",
  unlocatableNote: "I couldn’t match that to your exact words above",
  // The chrome's footer copy for this surface. Object literals in the
  // component were invisible to ready.test.ts's bare-text guard, which only
  // sees JSX text — so "this file's copy is under the check" was true of
  // most of it and quietly not of these (reviewer pass, PR #82, finding 2).
  emptyStateHeadline: "Transcript ready · 0 fields written",
  emptyStateNote: "Nothing is written to the form until you approve the transcript.",
} as const;

function listLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

// The collision hint, previously inline and split by an interpolation —
// which also put it out of the copy guard's reach, and it was wrong
// (reviewer pass, PR #82, finding 2). It read "both were mentioned, so
// only one can be kept", which with two colliding FIELDS says one of the
// two fields gets dropped. Both get a value; what is kept is one candidate
// per field. Same wrongness with three candidates on one field.
export function collisionHint(labels: string[]): string {
  const list = listLabels(labels);
  return labels.length === 1
    ? `Choose a value for ${list} before continuing — more than one was mentioned, so only one can be kept.`
    : `Choose a value for ${list} before continuing — each was mentioned more than once, so only one can be kept for each.`;
}

// "read from", never a bare quotation: the value is wilson's READING of
// the clinician's words, not a claim that the value appears in them. The
// AC names the case that makes this matter — "admitted her overnight" →
// Outcome: Hospitalization, where the value appears nowhere in the quote.
// Copy that presented the pair as if it did would misattribute wilson's
// inference to the clinician.
export function readingFraming(quoteText: string): string {
  return `read from “${quoteText}”`;
}

// One reading per proposal, in the order given. Normalizes the narrative
// ONCE for the whole batch, unlike findQuoteSpan() — that function's own
// header points callers checking many quotes here.
//
// Uses the same searchNormalized() the highlighting does, so the panel and
// the marks above it cannot tell different stories: exactly the proposals
// this reports as grounded are the ones buildHighlightSegments() renders
// (pinned by test).
export function quoteReadings(narrative: string, proposals: NarrativeProposal[]): QuoteReading[] {
  const { normalized, map } = normalizeForMatch(narrative);
  return proposals.map((proposal) => {
    const quoteText = proposal.quote.text;
    const result = searchNormalized(normalized, map, quoteText);
    const framing = readingFraming(quoteText);
    if (result.status === "unique") {
      return { status: "grounded" as const, quoteText, framing, note: null };
    }
    if (result.status === "ambiguous") {
      return { status: "ambiguous" as const, quoteText, framing, note: READ_BACK_COPY.ambiguousNote };
    }
    return { status: "unlocatable" as const, quoteText, framing, note: READ_BACK_COPY.unlocatableNote };
  });
}

export interface FieldGroup {
  fieldId: string;
  // length 1: applies with no extra interaction. length > 1: two
  // proposals genuinely DISAGREE on this field's value (warblersafety/
  // wilson#52) — the panel must force a choice before "Looks right" is
  // available. Proposals that agree (same resolved action, different
  // supporting quotes — extraction-validator.ts's own documented case,
  // "multiple pieces of supporting context become multiple candidates,
  // not one candidate with a bag of evidence") are deduped down to one
  // entry first, so agreeing evidence never blocks confirm (reviewer
  // pass, finding).
  proposals: NarrativeProposal[];
}

// `narrative` is optional and changes only the TIE-BREAK among agreeing
// proposals — never which proposals disagree, never the grouping itself.
//
// Without it, the first of an equal-action set wins, whatever its quote is
// worth. That produced a real defect on the trust surface (reviewer pass,
// PR #82, finding 1): with one candidate citing "Rash" (twice in the
// narrative, so ambiguous) and another citing "Admitted her overnight"
// (unique), the panel rendered the ambiguous one under a caution badge
// while the prose above highlighted the other — a mark no row mentioned,
// and a warning on a value that a second accepted quote grounds cleanly.
// It never over-claimed grounding, so it was not a mis-fill; it was worse
// in a subtler way, teaching the clinician to discount the badge that
// exists to be trusted.
//
// The preference is deliberately narrow — a grounded quote beats one that
// isn't, and nothing else. Two equally-grounded (or equally-ungrounded)
// quotes keep the first, so the outcome stays deterministic and the common
// case does no extra work.
export function groupProposalsByField(proposals: NarrativeProposal[], narrative?: string): FieldGroup[] {
  const statuses = narrative === undefined ? null : quoteReadings(narrative, proposals).map((r) => r.status);
  const order: string[] = [];
  const byField = new Map<string, NarrativeProposal[]>();
  proposals.forEach((proposal, index) => {
    const id = proposal.action.fieldId;
    if (!byField.has(id)) {
      byField.set(id, []);
      order.push(id);
    }
    const existing = byField.get(id)!;
    const duplicateAt = existing.findIndex((kept) => actionsEqual(kept.action, proposal.action));
    if (duplicateAt === -1) {
      existing.push(proposal);
      return;
    }
    if (statuses === null || statuses[index] !== "grounded") return;
    const keptStatus = statuses[proposals.indexOf(existing[duplicateAt])];
    if (keptStatus !== "grounded") existing[duplicateAt] = proposal;
  });
  return order.map((fieldId) => ({ fieldId, proposals: byField.get(fieldId)! }));
}

// The panel's "value" column. `field` (when known) lets a checkbox
// proposal render as "Yes"/"No" instead of the raw "true"/"false" string
// isLegalFixedChoiceValue mandates internally — design.md: "raw manifest
// strings and PDF /Opt codes never reach the clinician" (reviewer pass,
// finding — every other checkbox UI in this app is an actual checkbox
// control, never literal true/false text). Exhaustive over
// ProposedAction's type union so a future field-action kind fails to
// compile here rather than silently falling through to no label.
export function describeProposalValue(action: ProposedAction, field?: FormFieldSpec): string {
  switch (action.type) {
    case "answer":
      return field?.type === "checkbox" ? (action.value === "true" ? "Yes" : "No") : action.value;
    case "mark_unknown":
      return UNKNOWN_SENTINEL;
    case "decline":
      return DECLINED_SENTINEL;
    case "reopen":
      return "Reopened";
    default: {
      const exhaustive: never = action;
      throw new Error(`unhandled proposed action type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export type ConfirmReadiness =
  | { ready: true; actions: ProposedAction[] }
  | { ready: false; pendingFieldIds: string[] };

// selections carries only what the clinician has picked for COLLIDING
// fields (warblersafety/wilson#52) — a non-colliding field's sole proposal
// applies with no selection needed.
export function resolveConfirmReadiness(
  groups: FieldGroup[],
  selections: ReadonlyMap<string, NarrativeProposal>,
): ConfirmReadiness {
  const pendingFieldIds: string[] = [];
  const actions: ProposedAction[] = [];
  for (const group of groups) {
    if (group.proposals.length === 1) {
      actions.push(group.proposals[0].action);
      continue;
    }
    const selected = selections.get(group.fieldId);
    if (!selected) {
      pendingFieldIds.push(group.fieldId);
      continue;
    }
    actions.push(selected.action);
  }
  if (pendingFieldIds.length > 0) {
    return { ready: false, pendingFieldIds };
  }
  return { ready: true, actions };
}

// The one write step (AC: "until then the record is unchanged") — the
// same Agenda write path any answer uses (design.md), via #41's
// applyNarrativeProposals. Repeat decisions are out of scope for this
// surface (issue #43's amended AC): Follow-ups' existing loop asks
// normally regardless of what the narrative implied, so this always
// passes an empty repeatDecisions batch. Appends the confirmed narrative
// as a clinician transcript turn — design.md's Follow-ups surface expects
// "the conversation transcript visible... wilson already accumulates it,"
// which requires the opening narrative to already be in it by the time
// Follow-ups begins. The caller (src/app/intake/IntakeFlow.tsx) is
// responsible for then running this session through talk.ts's startTalk()
// before persisting it, so the transcript ends with the Talker's first
// follow-up question — the same invariant every other stored session
// already has by the time anything loads it back.
export function confirmReadBack(handoff: ReadBackHandoff, actions: ProposedAction[]): TalkSession {
  const { record, repeatCounts } = applyNarrativeProposals(
    handoff.session.record,
    handoff.session.repeatCounts,
    actions,
    [],
  );
  return {
    transcript: [...handoff.session.transcript, { role: "clinician", text: handoff.narrative }],
    record,
    repeatCounts,
    // Carried forward unchanged — this is a hand-built literal, not a
    // spread of handoff.session, so a TalkSession field added after this
    // one was written has to be named here explicitly or it silently
    // resets on every Read-back confirm. That is exactly what happened:
    // both fields were dropped until now (reviewer pass, PR #136, finding
    // 7) — the identical shape to the processTurn bug this PR (#125)
    // already fixed elsewhere (talk.ts). Benign today only by luck (no
    // ask can have been voiced before Read-back confirms, and voiceStep()
    // tolerates undefined), one field away from mattering.
    volunteeredRepeats: handoff.session.volunteeredRepeats,
    voicedAsks: handoff.session.voicedAsks,
  };
}

// Rebuilds Read-back's collision choices from a restored draft (Issue
// #72). In lib rather than the component for this module's own stated
// reason — "provable under vitest's node environment, the component stays
// a thin wrapper" — and because the property that matters here is not
// obvious from reading it: ReadBack checks a radio by object IDENTITY
// (`selections.get(fieldId) === proposal`), so the restored selection has
// to be the very object groupProposalsByField() hands the radios, not an
// equal copy. Resolving an index against `handoff.result.proposals` gets
// that, since grouping passes those objects through by reference.
//
// Indexes are already range- and field-checked at load
// (session-storage.ts's sanitizeSelections), so the guard here is
// belt-and-braces against a caller that skips that path, not the primary
// defence.
export function restoreSelections(
  handoff: ReadBackHandoff,
  indexes: Record<string, number> | undefined,
): Map<string, NarrativeProposal> {
  const selections = new Map<string, NarrativeProposal>();
  for (const [fieldId, index] of Object.entries(indexes ?? {})) {
    const proposal = handoff.result.proposals[index];
    if (proposal?.action.fieldId === fieldId) selections.set(fieldId, proposal);
  }
  return selections;
}
