"""Issue #67's "one mapping truth" proof.

The report chrome's Form 3500 facsimile (src/lib/form-3500-facsimile.ts)
is a second, HTML rendering of render_value()'s decisions — a necessary
duplication, since fill-3500.py's own rendering logic is Python-only and
never reaches the browser (see docs/design.md, "The report chrome").
This file and src/lib/form-3500-facsimile.test.ts both pin themselves
against the SAME checked-in expectations
(scripts/fixtures/report-chrome-reference-case.expected.json), computed
by hand from render_value()'s documented rules — not against each other
directly (there is no runtime bridge between pytest and vitest), but a
divergence in either implementation breaks its own side against that
shared file, which is the actual guarantee "one mapping truth" asks for.

Values are normalized before comparing: render_value() returns a
(kind, value) tuple whose shape (a raw PDF-write instruction) has no
TypeScript equivalent worth replicating — kind="check" collapses to a
plain bool, kind=None collapses to None, kind="text" collapses to its
string. That normalized shape is what the expectations file stores.
"""

from __future__ import annotations

import json
import os

FIXTURES_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "fixtures"))


def _normalize(rendered):
    kind, value = rendered
    if kind is None:
        return None
    if kind == "check":
        return bool(value)
    return value


class TestReferenceCaseMatchesExpectations:
    def test_every_expected_field_matches_render_value(self, fill, real_manifest, load_fixture):
        record = load_fixture("report-chrome-reference-case.json")
        expected = load_fixture("report-chrome-reference-case.expected.json")
        by_id = {f["id"]: f for f in real_manifest}

        mismatches = []
        for field_id, expected_value in expected.items():
            assert field_id in by_id, f"{field_id} is not a real manifest field"
            entry = record.get(field_id, {"state": "unasked"})
            actual = _normalize(fill.render_value(by_id[field_id], entry))
            if actual != expected_value:
                mismatches.append(f"{field_id}: expected {expected_value!r}, got {actual!r}")
        assert not mismatches, "\n".join(mismatches)

    def test_every_record_field_is_covered_by_an_expectation(self, load_fixture):
        # Guards the fixture pair itself, not fill-3500.py: an entry added
        # to the record but never checked against an expectation would
        # silently stop proving anything for that field.
        record = load_fixture("report-chrome-reference-case.json")
        expected = load_fixture("report-chrome-reference-case.expected.json")
        missing = sorted(set(record) - set(expected))
        assert not missing, f"record field(s) with no expectation entry: {missing}"
