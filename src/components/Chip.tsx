"use client";

// The tappable-choice primitive behind Issue #44's chip grammar
// (design.md: "stealing lucy's chip grammar wholesale"). Selected state
// lives entirely in `aria-pressed` plus a CSS attribute selector, not a
// separate class — matching lucy's own `.chip`, whose team specifically
// learned (per its own code comments) that a chip needing a distinct
// shape/behavior should get its own class from the start rather than
// share this one and pick up an unrelated rule via cascade order.
interface ChipProps {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function Chip({ label, pressed = false, disabled = false, onClick }: ChipProps) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}
