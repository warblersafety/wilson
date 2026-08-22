"""Shared pytest fixtures for fill-3500.py tests.

The script's filename has a hyphen, so it's loaded via importlib instead of
a normal `import fill_3500`. Exposing it as the `fill` fixture lets tests
call `fill.render_value(...)` etc. directly.
"""

import importlib.util
import json
import os

import pytest

SCRIPT_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "fill-3500.py")
)
FIXTURES_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "fixtures"))


def _load_module():
    spec = importlib.util.spec_from_file_location("fill_3500", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def fill():
    """The fill-3500.py module, loaded via importlib."""
    return _load_module()


@pytest.fixture(scope="session")
def real_manifest(fill):
    """The real, checked-in 227-field manifest."""
    return fill.load_manifest()


@pytest.fixture
def load_fixture():
    """Factory: load one scripts/fixtures/*.json file by name."""

    def _load(name):
        path = os.path.join(FIXTURES_DIR, name)
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)

    return _load


class FakeWidget:
    """Minimal stand-in for a pymupdf form widget — captures writes without
    a real PDF."""

    def __init__(self, field_name: str, field_type_string: str = "Text"):
        self.field_name = field_name
        self.field_type_string = field_type_string
        self.field_value = None
        self.update_calls = 0

    def on_state(self):
        return "Yes"

    def update(self):
        self.update_calls += 1


class FakePage:
    """Minimal stand-in for a pymupdf page exposing widgets()."""

    def __init__(self, widgets):
        self._widgets = list(widgets)

    def widgets(self):
        return self._widgets


class FakeDoc:
    """Minimal stand-in for a pymupdf Document: iterable over its pages,
    plus tobytes() so fill()'s callers can be exercised without real I/O."""

    def __init__(self, pages):
        self._pages = list(pages)

    def __iter__(self):
        return iter(self._pages)

    def tobytes(self):
        return b"FAKE-PDF-BYTES"


@pytest.fixture
def doc_with():
    """Factory: build a FakeDoc (single page) from a list of
    (field_name, field_type_string) pairs.

    Usage: doc = doc_with([("a.b.Foo[0]", "Text"), ("a.b.Bar[0]", "CheckBox")])
    """

    def _make(specs):
        widgets = [FakeWidget(name, ftype) for name, ftype in specs]
        return FakeDoc([FakePage(widgets)])

    return _make


@pytest.fixture
def widget_on():
    """Factory: find a widget by exact field_name across all pages of a FakeDoc."""

    def _find(doc, field_name):
        for page in doc:
            for widget in page.widgets():
                if widget.field_name == field_name:
                    return widget
        return None

    return _find


@pytest.fixture
def doc_for_manifest():
    """Factory: build a FakeDoc with one widget per field in a manifest —
    field type mapped to a plausible pymupdf field_type_string."""

    def _make(manifest):
        widgets = [
            FakeWidget(
                field["pdfFieldName"],
                "CheckBox" if field["type"] == "checkbox" else "Text",
            )
            for field in manifest
        ]
        return FakeDoc([FakePage(widgets)])

    return _make
