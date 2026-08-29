"use client";

// The Open-fields dialog (Issue #45) — design.md's surface 5, "presented
// as a dialog over the Review surface (screen 06), not a separate page —
// it is enumerated as a surface because it carries its own rules and
// state, not its own screen." All of its derivation lives in
// src/lib/open-fields.ts; this renders it.
//
// The nudge never gates: "Finish as it stands" is always present and
// always enabled, and there is no code path anywhere in this component or
// its module that consults the entry count before allowing it — see
// summarizeOpenFields()'s canFinishAsIs tripwire and its test.
import { Dialog } from "@/components/Dialog";
import type { AgendaRecord } from "@/lib/agenda";
import { OPEN_FIELDS_COPY, openFieldEntries, openFieldsHeading, rowForField } from "@/lib/open-fields";
import type { CuratedRow } from "@/lib/report-chrome";
import type { RepeatCounts } from "@/lib/topics";

interface OpenFieldsDialogProps {
  record: AgendaRecord;
  repeatCounts: RepeatCounts;
  rows: CuratedRow[];
  // Reopens the row a given open field belongs to — the same reopen path
  // Review's own per-card Edit uses, at the same granularity, so this
  // dialog adds no second way to edit anything.
  onAnswer: (row: CuratedRow) => void;
  onFinishAsIs: () => void;
  onDismiss: () => void;
}

export function OpenFieldsDialog({
  record,
  repeatCounts,
  rows,
  onAnswer,
  onFinishAsIs,
  onDismiss,
}: OpenFieldsDialogProps) {
  const entries = openFieldEntries(record, repeatCounts);

  return (
    <Dialog labelledBy="open-fields-heading" onDismiss={onDismiss}>
      <h2 id="open-fields-heading" className="dialog__heading">
        {openFieldsHeading(entries.length)}
      </h2>
      <p className="dialog__body">{OPEN_FIELDS_COPY.body}</p>

      <ul className="open-fields__list">
        {entries.map((entry) => {
          // Any one member names the row's Review destination — a fact's
          // fields always share one topic (rule 8, #127), the same
          // invariant rowForField's own single-field callers already
          // relied on.
          const row = rowForField(entry.fieldIds[0], rows);
          return (
            <li key={entry.fieldIds[0]} className="open-fields__entry">
              <span className="open-fields__label">{entry.label}</span>
              <span className={`open-fields__reason open-fields__reason--${entry.reasonKind}`}>{entry.reason}</span>
              {/* No row means no reopen path to offer — the entry is still
                  listed, because hiding an open field would be the one
                  dishonest thing this dialog could do. */}
              {row && (
                <button type="button" className="open-fields__answer" onClick={() => onAnswer(row)}>
                  {OPEN_FIELDS_COPY.answerCta}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* Enumerated deviation from screen 06: its primary "Fill these
          now" has no separate action here. Each entry's own "Answer" IS
          the fill affordance, and a bulk version of it would reopen every
          resolved field of every row carrying an open field — with one
          unknown lot number, the whole ~40-field suspect-product card
          gets re-asked. The button keeps the mockup's slot and weighting
          as the way back to Review, where every card's Edit also lives;
          "Finish as it stands" keeps the secondary link's position, so
          the layout still nudges toward filling rather than finishing. */}
      <div className="dialog__actions">
        <button type="button" className="dialog__primary" onClick={onDismiss}>
          {OPEN_FIELDS_COPY.backCta}
        </button>
        <button type="button" className="dialog__secondary" onClick={onFinishAsIs}>
          {OPEN_FIELDS_COPY.finishCta}
        </button>
      </div>
    </Dialog>
  );
}
