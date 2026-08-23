"use client";

// Direct-selection widgets for a topic's checkbox/enum fields (Issue #32).
// Writes go straight through applyAction() + nextStep() — no model call,
// no transcript turn appended, so the parent constructs the new TalkStep
// itself rather than routing through talk.ts's processTurn()/respond()
// (which always appends a talker turn).
import { applyAction, type AgendaRecord } from "@/lib/agenda";
import { askDeterministic } from "@/lib/ask";
import { FORM_3500_FIELDS, type FormFieldSpec } from "@/lib/form-3500-fields";
import { nextStep, type Topic } from "@/lib/topics";
import type { TalkStep } from "@/lib/talk";

const FIELDS_BY_ID = new Map<string, FormFieldSpec>(FORM_3500_FIELDS.map((f) => [f.id, f]));

// Mirrors scripts/fill-3500.py's DISALLOWED_ENUM_VALUES: the source PDF's
// own /Opt array pairs the display text "AS NECESSARY - AN" (a Frequency
// value) with an unrelated Strength/Dose unit export code on these four
// fields — never a legitimate answer for a Strength/Dose Unit field, and
// fill-3500.py refuses to export a record that picked it. Filtered out of
// the dropdown here so a clinician can't select it in the first place.
const DISALLOWED_ENUM_VALUES: Record<string, Set<string>> = {
  "Page4.Prod1.Prod1StrengthUnit": new Set(["AS NECESSARY - AN"]),
  "Page4.Prod1.Prod1DoseUnit": new Set(["AS NECESSARY - AN"]),
  "Page5.Prod2.Prod2StrengthUnit": new Set(["AS NECESSARY - AN"]),
  "Page5.Prod2.Prod2DoseUnit": new Set(["AS NECESSARY - AN"]),
};

interface TopicFieldsProps {
  topic: Topic;
  current: TalkStep;
  onChange: (next: TalkStep) => void;
}

export function TopicFields({ topic, current, onChange }: TopicFieldsProps) {
  const { session } = current;
  const fields = topic.fieldIds
    .map((id) => FIELDS_BY_ID.get(id))
    .filter((f): f is FormFieldSpec => f !== undefined && (f.type === "checkbox" || f.type === "enum"));

  if (fields.length === 0) return null;

  async function writeField(fieldId: string, value: string) {
    const record: AgendaRecord = applyAction(session.record, fieldId, { type: "answer" }, value);
    const nextSession = { ...session, record };
    const step = nextStep(nextSession.record, nextSession.repeatCounts);
    const reply = await askDeterministic(step, nextSession);
    onChange({ session: nextSession, reply, nextStep: step });
  }

  return (
    <fieldset className="topic-fields">
      <legend>{topic.label}</legend>
      {fields.map((field) => {
        const entry = session.record[field.id];
        if (field.type === "checkbox") {
          const checked = entry.state === "answered" && entry.value === "true";
          return (
            <label key={field.id} className="topic-field topic-field--checkbox">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => void writeField(field.id, e.target.checked ? "true" : "false")}
              />
              {field.label}
            </label>
          );
        }

        // enum: the manifest's own leading " " option is the "unselected"
        // placeholder — selecting it is a no-op (an "answered" entry must
        // carry a non-blank value, per scripts/fill-3500.py's own check).
        const value = entry.state === "answered" ? (entry.value ?? "") : "";
        const disallowed = DISALLOWED_ENUM_VALUES[field.id];
        const options = (field.options ?? []).filter((option) => !disallowed?.has(option));
        return (
          <label key={field.id} className="topic-field topic-field--enum">
            {field.label}
            <select
              value={value}
              onChange={(e) => {
                if (e.target.value.trim().length === 0) return;
                void writeField(field.id, e.target.value);
              }}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </fieldset>
  );
}
