// The Ready surface's pure logic and copy (Issue #45) — design.md's
// surface 6: "honest completion: the filled PDF to download,
// answered/unknown/declined counts, and the reminder that wilson stores
// nothing on its own servers... No submission claims."
import { describe, expect, it } from "vitest";
import { applyAction, initAgenda } from "./agenda";
import { OPEN_FIELD_REASONS, OPEN_FIELDS_COPY, openFieldsHeading } from "./open-fields";
import { collisionHint, READ_BACK_COPY, readingFraming } from "./read-back";
import { START_COPY } from "./start-surface";
import { SESSION_EXPORT_COPY } from "./session-export";
import { PDF_COPY, REVIEW_COPY, SIGN_OFF_CTA } from "./review";
import {
  formatReadyCounts,
  READY_COPY,
  readyCounts,
  readySurfaceView,
  START_OVER_CONFIRM_COPY,
} from "./ready";

const PATIENT_IDENTIFIER = "Page1.SecA_Patient.PatientIdentifier";
const SUSPECT_1_LOT = "Page4.Prod1.Prod1LotNum";
const DESC_EVENT = "Page2.SecB_Adverse.DescEvent";

describe("readyCounts", () => {
  it("splits three ways, unlike the chrome footer's two", () => {
    // Sibling to report-chrome.ts's recordFieldCounts(), never a
    // replacement: the footer groups declined with unknown, and design.md
    // quotes it that way ("18 fields written · 2 unknown"). Ready names
    // all three, per its own AC.
    let record = applyAction(initAgenda(), PATIENT_IDENTIFIER, { type: "answer" }, "M.R. / 4471-08");
    record = applyAction(record, SUSPECT_1_LOT, { type: "mark_unknown" });
    record = applyAction(record, DESC_EVENT, { type: "decline" });
    expect(readyCounts(record)).toEqual({ answered: 1, unknown: 1, declined: 1 });
  });

  it("counts `unasked` fields in no bucket at all", () => {
    // Screen 07's own math confirms this: "41 written · 3 unknown · 0
    // declined" sums to 44, not the form's 227 fields.
    const counts = readyCounts(initAgenda());
    expect(counts).toEqual({ answered: 0, unknown: 0, declined: 0 });
  });

  it("does not silently drop a field the record has no entry for", () => {
    const record = initAgenda();
    delete record[PATIENT_IDENTIFIER];
    // A stale/mismatched record degrades to "unasked" rather than
    // crashing the surface — the same defensive convention every other
    // AgendaRecord reader in this codebase uses.
    expect(() => readyCounts(record)).not.toThrow();
    expect(readyCounts(record).answered).toBe(0);
  });

  // ask-copy.md rule 4's auto field (added 2026-08-29, #127): ReportDate
  // is wilson's write, not the clinician's — Ready.tsx counts the
  // STAMPED record (the one the download actually carries), so without
  // this exclusion `answered` never reads zero even on a session the
  // clinician answered nothing in.
  it("excludes the auto ReportDate field even once it is stamped", () => {
    const record = initAgenda();
    record["Page1.SecA_Patient.ReportDate"] = { state: "answered", value: "2026-08-29" };
    expect(readyCounts(record)).toEqual({ answered: 0, unknown: 0, declined: 0 });
  });
});

describe("formatReadyCounts", () => {
  it("matches screen 07's summary row verbatim", () => {
    expect(formatReadyCounts({ answered: 41, unknown: 3, declined: 0 })).toBe("41 written · 3 unknown · 0 declined");
  });

  it("keeps every bucket visible at zero — an honest count never hides a bucket", () => {
    expect(formatReadyCounts({ answered: 0, unknown: 0, declined: 0 })).toBe("0 written · 0 unknown · 0 declined");
  });
});

describe("copy — the no-submission-claims rule, asserted mechanically", () => {
  // design.md: "wilson fills and exports the form, like lucy; there is no
  // MedWatch e-submission pipeline, so no 'filed with FDA' language and
  // no confirmation numbers anywhere in the UI." This is AC-3's
  // "asserted by a copy-level check" option, taken instead of leaning on
  // the manual-check note alone.
  // Every clinician-facing string the three closing surfaces render, not
  // only the ones that happened to start out as constants — AC-3's rule is
  // "anywhere in the UI" (reviewer pass, PR #78, finding 3). If a string
  // renders on Review, the Open-fields dialog, or Ready, it is in this
  // list; the components hold no literals of their own.
  const ALL_COPY = [
    ...Object.values(READY_COPY),
    ...Object.values(START_OVER_CONFIRM_COPY),
    ...Object.values(REVIEW_COPY),
    ...Object.values(PDF_COPY),
    ...Object.values(OPEN_FIELDS_COPY),
    ...Object.values(OPEN_FIELD_REASONS),
    // Issue #73 extends the same check to the two surfaces #63 covers —
    // the rule is "anywhere in the UI", and Start's privacy paragraph in
    // particular is the copy most able to make a claim it shouldn't.
    ...Object.values(READ_BACK_COPY),
    ...Object.values(START_COPY),
    // Issue #92 puts two more buttons and a hint on both closing
    // surfaces; the rule is "anywhere in the UI".
    ...Object.values(SESSION_EXPORT_COPY),
    openFieldsHeading(1),
    openFieldsHeading(7),
    readingFraming("admitted her overnight"),
    collisionHint(["Age"]),
    collisionHint(["Age", "Outcome"]),
    SIGN_OFF_CTA,
  ];

  it.each(["filed", "file ", "submitted", "submission", "confirmation", "medwatch"])(
    "never says %s",
    (forbidden) => {
      for (const line of ALL_COPY) {
        expect(line.toLowerCase()).not.toContain(forbidden);
      }
    },
  );

  it("carries no confirmation-number-shaped string", () => {
    for (const line of ALL_COPY) {
      expect(line).not.toMatch(/\b[A-Z]{2,}-\d{4}-\d{2}-\d{4}\b/);
    }
  });

  it("scopes the storage claim to wilson's own servers, never the whole path", () => {
    // The privacy-copy rule: a claim about wilson's storage, never an
    // implication that the model-provider path is unretained while the
    // DPA item is open.
    expect(READY_COPY.storage).toContain("wilson stores nothing on its own servers");
    expect(READY_COPY.storage).toContain("this download is your copy");
  });

  it("heads the surface with readiness, not a filing", () => {
    expect(READY_COPY.heading).toBe("Report ready.");
  });

  it("the failure heading never repeats the ready claim", () => {
    // AC-1 (Issue #128) belongs to readySurfaceView below, but the
    // constant itself carries the same rule: whatever replaces "Report
    // ready." while generation has failed must not itself be another way
    // of saying it.
    expect(READY_COPY.failureHeading).not.toBe(READY_COPY.heading);
    expect(READY_COPY.failureHeading.toLowerCase()).not.toContain("ready");
  });

  it("the PDF failure copy names no cause the app hasn't established", () => {
    // AC-2 (Issue #128): PdfExportError's two cases — pdf-export.ts's
    // transport failure and its non-ok-response case, a 404 under `next
    // dev` since api/generate-pdf.py is a Vercel function that doesn't run
    // locally — are collapsed into one message by design (they ask the
    // same thing of the clinician), but "check your connection" is only
    // ever true of the first. Mechanical rather than a re-read of one
    // string, so a future edit that reintroduces a guessed cause fails
    // here instead of waiting for a round-gate case to notice.
    for (const guess of ["connection", "network", "wifi", "internet", "offline"]) {
      expect(PDF_COPY.failure.toLowerCase()).not.toContain(guess);
    }
  });
});

describe("readySurfaceView — one PDF-generation state at a time (Issue #128)", () => {
  // The Ready surface's whole rendering decision for a given
  // usePdfExport() status, kept here so it is provable under vitest's node
  // environment (src/lib has no DOM lib) rather than only by reading
  // Ready.tsx. The component is a thin switch over this — see the
  // companion "renders through readySurfaceView" test below — so what
  // this proves is what actually renders, not a parallel claim about it.
  it("attempting: claims the record's sign-off, not a failure", () => {
    const view = readySurfaceView("loading");
    expect(view.state).toBe("attempting");
    expect(view.heading).toBe(READY_COPY.heading);
    expect(view.showGenerating).toBe(true);
    expect(view.downloadEnabled).toBe(false);
    expect(view.failureMessage).toBeNull();
  });

  it("succeeded: the ready claim, download enabled, no failure remnant", () => {
    const view = readySurfaceView("ready");
    expect(view.state).toBe("succeeded");
    expect(view.heading).toBe(READY_COPY.heading);
    expect(view.downloadEnabled).toBe(true);
    expect(view.showGenerating).toBe(false);
    expect(view.failureMessage).toBeNull();
  });

  it("failed: no ready claim, no download offered, the failure copy shown", () => {
    // Finding 1 and finding 2 from Issue #128, both asserted at once: the
    // heading is never the ready one while failed (finding 1's first
    // half), the download CTA is not offered at all — not even disabled —
    // beside the failure notice (finding 1's second half), and the
    // message shown is the cause-neutral one (finding 2, asserted for
    // content above; here only that this is the string actually wired in).
    const view = readySurfaceView("error");
    expect(view.state).toBe("failed");
    expect(view.heading).not.toBe(READY_COPY.heading);
    expect(view.heading).toBe(READY_COPY.failureHeading);
    expect(view.showDownload).toBe(false);
    expect(view.showGenerating).toBe(false);
    expect(view.failureMessage).toBe(PDF_COPY.failure);
  });

  it("drives failed -> retry -> succeeded, recovering with no remnant of the failure", () => {
    // AC-3, both directions: the exact status sequence usePdfExport
    // produces for a first attempt that fails, followed by a retry that
    // succeeds — mount sets "loading", the failed fetch sets "error",
    // retry() bumps `attempt` and re-runs the effect ("loading" again),
    // and the retried fetch resolves ("ready"). Nothing here reaches into
    // the hook itself (it touches the DOM: AbortController, Blob,
    // URL.createObjectURL — this file cannot import it), only the status
    // values it is documented to produce, in order.
    const sequence = ["loading", "error", "loading", "ready"] as const;
    const views = sequence.map(readySurfaceView);

    const failedView = views[1];
    expect(failedView.state).toBe("failed");
    expect(failedView.heading).not.toBe(READY_COPY.heading);
    expect(failedView.failureMessage).toBe(PDF_COPY.failure);

    const recoveredView = views[3];
    expect(recoveredView.state).toBe("succeeded");
    expect(recoveredView.heading).toBe(READY_COPY.heading);
    expect(recoveredView.downloadEnabled).toBe(true);
    expect(recoveredView.failureMessage).toBeNull();
    expect(recoveredView.showGenerating).toBe(false);
  });
});

describe("Ready.tsx renders through readySurfaceView, not its own pdf.status branches", () => {
  // The gap the tests above don't close: readySurfaceView being correct
  // proves nothing about the component unless the component actually
  // defers to it. Source-scanned rather than rendered — this repo has no
  // DOM/testing-library dependency (end-condition-flow.test.ts's own
  // docstring records that as deliberate) — matching the "no clinician-
  // facing literals" test below, which already scans this same file for a
  // different property.
  it("calls readySurfaceView(pdf.status) and branches on nothing else", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/app/intake/Ready.tsx", "utf8");
    expect(source).toContain("readySurfaceView(pdf.status)");
    const bareStatusChecks = source.match(/pdf\.status\s*(===|!==)/g) ?? [];
    expect(bareStatusChecks).toEqual([]);
  });
});

describe("no clinician-facing literals are left in the closing components", () => {
  // The copy check above is only worth as much as its coverage: a string
  // typed straight into a component is invisible to it. This is the
  // coverage guard (reviewer pass, PR #78, finding 3) — it reads the
  // component sources and fails on a rendered text literal that is not a
  // lib constant. It matches only JSX TEXT (`>text<`), not attributes or
  // class names, so ordinary markup does not trip it.
  //
  // A heuristic, and honest about being one. TypeScript generics produce
  // `>`…`<` pairs that are not JSX text at all (`useState<Map<string, X>>(()
  // =>` … `useState<{`), so a candidate carrying code punctuation or a line
  // break is skipped — which means a future sentence containing brackets or
  // spanning two source lines would slip past. It under-reports rather than
  // false-alarms, and the case it exists for is the common one: a plain
  // sentence typed into JSX instead of added to a lib constant. Verified
  // against that case rather than assumed to work.
  const COMPONENTS = [
    "src/app/intake/Review.tsx",
    "src/app/intake/Ready.tsx",
    "src/app/intake/OpenFieldsDialog.tsx",
    // Added by Issue #73, once #63's work put their copy in lib too.
    "src/app/intake/ReadBack.tsx",
    "src/app/intake/StartSurface.tsx",
  ];

  it.each(COMPONENTS)("%s renders no bare text", async (path) => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(path, "utf8");
    const withoutComments = source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
    const bareText = [...withoutComments.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)]
      .map((m) => m[1].trim())
      .filter((text) => /[A-Za-z]{2}/.test(text))
      .filter((text) => !/[\n;=()[\]]/.test(text));
    expect(bareText).toEqual([]);
  });
});
