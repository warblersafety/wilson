// The report chrome's (Issue #67) rail-row model: design.md's "nine
// curated section/repeat-group rollup rows... each row's state computed
// from its constituent fields' actual states, never from
// topicStatuses()' positional walk, which cannot express `unknown` and
// mis-reports out-of-order fills under dictation-first."
import { describe, expect, it } from "vitest";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import {
  curatedRowState,
  curatedRows,
  formatFieldCounts,
  patientIdentifier,
  recordFieldCounts,
  reportRailRows,
} from "./report-chrome";
import { TOPICS, type RepeatCounts, type Topic } from "./topics";
import { syntheticTopic } from "./synthetic-topic";

// A tiny, self-contained topic list — the real 34-topic/227-field
// manifest is exercised separately below (the fixed-row/real-manifest
// tests), but the state-derivation rules themselves are clearer to prove
// against a handful of topics with a handful of fields each.
const TEST_TOPICS: Topic[] = [
  syntheticTopic({ id: "a1", section: "A", label: "A one", fieldIds: ["fa", "fb"], repeatGroup: null, repeatInstance: null }),
  syntheticTopic({ id: "b1", section: "B", label: "B one", fieldIds: ["fc"], repeatGroup: null, repeatInstance: null }),
];

function recordWith(states: Record<string, AgendaRecord[string]["state"]>): AgendaRecord {
  const record: AgendaRecord = {};
  for (const [id, state] of Object.entries(states)) record[id] = { state };
  return record;
}

describe("curatedRowState", () => {
  const row = { id: "a", section: "A" as const, label: "A", topicIds: ["a1"] };

  it("is current when the current topic is one of the row's topics, regardless of field states", () => {
    const record = recordWith({ fa: "unasked", fb: "unasked" });
    expect(curatedRowState(row, record, "a1", TEST_TOPICS)).toBe("current");
  });

  it("is untouched when every constituent field is unasked", () => {
    const record = recordWith({ fa: "unasked", fb: "unasked" });
    expect(curatedRowState(row, record, null, TEST_TOPICS)).toBe("untouched");
  });

  it("is unknown, not done, when every constituent field is unknown (AC test case)", () => {
    // design.md/#67 AC: "a topic whose fields are all unknown renders
    // unknown, not done" — topicStatuses()'s positional walk cannot
    // express this at all (only done/current/upcoming).
    const record = recordWith({ fa: "unknown", fb: "unknown" });
    expect(curatedRowState(row, record, null, TEST_TOPICS)).toBe("unknown");
  });

  it("is unknown when fields are a mix of unknown and declined but none answered", () => {
    const record = recordWith({ fa: "unknown", fb: "declined" });
    expect(curatedRowState(row, record, null, TEST_TOPICS)).toBe("unknown");
  });

  it("is done, not upcoming, when a field was filled ahead of the sequential cursor (AC test case)", () => {
    // design.md/#67 AC: "a narrative-filled topic past the cursor renders
    // done, not upcoming" — currentTopicId points elsewhere (or is null,
    // as here — nothing is currently being asked), yet this row's field
    // already has a real value.
    const record = recordWith({ fa: "answered", fb: "unasked" });
    expect(curatedRowState(row, record, null, TEST_TOPICS)).toBe("done");
  });

  it("is done when every field is resolved and at least one is answered", () => {
    const record = recordWith({ fa: "answered", fb: "declined" });
    expect(curatedRowState(row, record, null, TEST_TOPICS)).toBe("done");
  });

  it("current takes precedence over field-state-derived done/unknown", () => {
    const record = recordWith({ fa: "answered", fb: "unknown" });
    expect(curatedRowState(row, record, "a1", TEST_TOPICS)).toBe("current");
  });

  it("a row spanning multiple topics rolls up every constituent field", () => {
    const spanning = { id: "ab", section: "A" as const, label: "A+B", topicIds: ["a1", "b1"] };
    const record = recordWith({ fa: "unasked", fb: "unasked", fc: "answered" });
    expect(curatedRowState(spanning, record, null, TEST_TOPICS)).toBe("done");
  });
});

describe("curatedRows — the nine curated rows", () => {
  it("returns exactly nine rows when no suspect-product count is decided yet", () => {
    const rows = curatedRows({});
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => r.label)).toEqual([
      "Patient basics",
      "What happened",
      "Outcome",
      "Medical history",
      "Lab data",
      "Product availability",
      "Suspect product #1",
      "Concomitant meds",
      "Reporter",
    ]);
  });

  it("adds a Suspect product #2 row once repeatCounts confirms a second instance", () => {
    const repeatCounts: RepeatCounts = { "suspect-product": 2 };
    const rows = curatedRows(repeatCounts);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.label)).toContain("Suspect product #2");
  });

  it("never shows fewer than one suspect-product row, even if repeatCounts were somehow 0", () => {
    const rows = curatedRows({ "suspect-product": 0 } as RepeatCounts);
    expect(rows.filter((r) => r.section === "D")).toHaveLength(1);
  });

  it("the Concomitant meds row collapses all ten repeat slots into one", () => {
    const row = curatedRows({}).find((r) => r.label === "Concomitant meds")!;
    expect(row.topicIds).toHaveLength(10);
  });

  it("the What happened row folds in the additional-comments topic", () => {
    const row = curatedRows({}).find((r) => r.label === "What happened")!;
    expect(row.topicIds).toEqual(["event-what-happened", "event-additional-comments"]);
  });

  it("the Reporter row folds in both reporter topics", () => {
    const row = curatedRows({}).find((r) => r.label === "Reporter")!;
    expect(row.topicIds).toEqual(["reporter-contact-info", "reporter-about-you"]);
  });

  it("every real topic id referenced actually exists in TOPICS", () => {
    const topicIds = new Set(TOPICS.map((t) => t.id));
    for (const row of curatedRows({ "suspect-product": 2 })) {
      for (const topicId of row.topicIds) {
        expect(topicIds.has(topicId), `${row.id} references unknown topic ${topicId}`).toBe(true);
      }
    }
  });

  it("no section-E (device) topic is referenced by any row, matching the mockups' own nine-row list", () => {
    for (const row of curatedRows({ "suspect-product": 2 })) {
      expect(row.section).not.toBe("E");
    }
  });
});

describe("reportRailRows — against the real 34-topic manifest", () => {
  it("a fresh session shows every row untouched, except the one rule 5 gates off", () => {
    const record = initAgenda();
    const statuses = reportRailRows(record, {}, null);
    expect(statuses).toHaveLength(9);
    // Product availability is gated: a report that is not yet a product
    // problem, a device, or an OTC/compounded/cannabinoid/cosmetic type
    // does not include it — and "not part of this report" is its own
    // state, not "untouched", because untouched implies it is coming.
    const gated = statuses.filter((s) => s.state === "gated-off");
    expect(gated.map((s) => s.row.id)).toEqual(["product-availability"]);
    expect(statuses.filter((s) => s.state !== "gated-off").every((s) => s.state === "untouched")).toBe(true);
  });

  it("brings a gated-off row back into the report once the record says it belongs", () => {
    const record = applyAction(initAgenda(), "Page1.SecA_Patient.Defects", { type: "answer" }, "true");
    const statuses = reportRailRows(record, {}, null);
    expect(statuses.find((s) => s.row.id === "product-availability")?.state).not.toBe("gated-off");
  });

  it("does not gate a row that merely contains a gated topic among ungated ones", () => {
    // The suspect-product rows bundle the purchase topic (gated) with
    // five ungated ones, so the row stays in the report and reports on
    // what is still in play.
    const statuses = reportRailRows(initAgenda(), { "suspect-product": 1 }, null);
    expect(statuses.find((s) => s.row.id === "suspect-product-1")?.state).not.toBe("gated-off");
  });

  it("marks the row containing the live cursor's topic as current", () => {
    const record = initAgenda();
    const statuses = reportRailRows(record, {}, "patient-basics");
    const patientRow = statuses.find((s) => s.row.label === "Patient basics")!;
    expect(patientRow.state).toBe("current");
  });
});

describe("recordFieldCounts", () => {
  it("counts answered as written and unknown+declined together as unknown", () => {
    const record = initAgenda();
    record["Page1.SecA_Patient.PatientIdentifier"] = { state: "answered", value: "x" };
    record["Page1.SecA_Patient.AgeValue"] = { state: "unknown" };
    record["Page1.SecA_Patient.SexF"] = { state: "declined" };
    const counts = recordFieldCounts(record);
    expect(counts.written).toBe(1);
    expect(counts.unknown).toBe(2);
  });

  it("a fresh (all-unasked) record counts zero of both", () => {
    expect(recordFieldCounts(initAgenda())).toEqual({ written: 0, unknown: 0 });
  });

  // ask-copy.md rule 4's auto field (added 2026-08-29, #127): ReportDate
  // is wilson's own write, not the clinician's, so it must never inflate
  // `written` — the bug that made a brand-new session open on "1 field
  // written" the moment the footer started reading the STAMPED record
  // (ReportChrome.tsx's own `previewed`, reviewer pass PR #107 nit a).
  it("excludes the auto ReportDate field even once it is stamped", () => {
    const record = initAgenda();
    record["Page1.SecA_Patient.ReportDate"] = { state: "answered", value: "2026-08-29" };
    expect(recordFieldCounts(record)).toEqual({ written: 0, unknown: 0 });
  });

  it("still counts every other answered field alongside an excluded, stamped ReportDate", () => {
    const record = initAgenda();
    record["Page1.SecA_Patient.ReportDate"] = { state: "answered", value: "2026-08-29" };
    record["Page1.SecA_Patient.PatientIdentifier"] = { state: "answered", value: "x" };
    expect(recordFieldCounts(record)).toEqual({ written: 1, unknown: 0 });
  });
});

describe("formatFieldCounts", () => {
  // ask-copy.md rule 8's unit noun (#127): "item", not "field" — and as
  // of rev 3, the word matches the count: recordFieldCounts() buckets by
  // fact (factGroups()), not by manifest field, so this is formatting a
  // fact count (reviewer pass, #127 N6 — an earlier version of this
  // comment claimed the opposite).
  it("says 'item', never 'field'", () => {
    expect(formatFieldCounts({ written: 1, unknown: 0 })).toBe("1 item written");
    expect(formatFieldCounts({ written: 3, unknown: 2 })).toBe("3 items written · 2 unknown");
    expect(formatFieldCounts({ written: 0, unknown: 0 })).toBe("0 items written");
  });
});

describe("patientIdentifier", () => {
  it("returns null when the field is unasked", () => {
    expect(patientIdentifier(initAgenda())).toBeNull();
  });

  it("returns the value once answered", () => {
    const record = initAgenda();
    record["Page1.SecA_Patient.PatientIdentifier"] = { state: "answered", value: "M.R. 4471-08" };
    expect(patientIdentifier(record)).toBe("M.R. 4471-08");
  });

  it("returns null when marked unknown or declined, not the stale/absent value", () => {
    const record = initAgenda();
    record["Page1.SecA_Patient.PatientIdentifier"] = { state: "declined" };
    expect(patientIdentifier(record)).toBeNull();
  });
});
