"""Tests for fill-3500.py's mapping logic.

These run entirely against FakeWidget/FakePage/FakeDoc stand-ins — no real
PDF I/O. test_fill_3500_real_form.py is what proves the mapping survives
contact with the actual encrypted FDA_3500 PDF.
"""

from __future__ import annotations

import pytest


def text_field(field_id="F.text", required=False):
    return {
        "id": field_id,
        "pdfFieldName": f"form.{field_id}[0]",
        "type": "text",
        "required": required,
    }


def date_field(field_id="F.date", required=False):
    return {
        "id": field_id,
        "pdfFieldName": f"form.{field_id}[0]",
        "type": "date",
        "required": required,
    }


def checkbox_field(field_id="F.check", required=False):
    return {
        "id": field_id,
        "pdfFieldName": f"form.{field_id}[0]",
        "type": "checkbox",
        "required": required,
    }


def enum_field(field_id="F.enum", options=None, required=False):
    return {
        "id": field_id,
        "pdfFieldName": f"form.{field_id}[0]",
        "type": "enum",
        "required": required,
        "options": options if options is not None else [" ", "A", "B"],
    }


# ---------------------------------------------------------------------------
# render_value — per (type, state) combination
# ---------------------------------------------------------------------------


class TestRenderValueText:
    def test_answered_writes_value(self, fill):
        assert fill.render_value(text_field(), {"state": "answered", "value": "hi"}) == (
            "text",
            "hi",
        )

    def test_unknown_writes_sentinel(self, fill):
        assert fill.render_value(text_field(), {"state": "unknown"}) == (
            "text",
            fill.UNKNOWN_SENTINEL,
        )

    def test_declined_writes_sentinel(self, fill):
        assert fill.render_value(text_field(), {"state": "declined"}) == (
            "text",
            fill.DECLINED_SENTINEL,
        )

    def test_declined_and_unknown_sentinels_differ(self, fill):
        unknown = fill.render_value(text_field(), {"state": "unknown"})
        declined = fill.render_value(text_field(), {"state": "declined"})
        assert unknown != declined

    def test_unasked_writes_nothing(self, fill):
        assert fill.render_value(text_field(), {"state": "unasked"}) == (None, None)

    def test_date_field_behaves_like_text(self, fill):
        assert fill.render_value(date_field(), {"state": "unknown"}) == (
            "text",
            fill.UNKNOWN_SENTINEL,
        )


class TestRenderValueCheckbox:
    def test_answered_true(self, fill):
        assert fill.render_value(checkbox_field(), {"state": "answered", "value": "true"}) == (
            "check",
            True,
        )

    def test_answered_false(self, fill):
        assert fill.render_value(checkbox_field(), {"state": "answered", "value": "false"}) == (
            "check",
            False,
        )

    def test_answered_rejects_non_boolean_string(self, fill):
        with pytest.raises(fill.FillError):
            fill.render_value(checkbox_field(), {"state": "answered", "value": "yes"})

    def test_unknown_leaves_unchecked_not_written(self, fill):
        # A checkbox has no third visual state; unknown/declined are left
        # alone rather than inventing a fake sentinel value.
        assert fill.render_value(checkbox_field(), {"state": "unknown"}) == (None, None)

    def test_declined_leaves_unchecked_not_written(self, fill):
        assert fill.render_value(checkbox_field(), {"state": "declined"}) == (None, None)

    def test_unasked_writes_nothing(self, fill):
        assert fill.render_value(checkbox_field(), {"state": "unasked"}) == (None, None)


class TestRenderValueEnum:
    def test_answered_with_valid_option(self, fill):
        assert fill.render_value(enum_field(), {"state": "answered", "value": "A"}) == (
            "text",
            "A",
        )

    def test_answered_rejects_value_not_in_options(self, fill):
        with pytest.raises(fill.FillError):
            fill.render_value(enum_field(), {"state": "answered", "value": "Z"})

    def test_unknown_writes_sentinel(self, fill):
        assert fill.render_value(enum_field(), {"state": "unknown"}) == (
            "text",
            fill.UNKNOWN_SENTINEL,
        )

    def test_disallowed_override_rejected_even_though_in_options(self, fill):
        # Prod1StrengthUnit's options[] faithfully reproduces the source
        # PDF's own /Opt defect: "AS NECESSARY - AN" is present in the list
        # but is never a legitimate Strength/Dose Unit answer.
        field = enum_field(
            field_id="Page4.Prod1.Prod1StrengthUnit",
            options=[" ", "AS NECESSARY - AN", "MILLIGRAM(S) - MG"],
        )
        with pytest.raises(fill.FillError):
            fill.render_value(field, {"state": "answered", "value": "AS NECESSARY - AN"})

    def test_other_options_on_the_same_field_still_allowed(self, fill):
        field = enum_field(
            field_id="Page4.Prod1.Prod1StrengthUnit",
            options=[" ", "AS NECESSARY - AN", "MILLIGRAM(S) - MG"],
        )
        assert fill.render_value(
            field, {"state": "answered", "value": "MILLIGRAM(S) - MG"}
        ) == ("text", "MILLIGRAM(S) - MG")


# ---------------------------------------------------------------------------
# check_export_ready
# ---------------------------------------------------------------------------


class TestCheckExportReady:
    def test_passes_when_no_field_is_required(self, fill):
        manifest = [text_field("a"), text_field("b")]
        record = {"a": {"state": "unasked"}, "b": {"state": "unasked"}}
        fill.check_export_ready(manifest, record)  # does not raise

    def test_passes_when_required_field_is_resolved(self, fill):
        manifest = [text_field("a", required=True)]
        record = {"a": {"state": "declined"}}
        fill.check_export_ready(manifest, record)  # does not raise

    def test_raises_when_required_field_still_unasked(self, fill):
        manifest = [text_field("a", required=True)]
        record = {"a": {"state": "unasked"}}
        with pytest.raises(fill.FillError):
            fill.check_export_ready(manifest, record)

    def test_raises_when_required_field_missing_from_record_entirely(self, fill):
        manifest = [text_field("a", required=True)]
        with pytest.raises(fill.FillError):
            fill.check_export_ready(manifest, {})

    def test_names_every_missing_required_field(self, fill):
        manifest = [text_field("a", required=True), text_field("b", required=True)]
        record = {"a": {"state": "unasked"}, "b": {"state": "unasked"}}
        with pytest.raises(fill.FillError) as excinfo:
            fill.check_export_ready(manifest, record)
        assert "a" in str(excinfo.value)
        assert "b" in str(excinfo.value)


# ---------------------------------------------------------------------------
# fill() — end to end against FakeDoc
# ---------------------------------------------------------------------------


class TestFillEndToEnd:
    def test_writes_answered_text_value_to_the_matching_widget(self, fill, doc_with, widget_on):
        manifest = [text_field("a")]
        doc = doc_with([("form.a[0]", "Text")])
        fill.fill({"a": {"state": "answered", "value": "hello"}}, doc, manifest=manifest)
        assert widget_on(doc, "form.a[0]").field_value == "hello"

    def test_writes_checked_state_for_answered_true_checkbox(self, fill, doc_with, widget_on):
        manifest = [checkbox_field("c")]
        doc = doc_with([("form.c[0]", "CheckBox")])
        fill.fill({"c": {"state": "answered", "value": "true"}}, doc, manifest=manifest)
        widget = widget_on(doc, "form.c[0]")
        assert widget.field_value == widget.on_state()
        assert widget.update_calls == 1

    def test_writes_off_for_answered_false_checkbox(self, fill, doc_with, widget_on):
        manifest = [checkbox_field("c")]
        doc = doc_with([("form.c[0]", "CheckBox")])
        fill.fill({"c": {"state": "answered", "value": "false"}}, doc, manifest=manifest)
        assert widget_on(doc, "form.c[0]").field_value == "Off"

    def test_unasked_field_widget_is_never_touched(self, fill, doc_with, widget_on):
        manifest = [text_field("a")]
        doc = doc_with([("form.a[0]", "Text")])
        fill.fill({"a": {"state": "unasked"}}, doc, manifest=manifest)
        widget = widget_on(doc, "form.a[0]")
        assert widget.field_value is None
        assert widget.update_calls == 0

    def test_field_missing_from_record_entirely_is_treated_as_unasked(
        self, fill, doc_with, widget_on
    ):
        manifest = [text_field("a")]
        doc = doc_with([("form.a[0]", "Text")])
        fill.fill({}, doc, manifest=manifest)
        assert widget_on(doc, "form.a[0]").update_calls == 0

    def test_raises_and_writes_nothing_when_not_export_ready(self, fill, doc_with, widget_on):
        manifest = [text_field("a", required=True), text_field("b")]
        doc = doc_with([("form.a[0]", "Text"), ("form.b[0]", "Text")])
        record = {"a": {"state": "unasked"}, "b": {"state": "answered", "value": "x"}}
        with pytest.raises(fill.FillError):
            fill.fill(record, doc, manifest=manifest)
        # Never-partial: the readiness check runs before any widget write.
        assert widget_on(doc, "form.b[0]").update_calls == 0

    def test_invalid_enum_value_on_one_field_writes_nothing_at_all(
        self, fill, doc_with, widget_on
    ):
        # render_fields() validates every field before apply_fields() writes
        # any of them, so a bad value late in the manifest must not leave
        # an earlier, valid field already written.
        manifest = [text_field("a"), enum_field("b")]
        doc = doc_with([("form.a[0]", "Text"), ("form.b[0]", "ComboBox")])
        record = {
            "a": {"state": "answered", "value": "fine"},
            "b": {"state": "answered", "value": "not-an-option"},
        }
        with pytest.raises(fill.FillError):
            fill.fill(record, doc, manifest=manifest)
        assert widget_on(doc, "form.a[0]").update_calls == 0

    def test_raises_when_manifest_field_has_no_matching_widget(self, fill, doc_with):
        manifest = [text_field("a")]
        doc = doc_with([])  # no widgets at all
        with pytest.raises(fill.FillError):
            fill.fill({"a": {"state": "answered", "value": "x"}}, doc, manifest=manifest)

    def test_fills_every_field_type_in_one_pass(self, fill, doc_with, widget_on):
        manifest = [
            text_field("t"),
            date_field("d"),
            checkbox_field("c"),
            enum_field("e", options=[" ", "A"]),
        ]
        doc = doc_with(
            [
                ("form.t[0]", "Text"),
                ("form.d[0]", "Text"),
                ("form.c[0]", "CheckBox"),
                ("form.e[0]", "ComboBox"),
            ]
        )
        record = {
            "t": {"state": "answered", "value": "hi"},
            "d": {"state": "answered", "value": "2026-01-01"},
            "c": {"state": "answered", "value": "true"},
            "e": {"state": "answered", "value": "A"},
        }
        fill.fill(record, doc, manifest=manifest)
        assert widget_on(doc, "form.t[0]").field_value == "hi"
        assert widget_on(doc, "form.d[0]").field_value == "2026-01-01"
        assert widget_on(doc, "form.c[0]").field_value == widget_on(doc, "form.c[0]").on_state()
        assert widget_on(doc, "form.e[0]").field_value == "A"


# ---------------------------------------------------------------------------
# The real manifest — sanity checks that don't need the real PDF
# ---------------------------------------------------------------------------


class TestRealManifest:
    def test_loads_227_fields(self, real_manifest):
        assert len(real_manifest) == 227

    def test_every_field_has_the_keys_render_value_needs(self, real_manifest):
        for field in real_manifest:
            assert "id" in field
            assert "pdfFieldName" in field
            assert "type" in field
            assert "required" in field

    def test_disallowed_override_fields_are_all_present_and_enum_typed(self, fill, real_manifest):
        by_id = {f["id"]: f for f in real_manifest}
        for field_id in fill.DISALLOWED_ENUM_VALUES:
            assert field_id in by_id, f"{field_id} missing from the manifest"
            assert by_id[field_id]["type"] == "enum"


# ---------------------------------------------------------------------------
# Fixture corpus — loads via fake widgets, no real PDF
# ---------------------------------------------------------------------------


class TestFixtureCorpus:
    def test_full_resolved_fixture_fills_without_error(
        self, fill, real_manifest, load_fixture, doc_for_manifest
    ):
        record = load_fixture("full-resolved.json")
        doc = doc_for_manifest(real_manifest)
        fill.fill(record, doc, manifest=real_manifest)  # does not raise

    def test_mixed_declined_unknown_fixture_fills_without_error(
        self, fill, real_manifest, load_fixture, doc_for_manifest
    ):
        record = load_fixture("mixed-declined-unknown.json")
        doc = doc_for_manifest(real_manifest)
        fill.fill(record, doc, manifest=real_manifest)  # does not raise

    def test_checkbox_enum_exercise_fixture_fills_without_error(
        self, fill, real_manifest, load_fixture, doc_for_manifest
    ):
        record = load_fixture("checkbox-enum-exercise.json")
        doc = doc_for_manifest(real_manifest)
        fill.fill(record, doc, manifest=real_manifest)  # does not raise
