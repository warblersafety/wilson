// Per docs/design.md's Agenda: every record field carries a state, not
// just a value, so a clinician not having some piece of information on
// hand is a normal, tracked outcome rather than a blocked form.
export type FieldState = "unasked" | "answered" | "unknown" | "declined";

export type FieldAction =
  | { type: "answer" }
  | { type: "mark_unknown" }
  | { type: "decline" }
  | { type: "reopen" };

// `reopen` returns a field to `unasked` — the review-stage edit path in
// docs/design.md re-enters this same state machine rather than patching
// a value directly.
export function transition(state: FieldState, action: FieldAction): FieldState {
  switch (action.type) {
    case "answer":
      return "answered";
    case "mark_unknown":
      return "unknown";
    case "decline":
      return "declined";
    case "reopen":
      return "unasked";
    default: {
      const exhaustive: never = action;
      throw new Error(`unhandled field action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function isResolved(state: FieldState): boolean {
  return state !== "unasked";
}
