"use client";

// The Read-back surface (Issue #43) — design.md's "Interaction model and
// UI", surface 2: the trust moment. Nothing here writes to the record
// until "Looks right" — see src/lib/read-back.ts for the write step and
// the quote-highlighting logic this component only renders.
import { useState, useTransition, type FormEvent } from "react";
import { submitNarrative } from "@/app/actions";
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

const FIELDS_BY_ID = new Map<string, FormFieldSpec>(FORM_3500_FIELDS.map((f) => [f.id, f]));
function fieldLabel(fieldId: string): string {
  return FIELDS_BY_ID.get(fieldId)?.label ?? fieldId;
}

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

  const groups = groupProposalsByField(current.result.proposals);
  const segments = buildHighlightSegments(current.narrative, current.result.proposals);
  const readiness = resolveConfirmReadiness(groups, selections);

  function handleSelect(fieldId: string, proposal: NarrativeProposal) {
    setSelections((prev) => new Map(prev).set(fieldId, proposal));
  }

  function handleConfirm() {
    if (!readiness.ready) return;
    onConfirmed(confirmReadBack(current, readiness.actions));
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

  const draftValidation = validateNarrative(draftNarrative);

  return (
    <main className="read-back">
      <h1 className="read-back__heading">Here&rsquo;s what I&rsquo;d write</h1>

      {!editing ? (
        <>
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
          <button type="button" className="read-back__edit-toggle" onClick={startEditing} disabled={isPending}>
            Edit narrative
          </button>
        </>
      ) : (
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
      )}

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
                  <span className="read-back__panel-value">{describeProposalValue(group.proposals[0].action)}</span>
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
                        {describeProposalValue(proposal.action)}
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
  );
}
