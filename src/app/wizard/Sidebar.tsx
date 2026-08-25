// Lists all 34 topics grouped by the form's 7 sections (Issue #32),
// status derived from topicStatuses() — the same shared helper the
// sidebar and any future consumer both read from, never a second
// done/current/upcoming computation.
import { FORM_3500_SECTIONS, type FormSection } from "@/lib/form-3500-fields";
import { topicStatuses, type TopicStatusEntry } from "@/lib/topics";
import type { TalkSession } from "@/lib/talk";

const SECTION_ORDER = Object.keys(FORM_3500_SECTIONS) as FormSection[];

interface SidebarProps {
  session: TalkSession;
}

export function Sidebar({ session }: SidebarProps) {
  const statuses = topicStatuses(session.record, session.repeatCounts);
  const bySection = new Map<FormSection, TopicStatusEntry[]>();
  for (const entry of statuses) {
    const list = bySection.get(entry.topic.section) ?? [];
    list.push(entry);
    bySection.set(entry.topic.section, list);
  }

  return (
    <nav className="sidebar" aria-label="Report progress">
      {SECTION_ORDER.map((section) => {
        const entries = bySection.get(section);
        if (!entries || entries.length === 0) return null;
        return (
          <div key={section} className="sidebar__section">
            <h2 className="sidebar__section-title">
              {section}. {FORM_3500_SECTIONS[section]}
            </h2>
            <ul>
              {entries.map(({ topic, status }) => (
                <li key={topic.id} className={`sidebar__topic sidebar__topic--${status}`}>
                  {topic.label}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
