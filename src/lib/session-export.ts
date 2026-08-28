// Issue #92: the session leaves in full, client-side only.
//
// wilson's only export was the PDF, which carries the FORM and discards
// everything that produced it — the transcript, the field states, the
// repeat counts, the sweep's volunteered-repeat hints. On 2026-08-26 that
// cost directly: Steve had failed sessions on staging and no way to hand
// one over for diagnosis. lucy ships three end-of-session artifacts for
// this reason (murmurpv/lucy src/lib/export.ts, spec 08g: "the exported
// log is the session, completely"); this is the same pattern, ported.
//
// Two artifacts beside the existing PDF:
//
//   - the **record JSON** — the AgendaRecord as stored, every field's
//     state and value. What you want when the question is "what did the
//     form end up holding?"
//   - the **session bundle** — the record plus everything that produced
//     it. What you want when the question is "why?".
//
// **Client-side only.** Both are built here from state the browser
// already holds and handed to the clinician as blob downloads. No server
// round-trip, nothing persisted, nothing sent — design.md's privacy
// posture is unchanged by this unit, and a session bundle that took a
// trip through a server to be assembled would change it substantially.
//
// Pure and synchronous: everything here is a value transform, so the
// equality tests can assert bundle-equals-session directly. The DOM half
// (blob, object URL, anchor click) lives in the app layer, which is the
// only part that cannot run under tsconfig.node.json.
import type { AgendaRecord } from "./agenda";
import { stampReportDate } from "./report-date";
import type { TalkSession, TalkTurn } from "./talk";
import type { RepeatCounts, RepeatGroup } from "./topics";

// The bundle's own format version, first key in the file (see
// buildSessionBundle). Bumped when the SHAPE changes, never when the app
// does — a reader six months from now needs to know how to parse the file
// before it can care what built it.
export const BUNDLE_VERSION = 1;

// What built it. Pinned rather than imported from package.json, which
// would pull the whole manifest — dependency list included — into the
// browser bundle for the sake of one string. session-export.test.ts
// asserts the two agree, so it cannot drift silently.
export const APP_VERSION = "0.1.0";

export interface SessionBundle {
  bundleVersion: number;
  appVersion: string;
  exportedAt: string;
  transcript: TalkTurn[];
  record: AgendaRecord;
  repeatCounts: RepeatCounts;
  volunteeredRepeats: Partial<Record<RepeatGroup, true>>;
  // ask-copy.md rule 9's first-voicing amendment (#125): which authored
  // asks have had their copy rendered at least once this report — the
  // one thing on the surface that answers "why did this render the
  // arrival frame [or the ordinary re-ask frame]?" Normalized the same
  // way as volunteeredRepeats above, for the same reason (added
  // reviewer pass, PR #136, finding 7 — the #125 build omitted it).
  voicedAsks: Partial<Record<string, true>>;
}

// The record as it LEAVES — states and values both, with rule 4's auto
// field stamped.
//
// Not a values-only projection: "unknown" and "declined" are
// clinician-established states (design.md), and a diagnostic export that
// flattened them to absent would lose the exact distinction most worth
// having when a session went wrong.
//
// And stamped, because every other export path stamps: pdf-export.ts
// before filling the form, ReportChrome before previewing it, Ready
// before counting written fields. An unstamped export would put a record
// JSON saying `ReportDate: unasked` next to a PDF printing today's date
// and a counts line that included it — three artifacts off the same
// screen disagreeing about the one field the clinician is never asked
// for (reviewer pass, PR #112). stampReportDate() leaves a clinician's
// own answer alone, so this adds a date and never overwrites one.
export function sessionRecord(session: TalkSession, now: Date): AgendaRecord {
  return stampReportDate(session.record, now);
}

// `now` is a parameter, never `new Date()` inside: the caller owns the
// clock, which is what lets the tests assert an exact stamp and matches
// report-date.ts's stampReportDate() convention.
export function buildSessionBundle(session: TalkSession, now: Date): SessionBundle {
  return {
    // Key order is the file's order (JSON.stringify preserves insertion
    // order for string keys), and AC-4 asks for a version field first —
    // so a truncated or corrupted file still says what it was.
    bundleVersion: BUNDLE_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    transcript: session.transcript,
    record: sessionRecord(session, now),
    repeatCounts: session.repeatCounts,
    // Normalized, not passed through: `volunteeredRepeats` is optional on
    // TalkSession (talk.ts's additive convention), and `undefined` would
    // make JSON.stringify drop the key entirely — leaving a reader unable
    // to tell "no groups were volunteered" from "this bundle predates the
    // field".
    volunteeredRepeats: session.volunteeredRepeats ?? {},
    // Same normalization as volunteeredRepeats above, and the same
    // reason: voicedAsks is optional on TalkSession too, and `undefined`
    // would make JSON.stringify drop the key entirely — leaving a reader
    // unable to tell "nothing was voiced yet" from "this bundle predates
    // the field" (reviewer pass, PR #136, finding 7; the #125 build that
    // added voicedAsks to TalkSession omitted it here entirely).
    voicedAsks: session.voicedAsks ?? {},
  };
}

// Indented, because these files are read by people. The cost is bytes in
// a download the clinician already chose to take.
export function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// LOCAL date, not toISOString(): a session exported at 8pm on the 27th in
// a western timezone would carry tomorrow's date in its filename and
// disagree with the day the clinician remembers doing the work.
function dateStamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function recordFilename(now: Date): string {
  return `wilson-record-${dateStamp(now)}.json`;
}

export function bundleFilename(now: Date): string {
  return `wilson-session-${dateStamp(now)}.json`;
}

// In lib, like every other clinician-facing string (src/lib/ready.ts's
// header records why): the copy-level no-submission-claims check has to
// be able to reach it.
export const SESSION_EXPORT_COPY = {
  heading: "Download your session data",
  recordCta: "Download the record (JSON)",
  bundleCta: "Download the whole session (JSON)",
  hint: "The record is what the form holds. The whole session adds the conversation behind it — useful if something went wrong and someone needs to look. Both are built here and stay in this browser.",
} as const;
