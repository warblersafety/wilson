"""Issue #9 acceptance criteria — the filler meets the actual form.

Every other test of fill-3500.py runs against the FakeDoc/FakePage/FakeWidget
stand-ins in conftest.py. They prove the mapping logic decides the right
value; they cannot prove that Prod1StrengthUnit[0] is still a widget on the
real PDF, that the file opens at all, or that a value written survives a
save. This file is what opens the real, checked-in FDA_3500 PDF.

That matters more here than it would elsewhere: the form is AES-256
encrypted with an empty user password (confirmed 2026-08-22 against the live
fda.gov download), same scheme lucy hit on 3500B. pymupdf opens it without
prompting; pdf-lib (JS) cannot open it at all — the whole reason this
component is Python.
"""

from __future__ import annotations

import os

import pytest

try:
    import fitz
except ImportError:  # pragma: no cover - depends on the machine, not the code
    if os.environ.get("CI"):
        raise
    pytest.skip("pymupdf not installed on this machine", allow_module_level=True)

FORM_PATH = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__), "..", "FDA_3500_Stat_Sec_Ext_09-15-2025.pdf"
    )
)


def widget_values(pdf_bytes):
    """Every non-empty widget in a produced PDF, keyed by its full field name."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    values = {}
    for page in doc:
        for widget in page.widgets():
            if widget.field_value in (None, "", "Off"):
                continue
            values[widget.field_name] = widget.field_value
    return values


class TestTheFormItself:
    def test_the_form_opens_and_still_has_its_manifest_widgets(self, real_manifest):
        doc = fitz.open(FORM_PATH)
        assert not doc.needs_pass
        real_names = {w.field_name for page in doc for w in page.widgets()}
        missing = [
            f["pdfFieldName"] for f in real_manifest if f["pdfFieldName"] not in real_names
        ]
        assert not missing, (
            f"{len(missing)} manifest field(s) no longer resolve on the real "
            f"PDF: {missing[:10]}"
        )


class TestFillFormAgainstTheRealPdf:
    def test_fills_a_fully_resolved_fixture_and_values_land_on_real_widgets(
        self, fill, load_fixture
    ):
        record = load_fixture("full-resolved.json")
        pdf_bytes = fill.fill_form(record, form_path=FORM_PATH)
        values = widget_values(pdf_bytes)

        manifest = fill.load_manifest()
        text_field_id = next(
            f["id"]
            for f in manifest
            if f["type"] in ("text", "date") and record[f["id"]]["state"] == "answered"
        )
        text_field = next(f for f in manifest if f["id"] == text_field_id)
        assert values[text_field["pdfFieldName"]] == record[text_field_id]["value"]

    def test_declined_field_gets_the_sentinel_on_the_real_widget(self, fill, load_fixture):
        record = load_fixture("mixed-declined-unknown.json")
        pdf_bytes = fill.fill_form(record, form_path=FORM_PATH)
        values = widget_values(pdf_bytes)

        declined_id = "Page1.SecA_Patient.DateBirth"
        assert record[declined_id]["state"] == "declined"
        field = next(f for f in fill.load_manifest() if f["id"] == declined_id)
        assert values[field["pdfFieldName"]] == fill.DECLINED_SENTINEL

    def test_answered_checkbox_is_actually_checked_on_the_real_widget(
        self, fill, load_fixture
    ):
        record = load_fixture("checkbox-enum-exercise.json")
        pdf_bytes = fill.fill_form(record, form_path=FORM_PATH)

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        field = next(
            f for f in fill.load_manifest() if f["id"] == "Page1.SecA_Patient.SexF"
        )
        widget = next(
            w
            for page in doc
            for w in page.widgets()
            if w.field_name == field["pdfFieldName"]
        )
        assert widget.field_value not in (None, "", "Off")

    def test_rejects_the_disallowed_enum_override_against_the_real_manifest(self, fill):
        record = {"Page4.Prod1.Prod1StrengthUnit": {"state": "answered", "value": "AS NECESSARY - AN"}}
        with pytest.raises(fill.FillError):
            fill.fill_form(record, form_path=FORM_PATH)
