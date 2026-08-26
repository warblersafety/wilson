"use client";

// The Read-back surface (Issue #43) — design.md's "Interaction model and
// UI", surface 2: the trust moment. Nothing here writes to the record
// until "Looks right" — see src/lib/read-back.ts for the write step and
// the quote-highlighting logic this component only renders.
import { useState, useTransition, type FormEvent } from "react";
import { submitNarrative } from "@/app/actions";
import { ReportChrome } from "@/components/report-chrome/ReportChrome";
import { FORM_3500_FIELDS, type FormFieldSpec } from "@/lib/form-3500-fields";
import type { NarrativeProposal } from "@/lib/narrative-extract";
import {
  buildHighlightSegments,
  confirmReadBack,
  describeProposalValue,
  groupProposalsByField,
  resolveConfirmReadiness,
} from "@/lib/read-back";
import { resolveStartSubmit, validateNarrative, type ReadBackHandoff } from "@/lib/start-surface";
import type { TalkSession } from "@/lib/talk";
import { currentTopicProgress } from "@/lib/topics";

const FIELDS_BY_ID = new Map<string, FormFieldSpec>(FORM_3500_FIELDS.map((f) => [f.id, f]));
function fieldOf(fieldId: string): FormFieldSpec | undefined {
  return FIELDS_BY_ID.get(fieldId);
}
function fieldLabel(fieldId: string): string {
  return fieldOf(fieldId)?.label ?? fieldId;
}

// Read-back's record is ALSO still blank (nothing writes until "Looks
// right"), so the chrome's default Start-surface empty copy ("wilson
// asks one topic at a time") would otherwise show here too — wrong for
// a moment where the clinician is looking at a full set of pending
// proposals, not being asked anything one at a time (reviewer pass, PR
// #75, finding F9). Matches the mockups' own dedicated "transcript"
// rail stage (ReportRail.dc.html).
const READ_BACK_EMPTY_STATE = {
  headline: "Transcript ready · 0 fields written",
  note: "Nothing is written to the form until you approve the transcript.",
};

interface ReadBackProps {
  handoff: ReadBackHandoff;
  onConfirmed: (session: TalkSession) => void;
}

export function ReadBack({ handoff, onConfirmed }: ReadBackProps) {
  const [current, setCurrent] = useState(handoff);
  const [selections, setSelections] = useState<Map<string, NarrativeProposal>>(new Map());
  const [editing, setEditing] = useState(false);
  const [draftNarrative, setDraftNarrative] = useState(handoff.narrative);
  const [reExtractError, setReExtractError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSelect(fieldId: string, proposal: NarrativeProposal) {
    setSelections((prev) => new Map(prev).set(fieldId, proposal));
  }

  function startEditing() {
    setDraftNarrative(current.narrative);
    setReExtractError(null);
    setEditing(true);
  }

  function handleReExtract(e: FormEvent) {
    e.preventDefault();
    setReExtractError(null);
    startTransition(async () => {
      const outcome = await resolveStartSubmit(draftNarrative, current.session, submitNarrative);
      if (outcome.landed) {
        setCurrent(outcome.handoff);
        setSelections(new Map());
        setEditing(false);
      } else {
        setReExtractError(outcome.message);
      }
    });
  }

  // Read-back's record is always the still-blank one from before this
  // narrative was ever confirmed (design.md: "nothing is written to the
  // record until the clinician confirms here") — the chrome's current
  // row is whichever topic that blank record's own walk lands on first,
  // the same call Wizard.tsx makes for its live session.
  const chromeCurrentTopicId = currentTopicProgress(current.session.record, current.session.repeatCounts)?.topic
    .id ?? null;

  // The proposal set an edit is in the middle of replacing must never be
  // confirmable — hence this whole block, panel included, only exists
  // outside the editing branch. Not just a visibility toggle: while
  // editing, none of this is computed at all, so a keystroke in the
  // composer doesn't pay for highlight segments nobody can see or confirm
  // (reviewer pass, finding — the confirm button used to stay live and
  // enabled through an in-progress edit, applying the stale pre-edit
  // proposals if clicked).
  if (editing) {
    const draftValidation = validateNarrative(draftNarrative);
    return (
      <ReportChrome
        record={current.session.record}
        repeatCounts={current.session.repeatCounts}
        currentTopicId={chromeCurrentTopicId}
        emptyState={READ_BACK_EMPTY_STATE}
      >
        <main className="read-back">
          <h1 className="read-back__heading">Here&rsquo;s what I&rsquo;d write</h1>
          <form onSubmit={handleReExtract} className="read-back__edit-form">
            <textarea
              className="read-back__edit-composer"
              value={draftNarrative}
              onChange={(e) => setDraftNarrative(e.target.value)}
              disabled={isPending}
              rows={8}
              aria-label="Edit the narrative"
            />
            <div className="read-back__edit-actions">
              <button type="submit" disabled={isPending || !draftValidation.ok}>
                {isPending ? "Reading through what you wrote…" : "Re-extract"}
              </button>
              <button type="button" onClick={() => setEditing(false)} disabled={isPending}>
                Cancel
              </button>
            </div>
            {reExtractError && (
              <p className="read-back__error" role="alert">
                {reExtractError}
              </p>
            )}
          </form>
        </main>
      </ReportChrome>
    );
  }

  const groups = groupProposalsByField(current.result.proposals);
  const segments = buildHighlightSegments(current.narrative, current.result.proposals);
  const readiness = resolveConfirmReadiness(groups, selections);

  function handleConfirm() {
    if (!readiness.ready) return;
    onConfirmed(confirmReadBack(current, readiness.actions));
  }

  return (
    <ReportChrome
      record={current.session.record}
      repeatCounts={current.session.repeatCounts}
      currentTopicId={chromeCurrentTopicId}
      emptyState={READ_BACK_EMPTY_STATE}
    >
      <main className="read-back">
        <h1 className="read-back__heading">Here&rsquo;s what I&rsquo;d write</h1>

        <p className="read-back__narrative">
          {segments.map((segment, i) =>
            segment.proposalIndexes.length === 0 ? (
              <span key={i}>{segment.text}</span>
            ) : (
              <mark
                key={i}
                className={
                  segment.proposalIndexes.length > 1 ? "read-back__mark read-back__mark--multi" : "read-back__mark"
                }
              >
                {segment.text}
              </mark>
            ),
          )}
        </p>
        <button type="button" className="read-back__edit-toggle" onClick={startEditing}>
          Edit narrative
        </button>

        <div className="read-back__panel">
          <h2 className="read-back__panel-heading">What I&rsquo;d write from this</h2>
          {groups.length === 0 ? (
            <p className="read-back__panel-empty">Nothing to fill in yet — you can still continue.</p>
          ) : (
            <ul className="read-back__panel-list">
              {groups.map((group) => (
                <li key={group.fieldId} className="read-back__panel-row">
                  <span className="read-back__panel-label">{fieldLabel(group.fieldId)}</span>
                  {group.proposals.length === 1 ? (
                    <span className="read-back__panel-value">
                      {describeProposalValue(group.proposals[0].action, fieldOf(group.fieldId))}
                    </span>
                  ) : (
                    <div
                      className="read-back__panel-choices"
                      role="radiogroup"
                      aria-label={`Choose a value for ${fieldLabel(group.fieldId)}`}
                    >
                      {group.proposals.map((proposal, i) => (
                        <label key={i} className="read-back__panel-choice">
                          <input
                            type="radio"
                            name={`choice-${group.fieldId}`}
                            checked={selections.get(group.fieldId) === proposal}
                            onChange={() => handleSelect(group.fieldId, proposal)}
                          />
                          {describeProposalValue(proposal.action, fieldOf(group.fieldId))}
                        </label>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {!readiness.ready && (
          <p className="read-back__hint" role="alert">
            Choose a value for {readiness.pendingFieldIds.map(fieldLabel).join(", ")} before continuing — both were
            mentioned, so only one can be kept.
          </p>
        )}
        <button type="button" className="read-back__confirm" onClick={handleConfirm} disabled={!readiness.ready}>
          Looks right
        </button>
      </main>
    </ReportChrome>
  );
}
