"use client";

// The browser half of Issue #92's export: turning a value the clinician
// already holds into a file on their disk, with no server in the path.
//
// Split from the pure builders in src/lib/session-export.ts for the
// reason src/lib is typechecked without the DOM lib (tsconfig.node.json):
// nothing here can be reached by a lib test, so nothing here is allowed
// to make a decision. It creates a blob, clicks a link, and revokes —
// what to export and what to call it are lib's, and tested there.
import { serializeJson } from "@/lib/session-export";

// The anchor dance, in one place. The WebKit workaround is the reason it
// is a function rather than three inline lines: some Safari versions only
// honor a click on an <a download> that is actually attached to the
// document, and that fact was previously known only inside
// use-pdf-export.ts, where a second caller would not have found it.
export function triggerDownload(url: string, filename: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Client-side only, and short-lived: the object URL is revoked as soon as
// the click is handed off, so a clinician who exports repeatedly does not
// accumulate blobs for the page's lifetime. Nothing is written to
// storage and nothing leaves the browser (design.md's privacy posture).
export function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([serializeJson(value)], { type: "application/json" }));
  try {
    triggerDownload(url, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}
