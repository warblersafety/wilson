// The Read-back surface's pure logic (Issue #43) — design.md's "Interaction
// model and UI", surface 2: the trust moment where the clinician sees what
// wilson would write before anything is written. Kept out of the component
// for the same reason src/lib/start-surface.ts is: provable under vitest's
// node environment, the component stays a thin wrapper.
import { normalizeWithAlignment } from "./extraction-validator";
import { applyNarrativeProposals, type NarrativeProposal } from "./narrative-extract";
import type { ReadBackHandoff } from "./start-surface";
import type { ProposedAction, TalkSession } from "./talk";

// The correctness risk the issue itself names: a highlight on the wrong
// span misattributes a value to words the clinician didn't say. "unique"
// is the only status that ever produces a rendered highlight — the panel,
// not the highlighting, remains the complete/authoritative list (AC),
// so a missed highlight here is a cosmetic loss, never a silent mis-fill.
export type QuoteSpanResult =
  | { status: "unique"; start: number; end: number }
  | { status: "ambiguous" }
  | { status: "not-found" };

// Finds every occurrence of `quoteText` in `narrative` under the identical
// normalization the grounding validator accepted the quote against
// (normalizeWithAlignment, not a second hand-derived copy of its rules),
// then translates a unique match's normalized-space position back into an
// original-text span via the alignment map.
export function findQuoteSpan(narrative: string, quoteText: string): QuoteSpanResult {
  const { normalized: normNarrative, map } = normalizeWithAlignment(narrative);
  const normQuote = normalizeWithAlignment(quoteText).normalized;
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
// produce distinct segments for their non-shared portions.
export function buildHighlightSegments(narrative: string, proposals: NarrativeProposal[]): HighlightSegment[] {
  const spans: { start: number; end: number; index: number }[] = [];
  proposals.forEach((proposal, index) => {
    const result = findQuoteSpan(narrative, proposal.quote.text);
    if (result.status === "unique") {
      spans.push({ start: result.start, end: result.end, index });
    }
  });

  if (spans.length === 0) {
    return narrative.length === 0 ? [] : [{ text: narrative, proposalIndexes: [] }];
  }

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
    if (segStart === segEnd) continue;
    const covering = spans.filter((span) => span.start <= segStart && segEnd <= span.end).map((span) => span.index);
    segments.push({ text: narrative.slice(segStart, segEnd), proposalIndexes: covering });
  }
  return segments;
}

export interface FieldGroup {
  fieldId: string;
  // length 1: applies with no extra interaction. length > 1: warblersafety/wilson#52
  // — the panel must force a choice before "Looks right" is available.
  proposals: NarrativeProposal[];
}

export function groupProposalsByField(proposals: NarrativeProposal[]): FieldGroup[] {
  const order: string[] = [];
  const byField = new Map<string, NarrativeProposal[]>();
  for (const proposal of proposals) {
    const id = proposal.action.fieldId;
    if (!byField.has(id)) {
      byField.set(id, []);
      order.push(id);
    }
    byField.get(id)!.push(proposal);
  }
  return order.map((fieldId) => ({ fieldId, proposals: byField.get(fieldId)! }));
}

// The panel's "value" column. Exhaustive over ProposedAction's type union
// so a future field-action kind fails to compile here rather than
// silently falling through to no label.
export function describeProposalValue(action: ProposedAction): string {
  switch (action.type) {
    case "answer":
      return action.value;
    case "mark_unknown":
      return "Unknown";
    case "decline":
      return "Declined to answer";
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
// Follow-ups begins.
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
  };
}
