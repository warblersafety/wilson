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
import { unresolvedAskFieldIds, unresolvedFactNames, type AuthoredAsk } from "./ask-inventory";
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
// across the pair.
export function reAskFrame(names: string[]): string {
  if (names.length === 0) {
    throw new Error("reAskFrame: a re-ask must name at least one still-open fact");
  }
  if (names.length === 1) return `And the ${names[0]}?`;
  return `Got it. Still need: ${joinNames(names)}.`;
}

// The question for an ask, given the record as it stands. Untouched asks
// get their authored copy; a partially answered one gets rule 9's frame
// over exactly the facts still open. Pure — exported so the UX-floor
// checks (#91) can enumerate every topic and both repeat instances
// without driving a session.
export function askCopy(ask: AuthoredAsk, record: AgendaRecord): string {
  const unresolved = unresolvedAskFieldIds(ask, record);
  if (unresolved.length === 0) {
    throw new Error(`askCopy: ${ask.id} has nothing left to ask`);
  }
  if (unresolved.length === ask.askFieldIds.length) return ask.copy;
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
  return askCopy(step.ask, session.record);
};
