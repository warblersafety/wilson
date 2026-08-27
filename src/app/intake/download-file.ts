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

// How long the object URL lives, and why it is not `finally`.
//
// Clicking an <a download> QUEUES a task to fetch the URL; it does not
// read the blob synchronously. Revoking in the same task — which a
// try/finally does — can pull the blob out from under that queued fetch,
// and the clinician gets nothing or an empty file. Chrome tolerates it;
// WebKit and Gecko have not been relied on to. This file already carries
// one Safari workaround, and shipping a Safari-breaking revoke beside it
// would be a poor joke.
//
// So: revoke on a later task. Still short-lived — a clinician who
// exports repeatedly does not accumulate blobs for the page's lifetime —
// but never before the download that needs it has started. usePdfExport
// solves the same problem the other available way, by revoking in an
// effect cleanup; there is no component lifecycle here to hang that on.
//
// Nothing is written to storage and nothing leaves the browser
// (design.md's privacy posture).
const REVOKE_DELAY_MS = 60_000;

export function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([serializeJson(value)], { type: "application/json" }));
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
