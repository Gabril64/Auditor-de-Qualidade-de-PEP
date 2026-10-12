export type ApprovalStatus = "approved" | "approved_before_edit" | "pending";

export interface ApprovalEvent {
  action: string;
  user_id: number;
  user_name: string;
  revision_version: string | null;
}

export interface ApprovalState {
  status: ApprovalStatus;
  approved_by: string[];
  approved_before_edit_by: string[];
  approvedUserIds: number[];
}

/** Derives who approved the current version from the history, person by person: a person counts
 * when their last approval event is an approve, and it saw the version that exists now. */
export function approvalStateOf(events: ApprovalEvent[], currentVersion: string | null): ApprovalState {
  const lastByUser = new Map<number, ApprovalEvent>();
  for (const event of events) lastByUser.set(event.user_id, event);

  const current: ApprovalEvent[] = [];
  const older: ApprovalEvent[] = [];
  for (const event of lastByUser.values()) {
    if (event.action !== "approve") continue;
    (event.revision_version === currentVersion ? current : older).push(event);
  }

  return {
    status: current.length > 0 ? "approved" : older.length > 0 ? "approved_before_edit" : "pending",
    approved_by: current.map((event) => event.user_name),
    approved_before_edit_by: older.map((event) => event.user_name),
    approvedUserIds: current.map((event) => event.user_id),
  };
}
