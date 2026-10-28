import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { sanitizeRichText } from "@/lib/sanitize";

export type AssignmentChangeType =
  | "ENTRY"
  | "INTRA_GROUP"
  | "CROSS_GROUP"
  | "SHIFT_HANDOFF"
  | "FALLBACK"
  | "FORCED";

export interface EntityRef {
  id: string;
  name: string;
}

export interface AssignmentHistoryInput {
  issueId: string;
  changeType: AssignmentChangeType;
  operatorId: string | null;
  fromGroups: EntityRef[];
  toGroups: EntityRef[];
  retainedGroups?: EntityRef[];
  fromHandlers: EntityRef[];
  toHandlers: EntityRef[];
  reasonHtml?: string;
  meta?: Record<string, unknown>;
  createdAt?: string;
}

export function recordAssignmentHistory(input: AssignmentHistoryInput): string {
  const id = newId("ash");
  getDb()
    .prepare(
      `INSERT INTO assignment_history
        (id, issue_id, change_type, operator_id, from_group_ids, to_group_ids, retained_group_ids,
         from_handler_ids, to_handler_ids, reason_html, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.issueId,
      input.changeType,
      input.operatorId,
      JSON.stringify(input.fromGroups.map((g) => g.id)),
      JSON.stringify(input.toGroups.map((g) => g.id)),
      JSON.stringify((input.retainedGroups || []).map((g) => g.id)),
      JSON.stringify(input.fromHandlers.map((h) => h.id)),
      JSON.stringify(input.toHandlers.map((h) => h.id)),
      sanitizeRichText(input.reasonHtml || ""),
      JSON.stringify({
        ...(input.meta || {}),
        fromGroupNames: input.fromGroups.map((group) => group.name),
        toGroupNames: input.toGroups.map((group) => group.name),
        retainedGroupNames: (input.retainedGroups || []).map((group) => group.name),
        fromHandlerNames: input.fromHandlers.map((handler) => handler.name),
        toHandlerNames: input.toHandlers.map((handler) => handler.name),
      }),
      input.createdAt || nowIso(),
    );
  return id;
}

export function recordAnomaly(input: {
  projectId: string;
  issueId: string;
  groupId: string | null;
  kind: string;
  message: string;
  createdAt?: string;
}): string {
  const id = newId("anm");
  getDb()
    .prepare(
      `INSERT INTO anomalies (id, project_id, issue_id, group_id, kind, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.projectId, input.issueId, input.groupId, input.kind, input.message, input.createdAt || nowIso());
  return id;
}

export interface StatusHistoryInput {
  issueId: string;
  oldStatusId: string | null;
  newStatusId: string;
  reasonHtml?: string;
  operatorId: string;
  createdAt?: string;
}

export function recordStatusHistory(input: StatusHistoryInput): string {
  const id = newId("sth");
  getDb()
    .prepare(
      `INSERT INTO status_history (id, issue_id, old_status_id, new_status_id, reason_html, operator_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.issueId,
      input.oldStatusId,
      input.newStatusId,
      sanitizeRichText(input.reasonHtml || ""),
      input.operatorId,
      input.createdAt || nowIso(),
    );
  return id;
}