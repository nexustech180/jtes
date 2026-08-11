import StatusBadge, { type StatusTone } from "./StatusBadge";

// PSP-10: Not Started, In Progress, Waiting for Client, Under Review,
// Completed, On Hold.
export type MilestoneState =
  | "Not Started"
  | "In Progress"
  | "Waiting for Client"
  | "Under Review"
  | "Completed"
  | "On Hold";

const stateTone: Record<MilestoneState, StatusTone> = {
  "Not Started": "neutral",
  "In Progress": "info",
  "Waiting for Client": "warning",
  "Under Review": "warning",
  Completed: "success",
  "On Hold": "danger",
};

export type Milestone = {
  id: string;
  title: string;
  state: MilestoneState;
  date?: string;
};

export default function MilestoneTimeline({ milestones }: { milestones: Milestone[] }) {
  return (
    <ol className="relative border-l border-surface-border pl-6">
      {milestones.map((milestone) => (
        <li key={milestone.id} className="mb-6 last:mb-0">
          <span
            className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-brand-blue"
            aria-hidden
          />
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-brand-dark">{milestone.title}</p>
            <StatusBadge label={milestone.state} tone={stateTone[milestone.state]} />
          </div>
          {milestone.date && (
            <p className="mt-1 text-xs text-ink-muted">{milestone.date}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
