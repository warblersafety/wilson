// The Ready surface's pure logic and copy (Issue #45) — design.md's
// surface 6: "honest completion: the filled PDF to download,
// answered/unknown/declined counts, and the reminder that wilson stores
// nothing on its own servers... No submission claims."
import { describe, expect, it } from "vitest";
import { applyAction, initAgenda } from "./agenda";
import { SIGN_OFF_CTA } from "./review";
import {
  formatReadyCounts,
  READY_COPY,
  readyCounts,
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
  const ALL_COPY = [...Object.values(READY_COPY), ...Object.values(START_OVER_CONFIRM_COPY), SIGN_OFF_CTA];

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
});
