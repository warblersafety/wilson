"use client";

// The Read-back surface (Issue #43) — design.md's "Interaction model and
// UI", surface 2: the trust moment. Nothing here writes to the record
// until "Looks right" — see src/lib/read-back.ts for the write step and
// the quote-highlighting logic this component only renders.
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { submitNarrative } from "@/app/actions";
import { ReportChrome } from "@/components/report-chrome/ReportChrome";
import { fieldById } from "@/lib/form-3500-fields";
import type { NarrativeProposal } from "@/lib/narrative-extract";
import {
  buildHighlightSegments,
  confirmReadBack,
  describeProposalValue,
  collisionHint,
  groupProposalsByField,
  quoteReadings,
  READ_BACK_COPY,
  resolveConfirmReadiness,
  restoreSelections,
} from "@/lib/read-back";
import { saveIntakeDraft } from "@/lib/session-storage";
import { resolveStartSubmit, validateNarrative, type ReadBackHandoff } from "@/lib/start-surface";
import type { TalkSession } from "@/lib/talk";
import { currentTopicProgress } from "@/lib/topics";
import { displayNameFor } from "@/lib/display-names";

// ask-copy.md rule 6: the authored display name, never the manifest
// label this used to render straight onto the Read-back surface.
function fieldLabel(fieldId: string): string {
  return displayNameFor(fieldId);
}

// Read-back's record is ALSO still blank (nothing writes until "Looks
// right"), so the chrome's default Start-surface empty copy ("wilson
// asks one topic at a time") would otherwise show here too — wrong for
// a moment where the clinician is looking at a full set of pending
// proposals, not being asked anything one at a time (reviewer pass, PR
// #75, finding F9). Matches the mockups' own dedicated "transcript"
// rail stage (ReportRail.dc.html).
const READ_BACK_EMPTY_STATE = {
  headline: READ_BACK_COPY.emptyStateHeadline,
  note: READ_BACK_COPY.emptyStateNote,
};

interface ReadBackProps {
  handoff: ReadBackHandoff;
  // State recovered from a previous visit (Issue #72) — collision choices
  // and any open narrative edit. Seeds initial state only; IntakeFlow
  // holds this surface back until storage has been read, so there is no
  // later change to react to.
  restored?: {
    selectedProposalIndexes: Record<string, number>;
    editing: boolean;
    draftNarrative: string;
  };
  onConfirmed: (session: TalkSession) => void;
}

export function ReadBack({ handoff, restored, onConfirmed }: ReadBackProps) {
  const [current, setCurrent] = useState(handoff);
  const [selections, setSelections] = useState<Map<string, NarrativeProposal>>(() =>
    restoreSelections(handoff, restored?.selectedProposalIndexes),
  );
  const [editing, setEditing] = useState(restored?.editing ?? false);
  const [draftNarrative, setDraftNarrative] = useState(restored?.draftNarrative ?? handoff.narrative);
  const [reExtractFailure, setReExtractFailure] = useState<{ reason: "invalid" | "failed"; message: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  // Persisted on every change, so a reload here resumes the same panel
  // with the same choices and the same open edit (#56). The record is
  // deliberately NOT part of what changes: this surface writes nothing
  // until "Looks right", and the persisted handoff carries the same
  // untouched record it arrived with, so a reload is not a route around
  // the read-back gate.
  useEffect(() => {
    saveIntakeDraft(window.localStorage, {
      kind: "read-back",
      handoff: current,
      selectedProposalIndexes: Object.fromEntries(
        [...selections].flatMap(([fieldId, proposal]) => {
          const index = current.result.proposals.indexOf(proposal);
          // A selection from a superseded extraction has no index in the
          // current one; dropping it returns that field to "needs a
          // choice" rather than persisting a dangling reference.
          return index === -1 ? [] : [[fieldId, index] as const];
        }),
      ),
      editing,
      draftNarrative,
    });
  }, [current, selections, editing, draftNarrative]);

  function handleSelect(fieldId: string, proposal: NarrativeProposal) {
    setSelections((prev) => new Map(prev).set(fieldId, proposal));
  }

  function startEditing() {
    setDraftNarrative(current.narrative);
    setReExtractFailure(null);
    setEditing(true);
  }

  function handleReExtract(e: FormEvent) {
    e.preventDefault();
    setReExtractFailure(null);
    startTransition(async () => {
      const outcome = await resolveStartSubmit(draftNarrative, current.session, submitNarrative);
      if (outcome.landed) {
        setCurrent(outcome.handoff);
        setSelections(new Map());
        setEditing(false);
      } else {
        setReExtractFailure({ reason: outcome.reason, message: outcome.message });
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
          <h1 className="read-back__heading">{READ_BACK_COPY.heading}</h1>
          <form onSubmit={handleReExtract} className="read-back__edit-form">
            <textarea
              className="read-back__edit-composer"
              value={draftNarrative}
              onChange={(e) => setDraftNarrative(e.target.value)}
              disabled={isPending}
              rows={8}
              aria-label={READ_BACK_COPY.narrativeEditLabel}
            />
            <div className="read-back__edit-actions">
              <button type="submit" disabled={isPending || !draftValidation.ok}>
                {isPending ? READ_BACK_COPY.reExtractPending : READ_BACK_COPY.reExtractCta}
              </button>
              <button type="button" onClick={() => setEditing(false)} disabled={isPending}>
                {READ_BACK_COPY.cancelCta}
              </button>
            </div>
            {reExtractFailure && (
              <div className="read-back__error" role="alert">
                <p className="read-back__error-message">{reExtractFailure.message}</p>
                {/* Retry only where retrying means something: an
                    over-length narrative needs an edit first, and offering
                    "Try again" against copy that says "shorten this" would
                    invite the clinician to press it and fail identically
                    (src/lib/start-surface.ts's `reason`). */}
                {reExtractFailure.reason === "failed" && (
                  <button type="button" onClick={handleReExtract} disabled={isPending}>
                    {READ_BACK_COPY.retryCta}
                  </button>
                )}
              </div>
            )}
          </form>
        </main>
      </ReportChrome>
    );
  }

  // Passing the narrative lets an equal-action set keep its best-grounded
  // quote rather than whichever came first — see groupProposalsByField.
  const groups = groupProposalsByField(current.result.proposals, current.narrative);
  const segments = buildHighlightSegments(current.narrative, current.result.proposals);
  const readiness = resolveConfirmReadiness(groups, selections);

  function handleConfirm() {
    if (!readiness.ready) return;
    onConfirmed(confirmReadBack(current, readiness.actions));
  }

  // One pass over the whole proposal set (quoteReadings normalizes the
  // narrative once), then looked up per row by the proposal's own index —
  // groupProposalsByField() passes the objects through by reference, so
  // indexOf is exact.
  const readings = quoteReadings(current.narrative, current.result.proposals);
  function renderReading(proposal: NarrativeProposal) {
    const reading = readings[current.result.proposals.indexOf(proposal)];
    if (!reading) return null;
    return (
      <span className={`read-back__reading read-back__reading--${reading.status}`}>
        <span className="read-back__reading-framing">{reading.framing}</span>
        {reading.note && <span className="read-back__reading-note">{reading.note}</span>}
      </span>
    );
  }

  return (
    <ReportChrome
      record={current.session.record}
      repeatCounts={current.session.repeatCounts}
      currentTopicId={chromeCurrentTopicId}
      emptyState={READ_BACK_EMPTY_STATE}
    >
      <main className="read-back">
        <h1 className="read-back__heading">{READ_BACK_COPY.heading}</h1>

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
          {READ_BACK_COPY.editToggle}
        </button>

        <div className="read-back__panel">
          {/* The count is screen 03's own ("— 7 values"), derived rather
              than a bare heading: it tells the clinician how much there is
              to check before they start reading. */}
          <h2 className="read-back__panel-heading">
            {READ_BACK_COPY.panelHeading}
            {groups.length > 0 && (
              <span className="read-back__panel-count">
                {" — "}
                {groups.length} {groups.length === 1 ? "value" : "values"}
              </span>
            )}
          </h2>
          {groups.length === 0 ? (
            <p className="read-back__panel-empty">{READ_BACK_COPY.panelEmpty}</p>
          ) : (
            <ul className="read-back__panel-list">
              {groups.map((group) => (
                <li key={group.fieldId} className="read-back__panel-row">
                  <span className="read-back__panel-label">{fieldLabel(group.fieldId)}</span>
                  {group.proposals.length === 1 ? (
                    <div className="read-back__panel-reading">
                      <span className="read-back__panel-value">
                        {describeProposalValue(group.proposals[0].action, fieldById(group.fieldId))}
                      </span>
                      {renderReading(group.proposals[0])}
                    </div>
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
                          <span className="read-back__panel-reading">
                            <span className="read-back__panel-value">
                              {describeProposalValue(proposal.action, fieldById(group.fieldId))}
                            </span>
                            {renderReading(proposal)}
                          </span>
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
            {collisionHint(readiness.pendingFieldIds.map(fieldLabel))}
          </p>
        )}
        <button type="button" className="read-back__confirm" onClick={handleConfirm} disabled={!readiness.ready}>
          {READ_BACK_COPY.confirmCta}
        </button>
      </main>
    </ReportChrome>
  );
}
