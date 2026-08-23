"""Tests for api/generate-pdf.py's build_response — the request/response
shaping split out from the socket-facing handler, same separation lucy's
own api/generate-pdf.py uses ("testable without a socket").

fill_form itself is not re-tested here: scripts/tests/test_fill_3500.py
already proves the mapping against the fixture corpus (Issue #10). This
file only proves the route wraps that call correctly — refuses malformed
requests, and never lets an exception (which could carry a field value)
escape as a message.
"""

import importlib.util
import json
import os

import pytest

SCRIPT_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "api", "generate-pdf.py")
)


def _load_module():
    spec = importlib.util.spec_from_file_location("generate_pdf", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def route():
    return _load_module()


VALID_RECORD = json.dumps({"f1": {"state": "answered", "value": "x"}, "f2": {"state": "unasked"}}).encode()


def fake_filler_ok(record):
    return b"FAKE-PDF-BYTES"


def fake_filler_raises(record):
    raise ValueError(f"leaked field value from {record}")


class TestBuildResponse:
    def test_rejects_non_post(self, route):
        status, content_type, payload = route.build_response("GET", "application/json", "0", b"")
        assert status == 405
        assert json.loads(payload) == {"error": "bad_method"}

    def test_rejects_wrong_content_type(self, route):
        status, _, payload = route.build_response(
            "POST", "text/plain", str(len(VALID_RECORD)), VALID_RECORD
        )
        assert status == 415
        assert json.loads(payload) == {"error": "bad_content_type"}

    def test_accepts_content_type_with_charset_param(self, route):
        status, _, _ = route.build_response(
            "POST",
            "application/json; charset=utf-8",
            str(len(VALID_RECORD)),
            VALID_RECORD,
            filler=fake_filler_ok,
        )
        assert status == 200

    def test_content_type_match_is_case_insensitive(self, route):
        status, _, _ = route.build_response(
            "POST", "APPLICATION/JSON", str(len(VALID_RECORD)), VALID_RECORD, filler=fake_filler_ok
        )
        assert status == 200

    def test_rejects_missing_content_length(self, route):
        status, _, payload = route.build_response("POST", "application/json", None, VALID_RECORD)
        assert status == 411
        assert json.loads(payload) == {"error": "length_required"}

    def test_rejects_non_integer_content_length(self, route):
        status, _, payload = route.build_response("POST", "application/json", "abc", VALID_RECORD)
        assert status == 411

    def test_rejects_body_over_the_size_cap(self, route):
        big = b"1" * (route.MAX_BODY_BYTES + 1)
        status, _, payload = route.build_response(
            "POST", "application/json", str(len(big)), big
        )
        assert status == 413
        assert json.loads(payload) == {"error": "too_large"}

    def test_rejects_when_actual_body_exceeds_the_declared_length_cap(self, route):
        # Declared length lies small, but the actual body handed in is over
        # the cap — the fact (len(body)), not the client's claim, governs.
        big = b"1" * (route.MAX_BODY_BYTES + 1)
        status, _, payload = route.build_response("POST", "application/json", "1", big)
        assert status == 413

    def test_rejects_malformed_json(self, route):
        status, _, payload = route.build_response(
            "POST", "application/json", "1", b"{"
        )
        assert status == 400
        assert json.loads(payload) == {"error": "bad_json"}

    def test_rejects_json_that_is_not_a_record(self, route):
        body = json.dumps([1, 2, 3]).encode()
        status, _, payload = route.build_response("POST", "application/json", str(len(body)), body)
        assert status == 400
        assert json.loads(payload) == {"error": "bad_record"}

    def test_rejects_a_field_entry_with_an_unknown_state(self, route):
        body = json.dumps({"f1": {"state": "not_a_real_state"}}).encode()
        status, _, payload = route.build_response("POST", "application/json", str(len(body)), body)
        assert status == 400
        assert json.loads(payload) == {"error": "bad_record"}

    def test_rejects_a_record_over_the_field_count_cap(self, route):
        body = json.dumps({f"f{i}": {"state": "unasked"} for i in range(route.MAX_FIELDS + 1)}).encode()
        status, _, payload = route.build_response("POST", "application/json", str(len(body)), body)
        assert status == 400
        assert json.loads(payload) == {"error": "bad_record"}

    def test_success_returns_pdf_bytes_from_the_filler(self, route):
        status, content_type, payload = route.build_response(
            "POST", "application/json", str(len(VALID_RECORD)), VALID_RECORD, filler=fake_filler_ok
        )
        assert status == 200
        assert content_type == route.PDF_MIME
        assert payload == b"FAKE-PDF-BYTES"

    def test_filler_exception_never_leaks_into_the_response(self, route):
        status, _, payload = route.build_response(
            "POST", "application/json", str(len(VALID_RECORD)), VALID_RECORD, filler=fake_filler_raises
        )
        assert status == 500
        body = json.loads(payload)
        assert body == {"error": "pdf_failed"}
        assert "leaked" not in payload.decode()
