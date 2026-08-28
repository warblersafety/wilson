// Issue #92: the session leaves in full, or it did not leave.
//
// The equality tests are the unit's point, not a formality. On 2026-08-26
// Steve had failed sessions on staging and no way to hand them over —
// wilson's only export was the PDF, which carries the FORM and discards
// everything that produced it: the transcript, the field states, the
// repeat counts. A bundle that is subtly not the session would have cost
// exactly as much as having no bundle at all, so what is asserted here is
// identity, turn-for-turn and field-for-field, never a spot check.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyAction, initAgenda } from "./agenda";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import {
  APP_VERSION,
  BUNDLE_VERSION,
  bundleFilename,
  buildSessionBundle,
  recordFilename,
  serializeJson,
  SESSION_EXPORT_COPY,
  sessionRecord,
} from "./session-export";
import { REPORT_DATE_FIELD_ID, stampReportDate } from "./report-date";
import { initTalkSession, type TalkSession } from "./talk";
import { scriptedSteps } from "./ux-floor";

const EXPORTED_AT = new Date("2026-08-27T14:31:09.000Z");

// The scripted flow #91's floor already drives, taken to done — a real
// walk through the real Talker, not a hand-built session. Its last step
// carries everything the bundle claims to hold.
async function scriptedSession(): Promise<TalkSession> {
  const steps = await scriptedSteps();
  return steps[steps.length - 1].session;
}

// A session that has been through every shape a transcript turn can take:
// a typed clinician turn, a chip tap (source: "widget"), and the talker's
// own replies. AC-1 names widget-sourced turns specifically, and they are
// the ones a naive `transcript.filter(...)` would drop.
async function sessionWithEveryTurnKind(): Promise<TalkSession> {
  const session = await scriptedSession();
  return {
    ...session,
    transcript: [
      ...session.transcript,
      { role: "clinician", text: "One more thing — she'd had amoxicillin before with no trouble." },
      { role: "clinician", text: "Was there another suspect product? — No", source: "widget" },
    ],
    volunteeredRepeats: { "suspect-product": true },
  };
}

describe("the session bundle", () => {
  it("carries every field AC-1 names", async () => {
    const session = await sessionWithEveryTurnKind();
    const bundle = buildSessionBundle(session, EXPORTED_AT);
    expect(Object.keys(bundle)).toEqual([
      "bundleVersion",
      "appVersion",
      "exportedAt",
      "transcript",
      "record",
      "repeatCounts",
      "volunteeredRepeats",
      "voicedAsks",
    ]);
  });

  // AC-4's "self-describing (a version field first)". Asserted on the
  // serialized bytes, not the object: what a reader opens is the file,
  // and JSON key order is only a property of how it was written.
  it("declares its version in the first line of the file", async () => {
    const bundle = buildSessionBundle(await scriptedSession(), EXPORTED_AT);
    const text = serializeJson(bundle);
    expect(text.split("\n")[1]).toContain(`"bundleVersion": ${BUNDLE_VERSION}`);
  });

  it("stamps the export time it was given, never the wall clock", async () => {
    const bundle = buildSessionBundle(await scriptedSession(), EXPORTED_AT);
    expect(bundle.exportedAt).toBe("2026-08-27T14:31:09.000Z");
  });

  // AC-5, first half: the bundle IS the session.
  it("equals the session's transcript turn for turn, widget turns included", async () => {
    const session = await sessionWithEveryTurnKind();
    const bundle = buildSessionBundle(session, EXPORTED_AT);
    expect(bundle.transcript).toEqual(session.transcript);
    expect(bundle.transcript.length).toBeGreaterThan(20);
    // Not just deep-equal by luck: the two turn shapes are both present,
    // and `source` survives.
    expect(bundle.transcript.filter((turn) => turn.source === "widget")).toHaveLength(1);
    expect(bundle.transcript.some((turn) => turn.role === "talker")).toBe(true);
    // Turn for turn, so a reordering or a dropped middle turn fails here
    // and not only in the length.
    for (const [i, turn] of session.transcript.entries()) {
      expect(bundle.transcript[i], `turn ${i}`).toEqual(turn);
    }
  });

  it("equals the session's record field for field, all 227 but the stamp", async () => {
    const session = await scriptedSession();
    const bundle = buildSessionBundle(session, EXPORTED_AT);
    expect(Object.keys(bundle.record)).toHaveLength(FORM_3500_FIELDS.length);
    for (const field of FORM_3500_FIELDS) {
      // ReportDate is rule 4's auto field, stamped on the way out by
      // every export path in the codebase (see "the record JSON" below).
      // It is the ONE field allowed to differ, and it is exempted by name
      // rather than by a loose comparison — 226 fields still have to be
      // identical, and a second field drifting fails here.
      if (field.id === REPORT_DATE_FIELD_ID) continue;
      expect(bundle.record[field.id], field.id).toEqual(session.record[field.id]);
    }
    expect(bundle.record[REPORT_DATE_FIELD_ID].state).toBe("answered");
  });

  it("carries the repeat counts and the volunteered repeats as they stand", async () => {
    const session = await sessionWithEveryTurnKind();
    const bundle = buildSessionBundle(session, EXPORTED_AT);
    expect(bundle.repeatCounts).toEqual(session.repeatCounts);
    expect(bundle.volunteeredRepeats).toEqual({ "suspect-product": true });
  });

  // A session that predates `volunteeredRepeats` is still a valid
  // TalkSession with it absent (talk.ts's additive convention). The
  // bundle must be readable either way rather than carrying `undefined`
  // into JSON, where the key would silently vanish.
  it("normalizes an absent volunteeredRepeats to an empty object", () => {
    const session: TalkSession = { ...initTalkSession(), volunteeredRepeats: undefined };
    const bundle = buildSessionBundle(session, EXPORTED_AT);
    expect(bundle.volunteeredRepeats).toEqual({});
    expect(JSON.parse(serializeJson(bundle))).toHaveProperty("volunteeredRepeats");
  });

  // Reviewer pass, PR #136, finding 7: the bundle omitted voicedAsks
  // entirely — #125's own new field, added to TalkSession by this same
  // unit, dropped from the one surface built to answer "why did this
  // render the arrival frame". A full scripted walk voices real asks, so
  // this is not a vacuous equality against an empty object.
  it("carries voicedAsks as they stand, the same way it carries volunteeredRepeats", async () => {
    const session = await scriptedSession();
    const bundle = buildSessionBundle(session, EXPORTED_AT);
    expect(bundle.voicedAsks).toEqual(session.voicedAsks);
    expect(Object.keys(bundle.voicedAsks).length).toBeGreaterThan(0);
  });

  // Same normalization as volunteeredRepeats above, and the same reason:
  // a session that predates voicedAsks is still a valid TalkSession with
  // it absent.
  it("normalizes an absent voicedAsks to an empty object", () => {
    const session: TalkSession = { ...initTalkSession(), voicedAsks: undefined };
    const bundle = buildSessionBundle(session, EXPORTED_AT);
    expect(bundle.voicedAsks).toEqual({});
    expect(JSON.parse(serializeJson(bundle))).toHaveProperty("voicedAsks");
  });

  // The whole bundle survives a write/read cycle — the thing that
  // actually happens when Steve opens a handed-over file.
  it("round-trips through JSON unchanged", async () => {
    const bundle = buildSessionBundle(await sessionWithEveryTurnKind(), EXPORTED_AT);
    expect(JSON.parse(serializeJson(bundle))).toEqual(bundle);
  });
});

describe("the record JSON", () => {
  // AC-5, second half. Compared against the stamped record, which is what
  // leaves — see the ReportDate tests below.
  it("round-trips through JSON.parse to the stored record", async () => {
    const session = await scriptedSession();
    const exported = sessionRecord(session, EXPORTED_AT);
    expect(JSON.parse(serializeJson(exported))).toEqual(exported);
    // Everything the clinician established is untouched: the stamp is the
    // only difference between what is stored and what leaves.
    for (const field of FORM_3500_FIELDS) {
      if (field.id === REPORT_DATE_FIELD_ID) continue;
      expect(exported[field.id], field.id).toEqual(session.record[field.id]);
    }
  });

  it("carries field states and values, not just values", () => {
    const record = applyAction(initAgenda(), "Page1.SecA_Patient.AgeValue", { type: "answer" }, "58");
    const exported = JSON.parse(serializeJson(sessionRecord({ ...initTalkSession(), record }, EXPORTED_AT)));
    expect(exported["Page1.SecA_Patient.AgeValue"]).toEqual({ state: "answered", value: "58" });
    expect(exported["Page1.SecA_Patient.DateBirth"]).toEqual({ state: "unasked" });
  });

  // Reviewer pass, PR #112. Every other export path stamps rule 4's auto
  // field — pdf-export.ts, ReportChrome, Ready's own counts line — so an
  // unstamped JSON put three artifacts off one screen in disagreement
  // about the field the clinician is never asked for.
  it("stamps ReportDate, the way every other export path does", async () => {
    const session = await scriptedSession();
    expect(session.record[REPORT_DATE_FIELD_ID].state).toBe("unasked");
    const exported = sessionRecord(session, new Date(2026, 7, 27, 12, 0));
    expect(exported[REPORT_DATE_FIELD_ID]).toEqual({ state: "answered", value: "2026-08-27" });
  });

  it("agrees with the PDF downloaded beside it", async () => {
    const session = await scriptedSession();
    const now = new Date(2026, 7, 27, 12, 0);
    // pdf-export.ts fills from stampReportDate(record, today); the JSON
    // must be the same record, not a differently-derived one.
    expect(sessionRecord(session, now)).toEqual(stampReportDate(session.record, now));
    expect(buildSessionBundle(session, now).record).toEqual(stampReportDate(session.record, now));
  });

  it("never overwrites a report date the clinician gave", async () => {
    const session = await scriptedSession();
    const stated = applyAction(session.record, REPORT_DATE_FIELD_ID, { type: "answer" }, "2026-08-01");
    const exported = sessionRecord({ ...session, record: stated }, new Date(2026, 7, 27, 12, 0));
    expect(exported[REPORT_DATE_FIELD_ID].value).toBe("2026-08-01");
  });
});

describe("filenames", () => {
  // AC-4. A date stamp, because a clinician who exports two sessions in a
  // week needs to tell the files apart in a downloads folder.
  it("stamp both artifacts with the export date", () => {
    // Built in local time, not parsed from a UTC string: a runner east of
    // UTC+10 would read "2026-08-27T14:31Z" as the 28th and fail this on
    // a machine nobody is looking at.
    const noon = new Date(2026, 7, 27, 12, 0);
    expect(recordFilename(noon)).toBe("wilson-record-2026-08-27.json");
    expect(bundleFilename(noon)).toBe("wilson-session-2026-08-27.json");
  });

  it("stamps in local time, the way a clinician reads a date", () => {
    // Not toISOString(): a session exported at 8pm on the 27th in a
    // western timezone would be stamped the 28th, and the file would
    // disagree with the day the clinician remembers doing the work.
    const evening = new Date(2026, 7, 27, 20, 30);
    expect(bundleFilename(evening)).toBe("wilson-session-2026-08-27.json");
  });
});

describe("the app version", () => {
  // The bundle's whole purpose is diagnosing a session after the fact,
  // which needs to know what built it. Pinned rather than imported so the
  // browser bundle carries a string instead of package.json.
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(APP_VERSION).toBe(pkg.version);
  });
});

describe("copy", () => {
  // design.md's no-submission-claims rule reaches every surface, and this
  // unit adds buttons to two of them. ready.test.ts's own check covers
  // these strings too; this is the version that fails in the file that
  // owns them.
  it.each(["filed", "file ", "submitted", "submission", "confirmation", "medwatch"])(
    "never says %s",
    (forbidden) => {
      for (const line of Object.values(SESSION_EXPORT_COPY)) {
        expect(line.toLowerCase()).not.toContain(forbidden);
      }
    },
  );

  it("says plainly that the download is data, not a report going anywhere", () => {
    expect(SESSION_EXPORT_COPY.hint).toContain("stay in this browser");
  });
});

// AC-3 and AC-1/AC-2's wiring, checked structurally. No jsdom or
// testing-library exists in this repo (see end-condition-flow.test.ts's
// header for why), so "the surface offers this" is proven the way
// globals.test.ts proves a token exists: by reading the source. Weaker
// than a render test and stronger than a manual note nobody re-runs.
describe("the export path, structurally", () => {
  const read = (relPath: string) => readFileSync(join(process.cwd(), relPath), "utf8");

  // AC-3: "client-side blob downloads — no server round-trip, no
  // persistence (design.md's privacy posture unchanged)". The two modules
  // that build and deliver the files may not reach the network or storage
  // at all — a privacy claim the copy makes out loud ("stay in this
  // browser") should not rest on nobody having added a fetch yet.
  it.each(["src/lib/session-export.ts", "src/app/intake/download-file.ts"])(
    "%s neither calls out nor persists",
    (path) => {
      // Raw source, comments included. Stripping `//` to end-of-line
      // would hide a forbidden token later on the same line, and neither
      // file mentions one in a comment — so the strip only weakened the
      // one check standing behind a privacy claim the copy makes out
      // loud (reviewer pass, PR #112).
      const source = read(path);
      for (const forbidden of ["fetch(", "localStorage", "sessionStorage", "XMLHttpRequest", "navigator.send"]) {
        expect(source, `${path} contains ${forbidden}`).not.toContain(forbidden);
      }
      // "use server" is how a Server Action gets in; src/app/actions.ts is
      // the only file in this repo that carries one.
      expect(source).not.toContain("use server");
      expect(source).not.toContain("@/app/actions");
    },
  );

  it("builds the blob in the browser, from a value it was handed", () => {
    const source = read("src/app/intake/download-file.ts");
    expect(source).toContain("URL.createObjectURL");
    expect(source).toContain("URL.revokeObjectURL");
    expect(source).toContain("new Blob(");
  });

  // AC-1: Ready offers three downloads. AC-2: Review offers the same
  // session-data affordance beside its existing draft-PDF toggle.
  it.each([
    ["src/app/intake/Ready.tsx", "READY_COPY.downloadCta"],
    ["src/app/intake/Review.tsx", "REVIEW_COPY.downloadDraftCta"],
  ])("%s offers the session downloads alongside its PDF", (path, pdfCta) => {
    const source = read(path);
    expect(source).toContain("<SessionDownloads session={session} />");
    expect(source).toContain(pdfCta);
  });

  it("offers both JSON artifacts through one shared component", () => {
    const source = read("src/app/intake/SessionDownloads.tsx");
    expect(source).toContain("SESSION_EXPORT_COPY.recordCta");
    expect(source).toContain("SESSION_EXPORT_COPY.bundleCta");
    expect(source).toContain("recordFilename(");
    expect(source).toContain("bundleFilename(");
  });
});
