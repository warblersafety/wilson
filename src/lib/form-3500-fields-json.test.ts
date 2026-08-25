// scripts/fill-3500.py (Python, for pymupdf/AcroForm access) needs the same
// field manifest src/lib/form-3500-fields.ts already pins, but can't import
// TypeScript directly. scripts/form-3500-fields.json is a checked-in
// snapshot of FORM_3500_FIELDS; this test is what keeps it from silently
// drifting out of sync with the source of truth.
//
// To regenerate after an intentional manifest change, run:
//   UPDATE_FORM_3500_FIELDS_JSON=1 npx vitest run src/lib/form-3500-fields-json.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FORM_3500_FIELDS } from "./form-3500-fields";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.join(__dirname, "..", "..", "scripts", "form-3500-fields.json");

describe("scripts/form-3500-fields.json", () => {
  it("matches FORM_3500_FIELDS exactly", () => {
    if (process.env.UPDATE_FORM_3500_FIELDS_JSON) {
      writeFileSync(JSON_PATH, `${JSON.stringify(FORM_3500_FIELDS, null, 2)}\n`);
    }
    const onDisk = JSON.parse(readFileSync(JSON_PATH, "utf-8"));
    expect(onDisk).toEqual(FORM_3500_FIELDS);
  });
});
