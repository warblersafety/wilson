"use client";

// Checkbox/enum widgets for a topic's fixed-choice fields (Issue #32),
// rendered as lucy's chip grammar (Issue #44): yes/no chips for checkbox,
// one choice chip per legal option for enum (below CHIP_LIST_MAX — see
// its own comment), plus the always-present "Not sure"/"Skip" affordances
// writing the existing `unknown`/`declined` states. Writes go through
// applyAction() + stepForSession() directly (no model call), now
// appending a transcript turn per tap so the visible history has no gaps
// between typed and tapped answers.
import { useState } from "react";
import { Chip } from "@/components/Chip";
import { applyAction } from "@/lib/agenda";
import { friendlyFailureMessage, widgetTurnText } from "@/lib/chip-grammar";
import type { FieldAction } from "@/lib/field-state";
import { DISALLOWED_ENUM_VALUES, FORM_3500_FIELDS, type FormFieldSpec } from "@/lib/form-3500-fields";
import type { Topic } from "@/lib/topics";
import type { TalkSession, TalkStep } from "@/lib/talk";
import { stepForSession } from "./direct-step";

const FIELDS_BY_ID = new Map<string, FormFieldSpec>(FORM_3500_FIELDS.map((f) => [f.id, f]));

// Past this many options, a flat chip wall is worse than a native
// <select> — see the enum branch below for the actual fields this
// affects (route, unit, country) and why. Every other real enum field
// (max 13 options) stays comfortably under it.
const CHIP_LIST_MAX = 15;

interface TopicFieldsProps {
  topic: Topic;
  current: TalkStep;
  onChange: (next: TalkStep) => void;
  disabled?: boolean;
}

export function TopicFields({ topic, current, onChange, disabled = false }: TopicFieldsProps) {
  const { session } = current;
  const [error, setError] = useState<string | null>(null);
  const fields = topic.fieldIds
    .map((id) => FIELDS_BY_ID.get(id))
    .filter((f): f is FormFieldSpec => f !== undefined && (f.type === "checkbox" || f.type === "enum"));

  if (fields.length === 0) return null;

  async function writeField(
    field: FormFieldSpec,
    action: FieldAction,
    value: string | undefined,
    answerLabel: string,
  ) {
    try {
      const record = applyAction(session.record, field.id, action, value);
      const nextSession: TalkSession = {
        ...session,
        record,
        transcript: [
          ...session.transcript,
          { role: "clinician", text: widgetTurnText(field.label, answerLabel), source: "widget" },
        ],
      };
      setError(null);
      onChange(await stepForSession(nextSession));
    } catch (err) {
      setError(friendlyFailureMessage(err instanceof Error ? err.message : "unknown"));
    }
  }

  return (
    <fieldset className="topic-fields" disabled={disabled}>
      <legend>{topic.label}</legend>
      {error && (
        <p className="topic-fields__error" role="alert">
          {error}
        </p>
      )}
      {fields.map((field) => {
        const entry = session.record[field.id];
        const notSurePressed = entry.state === "unknown";
        const skipPressed = entry.state === "declined";
        const notSureSkip = (
          <>
            <Chip
              label="Not sure"
              pressed={notSurePressed}
              onClick={() => void writeField(field, { type: "mark_unknown" }, undefined, "Not sure")}
            />
            <Chip
              label="Skip"
              pressed={skipPressed}
              onClick={() => void writeField(field, { type: "decline" }, undefined, "Skip")}
            />
          </>
        );

        if (field.type === "checkbox") {
          const yesPressed = entry.state === "answered" && entry.value === "true";
          const noPressed = entry.state === "answered" && entry.value === "false";
          return (
            <div key={field.id} className="topic-field topic-field--checkbox">
              <span className="topic-field__label">{field.label}</span>
              <div className="topic-field__chips">
                <Chip
                  label="Yes"
                  pressed={yesPressed}
                  onClick={() => void writeField(field, { type: "answer" }, "true", "Yes")}
                />
                <Chip
                  label="No"
                  pressed={noPressed}
                  onClick={() => void writeField(field, { type: "answer" }, "false", "No")}
                />
                {notSureSkip}
              </div>
            </div>
          );
        }

        // The manifest's own blank option (a literal " ", not "") is the
        // "unselected" placeholder — never a real choice, so it's simply
        // not offered as a chip (unlike the removed <select>, a chip
        // widget has no need for an empty default option to begin with).
        const disallowed = DISALLOWED_ENUM_VALUES[field.id];
        const options = (field.options ?? []).filter(
          (option) => !disallowed?.has(option) && option.trim().length > 0,
        );
        const selectedOption = entry.state === "answered" ? entry.value : undefined;

        // A flat chip wall stops being the more usable widget somewhere
        // past a dozen-ish options — this manifest's longest lists
        // (country ~275, route ~68, unit ~42) would render hundreds of
        // individually-tappable buttons, discovered by actually looking
        // at the rendered page (manual check), not by inspection. Every
        // other real enum field tops out at 13 (occupation), comfortably
        // under this threshold, so the fallback is a true edge case, not
        // the common path. The select's own options are still the same
        // human-readable manifest strings chips would have shown — this
        // changes only which widget renders the choice, not what "no raw
        // manifest strings" (AC) requires.
        if (options.length > CHIP_LIST_MAX) {
          return (
            <div key={field.id} className="topic-field topic-field--enum">
              <label className="topic-field__label" htmlFor={`select-${field.id}`}>
                {field.label}
              </label>
              <div className="topic-field__select-row">
                <select
                  id={`select-${field.id}`}
                  className="topic-field__select"
                  value={selectedOption ?? ""}
                  onChange={(e) => {
                    if (e.target.value.length === 0) return;
                    void writeField(field, { type: "answer" }, e.target.value, e.target.value);
                  }}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                {notSureSkip}
              </div>
            </div>
          );
        }

        return (
          <div key={field.id} className="topic-field topic-field--enum">
            <span className="topic-field__label">{field.label}</span>
            <div className="topic-field__chips">
              {options.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  pressed={selectedOption === option}
                  onClick={() => void writeField(field, { type: "answer" }, option, option)}
                />
              ))}
              {notSureSkip}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
