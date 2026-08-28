// The Talker's voice. Every string a clinician reads on Follow-ups comes
// from docs/ask-copy.md — the authored inventory (src/lib/ask-inventory.ts)
// for the questions themselves, and this file for the walk's non-ask
// machinery copy and rule 9's re-ask frames.
//
// **What this file used to be, and why none of it survives.** v1.1
// generated question text from manifest labels: the text after the last
// ":", lowercased, plus "(yes or no)" for checkboxes, three fields joined
// per ask. It produced "What's the yes (yes or no), the no (yes or no),
// and the doesn't apply (yes or no)?" and 58-82 asks where the mockups
// promise 9 topics, and Steve rejected the deployed build on first
// contact (2026-08-26). ask-copy.md rule 1: "Generating question text
// from manifest labels is a defect. The template path in ask.ts is
// removed, not kept as a fallback." So the override table, the
// last-segment rule, the row-pattern transform, the options suffix, and
// MAX_FIELDS_PER_ASK are gone rather than demoted — a topic with no
// authored copy now throws (ask-inventory.ts's asksForTopic), which
// ask-inventory.test.ts turns into a build error instead of a runtime
// fallback nobody notices until a clinician reads it.
//
// No model call anywhere, same as before: asking a clear question doesn't
// need interpretation the way parsing a loose answer does.
import {
  heldFieldNames,
  resolvedFactNames,
  unresolvedAskFieldIds,
  unresolvedFactNames,
  type AuthoredAsk,
} from "./ask-inventory";
import { joinNames } from "./display-names";
import type { AgendaRecord } from "./agenda";
import type { NextStep, RepeatGroup } from "./topics";
import type { AskFn } from "./talk";

// ask-copy.md, "Machinery copy" — authored here so rule 1's coverage is
// total and the copy-equality check carries no exemptions.
export const DONE_MESSAGE = "That's everything I need to ask. Review the report before you sign off.";

export const REPEAT_DECISION_COPY: Record<RepeatGroup, string> = {
  "suspect-product": "Was there another suspect product?",
  "concomitant-medication": "Is there another medication to add?",
};

// Prefixed to the group's repeat decision when the widened sweep already
// saw a later instance volunteered earlier in the conversation.
export const VOLUNTEERED_REPEAT_HINT = "You mentioned another one earlier — ";

// A repeat group's human label, for followup-sweep.ts's
// sweep-acknowledgment phrasing — the same concept wherever it is said in
// a sentence.
export const REPEAT_GROUP_LABELS: Record<RepeatGroup, string> = {
  "suspect-product": "suspect product",
  "concomitant-medication": "concomitant medication",
};

// Rule 9. An ask whose answer left some of its facts open is re-asked
// through one of these frames, composed from display names — never by
// repeating the primary ask, so the no-consecutive-duplicates check holds
// across the pair. Correct ONLY once the ask has already been voiced
// this report (askCopy() below is what enforces that precondition) —
// used bare, this is the frame gate run #1 caught rendering as a topic's
// first utterance (entry 1).
export function reAskFrame(names: string[]): string {
  if (names.length === 0) {
    throw new Error("reAskFrame: a re-ask must name at least one still-open fact");
  }
  if (names.length === 1) return `And the ${names[0]}?`;
  return `Got it. Still need: ${joinNames(names)}.`;
}

// Rule 9's arrival frame, added 2026-08-28 (#125): a topic can reach its
// turn already partially resolved — narrative extraction confirmed at
// Read-back, or facts volunteered out-of-ask under rule 8 — and this is
// what renders the FIRST time that happens, instead of reAskFrame()
// standing in for an ask the clinician never saw. "I've got {resolved
// names}. Still need: {open names}." for an ordinary ask; the three
// bulk-mapped facts (RC-1, DV-1, SP-9) cannot split their one fact into
// resolved/open names, so their ask half is the authored `arrivalAsk`
// line instead, prefixed by the individual HELD field names — never
// rendered bare, since the prefix is what gives "the rest" its referent.
//
// Called only through askCopy() below in production, which never invokes
// this on a fully-open ask (its own primary-copy branch handles that) —
// but this stays self-defending rather than trusting the caller (reviewer
// pass, PR #136, finding 8): a direct call on a fully-open record throws
// its own named error, matching reAskFrame()'s precondition check above,
// instead of dying inside joinNames() with a message that names no ask
// and no reason.
//
// A second, non-obvious empty case (reviewer pass, PR #136, finding 2's
// fix surfaced this — not anticipated by the review itself): a field can
// be individually resolved without completing any FACT at all, when that
// fact requires every member before it settles (`voicesEveryMember` or
// `exclusive` — WH-2's "report type" is exactly this). askCopy()'s own
// gate is field-level ("is anything resolved"), so it happily enters
// here with resolvedFactNames() coming back empty — genuinely reachable,
// not synthetic: ask.test.ts's scripted-walk suite hits it by seeding
// one report-type checkbox before the walk starts, the same shape a real
// narrative ("the device malfunctioned") would leave from extraction.
// There is nothing truthful to report holding yet, so this renders
// exactly what a never-arrived ask renders: the primary copy — never a
// broken "I've got . Still need: ..." sentence.
export function arrivalFrame(ask: AuthoredAsk, record: AgendaRecord): string {
  if (unresolvedAskFieldIds(ask, record).length === ask.askFieldIds.length) {
    throw new Error(`arrivalFrame: ${ask.id} is fully open — there is nothing resolved to frame as an arrival`);
  }
  const bulkFact = ask.facts?.find((fact) => fact.arrivalAsk !== undefined);
  if (bulkFact !== undefined) {
    return `I've got ${joinNames(heldFieldNames(ask, record))}. ${bulkFact.arrivalAsk}`;
  }
  const resolved = resolvedFactNames(ask, record);
  if (resolved.length === 0) return ask.copy;
  const open = unresolvedFactNames(ask, record);
  return `I've got ${joinNames(resolved)}. Still need: ${joinNames(open)}.`;
}

// The question for an ask, given the record as it stands and whether the
// ask has already been voiced this report. Rule 9, by arrival state:
//
// - All facts open (nothing resolved) — the primary authored copy,
//   always, voiced or not.
// - Some resolved, some open, and never voiced this report — the
//   arrival frame: this IS what voices it (the caller is responsible for
//   recording that — see talk.ts's voiceStep()).
// - Some resolved, some open, and already voiced — the ordinary re-ask
//   frame, exactly as before this amendment.
// - Nothing left open — askCopy() has nothing to compose; the walk must
//   never call this for a fully resolved ask (nextStep() already skips
//   it), so this stays a throw rather than a silent empty string.
//
// Pure — exported so the UX-floor checks (#91) can enumerate every
// topic, both repeat instances, and both voicing states without driving
// a session.
export function askCopy(ask: AuthoredAsk, record: AgendaRecord, voicedThisReport: boolean): string {
  const unresolved = unresolvedAskFieldIds(ask, record);
  if (unresolved.length === 0) {
    throw new Error(`askCopy: ${ask.id} has nothing left to ask`);
  }
  if (unresolved.length === ask.askFieldIds.length) return ask.copy;
  if (!voicedThisReport) return arrivalFrame(ask, record);
  // Facts, not fields (rule 2): a half-answered PB-1 asks "And the sex?",
  // never "Still need: sex: male and sex: female."
  return reAskFrame(unresolvedFactNames(ask, record));
}

export const askDeterministic: AskFn = async (step: NextStep, session) => {
  if (step.kind === "done") return DONE_MESSAGE;
  if (step.kind === "repeat-decision") {
    const base = REPEAT_DECISION_COPY[step.repeatGroup];
    // Once decided (yes or no), nextStep() never returns this step for
    // the group again, so the hint naturally stops appearing — nothing
    // here needs to clear it.
    return session.volunteeredRepeats?.[step.repeatGroup] ? `${VOLUNTEERED_REPEAT_HINT}${base}` : base;
  }
  return askCopy(step.ask, session.record, session.voicedAsks?.[step.ask.id] === true);
};
