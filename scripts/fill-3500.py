#!/usr/bin/env python3
"""
fill-3500.py — Fill FDA Form 3500 from an AgendaRecord.

Reads an AgendaRecord JSON (id -> {"state": ..., "value"?: ...}, matching
src/lib/agenda.ts's AgendaRecord) from stdin, writes filled PDF bytes to
stdout.

Unlike lucy's fill-3500b.py, this mapping is generic — driven entirely by
form-3500-fields.json (a checked-in snapshot of src/lib/form-3500-fields.ts's
FORM_3500_FIELDS, kept in sync by
src/lib/form-3500-fields-json.test.ts) — rather than one hand-authored
function per field. wilson's AgendaRecord is already keyed 1:1 against that
manifest, so no per-field translation is needed; lucy's record needed one
because it grouped answers into semantic domain objects the form doesn't
share the shape of.

The form is AES-256 encrypted with an empty user password, same as lucy's
3500B (confirmed 2026-08-22 against the live fda.gov download) — pymupdf
opens it without prompting; pdf-lib (JS) cannot open it at all.
"""

import json
import os
import sys

import fitz  # pymupdf

FORM_PATH = os.path.join(
    os.path.dirname(__file__), "FDA_3500_Stat_Sec_Ext_09-15-2025.pdf"
)
MANIFEST_PATH = os.path.join(os.path.dirname(__file__), "form-3500-fields.json")

UNKNOWN_SENTINEL = "Unknown"
DECLINED_SENTINEL = "Declined to answer"

# Named overrides for confirmed PDF/manifest quirks only — see the comment
# above Prod1StrengthUnit in form-3500-fields.ts. The source PDF's own
# /Opt array pairs the display text "AS NECESSARY - AN" (a Frequency value)
# with an unrelated Strength/Dose unit export code on these four fields.
# The manifest reproduces it faithfully in options[] (not corrected there),
# so the generic "value must be in options[]" check alone would let it
# through; it is never a legitimate answer for a Strength/Dose Unit field.
DISALLOWED_ENUM_VALUES = {
    "Page4.Prod1.Prod1StrengthUnit": {"AS NECESSARY - AN"},
    "Page4.Prod1.Prod1DoseUnit": {"AS NECESSARY - AN"},
    "Page5.Prod2.Prod2StrengthUnit": {"AS NECESSARY - AN"},
    "Page5.Prod2.Prod2DoseUnit": {"AS NECESSARY - AN"},
}


class FillError(ValueError):
    """A record cannot be exported as given. Raised before any widget is
    written — never write a partial/inconsistent PDF."""


def load_manifest(path=MANIFEST_PATH):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _entry_for(record, field_id):
    """The record's entry for a field, defaulting to `unasked` when the
    field is missing from the record entirely — the same tolerance
    src/lib/agenda.ts's `nextField` extends a not-yet-reached field."""
    return record.get(field_id, {"state": "unasked"})


def check_export_ready(manifest, record):
    """Refuse if any required field is still `unasked`. Today no field in
    form-3500-fields.ts is required=true (the FDA 3500 is voluntary), so
    this is a no-op in practice — but stays load-bearing the moment one is
    ever marked required."""
    missing = [
        field["id"]
        for field in manifest
        if field["required"] and _entry_for(record, field["id"]).get("state") == "unasked"
    ]
    if missing:
        raise FillError(
            "record is not export-ready: required field(s) still unasked: "
            + ", ".join(missing)
        )


def render_value(field, entry):
    """Decide what to write for one field.

    Returns (kind, value): kind is "text" (write value as the field's
    text/choice value), "check" (value is a bool for a checkbox), or None
    (leave the widget untouched — value is also None in that case).
    """
    state = entry.get("state", "unasked")
    is_checkbox = field["type"] == "checkbox"

    if state == "answered":
        value = entry.get("value")
        # A record claiming `answered` with no real value would otherwise
        # write `None`/"" straight to the widget — pymupdf accepts it
        # silently, round-tripping as an empty field with no error signal,
        # so "answered but blank" would be indistinguishable from
        # `unasked`. src/lib/agenda.ts's applyAction() already refuses
        # this at the record layer; refused here too since this script
        # doesn't get to assume its input came through that path.
        if not isinstance(value, str) or not value.strip():
            raise FillError(
                f"{field['id']}: answered field must carry a non-empty "
                f"string value, got {value!r}"
            )
        if field["type"] == "enum":
            options = field.get("options") or []
            disallowed = DISALLOWED_ENUM_VALUES.get(field["id"], set())
            if value not in options or value in disallowed:
                raise FillError(
                    f"{field['id']}: answered value {value!r} is not a valid option"
                )
            return ("text", value)
        if is_checkbox:
            # "true"/"false" is this script's own contract, not something
            # src/lib/agenda.ts enforces — AgendaEntry.value is typed as a
            # plain string for every field type, same as enum's options[]
            # membership above. Whatever eventually writes a checkbox
            # answer (Extractor, or a UI) needs to honor this string shape.
            if value not in ("true", "false"):
                raise FillError(
                    f"{field['id']}: checkbox answered value must be "
                    f"'true' or 'false', got {value!r}"
                )
            return ("check", value == "true")
        return ("text", value)

    if state == "unknown":
        # A PDF checkbox has no third visual state to render "unknown" or
        # "declined" onto without inventing a fake option the form doesn't
        # have — left unchecked, same as `unasked`. Text/date/enum fields
        # get an explicit sentinel instead of being left blank, so a
        # reviewer can tell "not asked" apart from "asked, no answer".
        return (None, None) if is_checkbox else ("text", UNKNOWN_SENTINEL)

    if state == "declined":
        return (None, None) if is_checkbox else ("text", DECLINED_SENTINEL)

    # `unasked`: only legal here for a non-required field (check_export_ready
    # already refused any required field left unasked). Leave blank.
    return (None, None)


def _widget_names(doc):
    """Every widget field name in the document. Names only, not widget
    objects: pymupdf's Widget/Page wrappers go stale (a weakref
    ReferenceError on the next attribute access) once their Page has been
    left behind by the `for page in doc` loop that produced them, so no
    widget object may be held onto past the page iteration that yielded
    it — see apply_fields() below, which writes within that same scope."""
    return {widget.field_name for page in doc for widget in page.widgets()}


def render_fields(manifest, record):
    """Compute (kind, value) for every field up front. Raises FillError (an
    invalid enum/checkbox answer) before apply_fields() touches a single
    PDF widget — validation is fully separate from writing, not
    interleaved with it."""
    return {
        field["id"]: render_value(field, _entry_for(record, field["id"]))
        for field in manifest
    }


def apply_fields(doc, manifest, rendered):
    """Write every field's precomputed value while each page is still in
    scope. Precondition: check_widgets_present() has already confirmed
    every manifest field resolves to a real widget, so no not-found case
    needs handling here."""
    by_pdf_name = {field["pdfFieldName"]: field for field in manifest}
    for page in doc:
        for widget in page.widgets():
            field = by_pdf_name.get(widget.field_name)
            if field is None:
                continue
            kind, value = rendered[field["id"]]
            if kind is None:
                continue
            if kind == "check":
                widget.field_value = widget.on_state() if value else "Off"
            else:
                widget.field_value = value
            widget.update()


def check_widgets_present(doc, manifest):
    """Refuse if any manifest field has no matching widget on the form —
    checked before any write, same never-partial discipline as
    check_export_ready()."""
    real_names = _widget_names(doc)
    missing = [
        field["id"]
        for field in manifest
        if field["pdfFieldName"] not in real_names
    ]
    if missing:
        raise FillError(
            "field(s) in the manifest have no matching widget on the form: "
            + ", ".join(missing)
        )


def fill(record, doc, manifest=None):
    """Fill `doc` (an open pymupdf Document) from `record` in place."""
    manifest = load_manifest() if manifest is None else manifest
    check_export_ready(manifest, record)
    check_widgets_present(doc, manifest)
    rendered = render_fields(manifest, record)
    apply_fields(doc, manifest, rendered)


def fill_form(record, form_path=FORM_PATH, manifest=None):
    """Open the real form, fill it, and return the filled PDF bytes."""
    doc = fitz.open(form_path)
    fill(record, doc, manifest=manifest)
    return doc.tobytes()


if __name__ == "__main__":
    input_record = json.load(sys.stdin)
    sys.stdout.buffer.write(fill_form(input_record))
