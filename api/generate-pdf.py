"""Fill the FDA 3500 from an AgendaRecord and return the PDF (Issue #34).

**Why this runs on a server at all.** Same reason as lucy's
api/generate-pdf.py: the form is AES-256 encrypted with an empty user
password, pdf-lib (JS) cannot open it, and pymupdf can — so the record
transits here to be filled. Nothing is persisted (docs/design.md's
no-server-side-persistence posture): this function reads one request body,
returns filled PDF bytes, and keeps no state between calls.

Unlike lucy, this route's PDF is rendered inline in the wizard for review
(2026-08-23 design decision — the charter's end condition names reviewing
"a … PDF" specifically, not a download offered blind), so no
Content-Disposition: attachment header is set here; the client decides
inline-preview vs. download from the same response bytes.

Every rejection here is a fixed code, mirroring lucy's own rule: nothing
derived from the request body — a field value above all — is ever
returned or printed. `fill-3500.py`'s own mapping correctness is proven
separately by scripts/tests/test_fill_3500.py's fixture corpus (Issue
#10); this route is only proven to wrap that call correctly.
"""

import importlib.util
import json
import os
from http.server import BaseHTTPRequestHandler

SCRIPT_PATH = os.path.join(os.path.dirname(__file__), "..", "scripts", "fill-3500.py")

# Well above any real record (the manifest is 227 fields; every value is a
# short form answer) — a DoS-shaped guard, not a realistic ceiling.
MAX_BODY_BYTES = 256 * 1024
MAX_FIELDS = 500

VALID_STATES = ("unasked", "answered", "unknown", "declined")

PDF_MIME = "application/pdf"
JSON_MIME = "application/json"

_module = None


def _load_fill_module():
    """Load fill-3500.py once per warm instance (its filename has a hyphen)."""
    global _module
    if _module is None:
        spec = importlib.util.spec_from_file_location("fill_3500", os.path.normpath(SCRIPT_PATH))
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _module = module
    return _module


def error(status, code):
    """A refusal, as a fixed code. Never a message built from the request."""
    return status, JSON_MIME, json.dumps({"error": code}).encode()


def is_record(payload):
    """A structural check, not a schema: is this shaped like an
    AgendaRecord (src/lib/agenda.ts) at all? Refuses anything else before
    fill_form() ever opens the PDF."""
    if not isinstance(payload, dict):
        return False
    if len(payload) > MAX_FIELDS:
        return False
    for entry in payload.values():
        if not isinstance(entry, dict):
            return False
        if entry.get("state") not in VALID_STATES:
            return False
        if "value" in entry and not isinstance(entry["value"], str):
            return False
    return True


def build_response(method, content_type, content_length, body, filler=None):
    """The whole decision, as a function of the request. Returns
    `(status, content_type, payload_bytes)` — separated from the socket
    handler so every branch is testable without one, matching lucy's own
    api/generate-pdf.py split."""
    if method != "POST":
        return error(405, "bad_method")
    media_type = content_type.split(";")[0].strip().lower() if isinstance(content_type, str) else ""
    if media_type != JSON_MIME:
        return error(415, "bad_content_type")
    if content_length is None:
        return error(411, "length_required")
    try:
        declared = int(content_length)
    except (TypeError, ValueError):
        return error(411, "length_required")
    if declared < 0 or declared > MAX_BODY_BYTES:
        return error(413, "too_large")
    # The declared length is the client's claim; the body is the fact.
    if len(body) > MAX_BODY_BYTES:
        return error(413, "too_large")

    try:
        payload = json.loads(body)
    except Exception:
        # `Exception`, not `ValueError` — lucy's own api/generate-pdf.py
        # found a body that stays under the size cap but still raises
        # RecursionError out of json.loads, which escapes a bare `except
        # ValueError` entirely.
        return error(400, "bad_json")
    if not is_record(payload):
        return error(400, "bad_record")

    try:
        fill = filler or _load_fill_module().fill_form
        pdf_bytes = fill(payload)
    except Exception:
        # Deliberately swallowed: an exception here can carry a field
        # value (fill-3500.py's own FillError messages name field ids from
        # the record). The caller gets a code; nothing is logged.
        return error(500, "pdf_failed")
    return 200, PDF_MIME, pdf_bytes


class handler(BaseHTTPRequestHandler):
    def _respond(self, method):
        try:
            status, content_type, payload = self._decide(method)
        except Exception:
            status, content_type, payload = error(500, "pdf_failed")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _decide(self, method):
        length = self.headers.get("Content-Length")
        try:
            declared = int(length) if length is not None else 0
        except (TypeError, ValueError):
            declared = 0
        body = self.rfile.read(min(declared, MAX_BODY_BYTES + 1)) if declared > 0 else b""
        return build_response(method, self.headers.get("Content-Type"), length, body)

    def do_POST(self):
        self._respond("POST")

    def do_GET(self):
        self._respond("GET")

    def log_message(self, *args):
        """Silence the default access log — nothing derived from a
        clinician's record reaches a server log."""
        return
