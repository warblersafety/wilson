"use client";

// Issue #92's affordance, one component used by both closing surfaces —
// AC-2 asks Review for "the same 'download session data' affordance"
// Ready offers, and two hand-built copies of it is how the two quietly
// come to differ.
//
// Deliberately thin: everything it renders comes from
// SESSION_EXPORT_COPY, and everything it builds comes from
// session-export.ts's pure builders. The component's own contribution is
// two buttons and the click.
import { bundleFilename, buildSessionBundle, recordFilename, SESSION_EXPORT_COPY, sessionRecord } from "@/lib/session-export";
import type { TalkSession } from "@/lib/talk";
import { downloadJson } from "./download-file";

interface SessionDownloadsProps {
  session: TalkSession;
}

export function SessionDownloads({ session }: SessionDownloadsProps) {
  // Stamped at the click, not at render: a report left open overnight
  // should export with the date it was exported, not the date the
  // surface first mounted.
  const downloadRecord = () => {
    const now = new Date();
    downloadJson(sessionRecord(session, now), recordFilename(now));
  };
  const downloadBundle = () => {
    const now = new Date();
    downloadJson(buildSessionBundle(session, now), bundleFilename(now));
  };

  return (
    <section className="session-downloads" aria-labelledby="session-downloads-heading">
      <h2 id="session-downloads-heading" className="session-downloads__heading">
        {SESSION_EXPORT_COPY.heading}
      </h2>
      <p className="session-downloads__hint">{SESSION_EXPORT_COPY.hint}</p>
      <div className="session-downloads__actions">
        <button type="button" onClick={downloadRecord}>
          {SESSION_EXPORT_COPY.recordCta}
        </button>
        <button type="button" onClick={downloadBundle}>
          {SESSION_EXPORT_COPY.bundleCta}
        </button>
      </div>
    </section>
  );
}
