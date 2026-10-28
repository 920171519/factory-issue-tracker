import { getDb } from "@/lib/db";
import type { ProjectAccess } from "@/lib/access";

export interface IssueGroupContext {
  issueGroupId: string;
  groupId: string;
  groupName: string;
  pinnedUserId: string | null;
  handlerIds: string[];
  primaryHandlerId: string | null;
}

export interface IssueContext {
  id: string;
  barcodeId: string;
  projectId: string;
  statusId: string;
  groupIds: string[];
  groups: IssueGroupContext[];
  handlerIds: string[];
}

export interface IssuePermissions {
  canUpdateStatus: boolean;
  canEditContent: boolean;
  canTransfer: boolean;
  canIntraTransferGroupIds: string[];
  canCrossTransfer: boolean;
  canForceTransfer: boolean;
}

export interface BarcodePermissions {
  canUpdateAllStatuses: boolean;
  canTransferAll: boolean;
  canDelete: boolean;
  canEditTracking: boolean;
  canAddIssue: boolean;
  canForceTransfer: boolean;
}

export function loadIssueContexts(issueIds: string[]): Map<string, IssueContext> {
  const result = new Map<string, IssueContext>();
  if (issueIds.length === 0) return result;
  const db = getDb();
  const placeholders = issueIds.map(() => "?").join(",");
  const issues = db
    .prepare(`SELECT id, barcode_id, project_id, status_id FROM issues WHERE id IN (${placeholders})`)
    .all(...issueIds) as { id: string; barcode_id: string; project_id: string; status_id: string }[];
  const groups = db
    .prepare(
      `SELECT ig.id AS issue_group_id, ig.issue_id, ig.group_id, ig.pinned_user_id, g.name AS group_name
       FROM issue_groups ig JOIN groups g ON g.id = ig.group_id
       WHERE ig.issue_id IN (${placeholders})
       ORDER BY g.name`,
    )
    .all(...issueIds) as {
    issue_group_id: string;
    issue_id: string;
    group_id: string;
    pinned_user_id: string | null;
    group_name: string;
  }[];
  const handlers = db
    .prepare(
      `SELECT h.issue_group_id, h.user_id, h.is_primary
       FROM issue_group_handlers h
       JOIN issue_groups ig ON ig.id = h.issue_group_id
       WHERE ig.issue_id IN (${placeholders})
       ORDER BY h.is_primary DESC, h.user_id`,
    )
    .all(...issueIds) as { issue_group_id: string; user_id: string; is_primary: number }[];
  const handlersByGroup = new Map<string, { user_id: string; is_primary: number }[]>();
  for (const handler of handlers) {
    const list = handlersByGroup.get(handler.issue_group_id) || [];
    list.push(handler);
    handlersByGroup.set(handler.issue_group_id, list);
  }
  const groupsByIssue = new Map<string, IssueGroupContext[]>();
  for (const group of groups) {
    const groupHandlers = handlersByGroup.get(group.issue_group_id) || [];
    const context: IssueGroupContext = {
      issueGroupId: group.issue_group_id,
      groupId: group.group_id,
      groupName: group.group_name,
      pinnedUserId: group.pinned_user_id,
      handlerIds: groupHandlers.map((h) => h.user_id),
      primaryHandlerId: groupHandlers.find((h) => h.is_primary === 1)?.user_id || null,
    };
    const list = groupsByIssue.get(group.issue_id) || [];
    list.push(context);
    groupsByIssue.set(group.issue_id, list);
  }
  for (const issue of issues) {
    const issueGroups = groupsByIssue.get(issue.id) || [];
    result.set(issue.id, {
      id: issue.id,
      barcodeId: issue.barcode_id,
      projectId: issue.project_id,
      statusId: issue.status_id,
      groupIds: issueGroups.map((g) => g.groupId),
      groups: issueGroups,
      handlerIds: [...new Set(issueGroups.flatMap((g) => g.handlerIds))],
    });
  }
  return result;
}

export function loadSingleIssueContext(issueId: string): IssueContext | null {
  return loadIssueContexts([issueId]).get(issueId) || null;
}

export function loadBarcodeIssueContexts(barcodeId: string, projectId: string): IssueContext[] {
  const rows = getDb()
    .prepare("SELECT id FROM issues WHERE barcode_id = ? AND project_id = ? ORDER BY created_at, id")
    .all(barcodeId, projectId) as { id: string }[];
  return rows.map((row) => loadSingleIssueContext(row.id)).filter((ctx): ctx is IssueContext => Boolean(ctx));
}

export function isCurrentHandler(context: IssueContext, userId: string): boolean {
  return context.handlerIds.includes(userId);
}

export function isParticipatingLeader(context: IssueContext, access: ProjectAccess): boolean {
  return access.leaderGroupIds.some((groupId) => context.groupIds.includes(groupId));
}

export function isParticipatingGroupMember(context: IssueContext, access: ProjectAccess): boolean {
  return access.groupIds.some((groupId) => context.groupIds.includes(groupId));
}

export function permissionsForIssue(
  context: IssueContext,
  access: ProjectAccess,
  userId: string,
): IssuePermissions {
  const force = access.isPm || access.isSupervisor;
  const handler = isCurrentHandler(context, userId);
  const participatingLeader = isParticipatingLeader(context, access);
  const canUpdateStatus = force || handler || participatingLeader;
  const canEditContent = force || handler || isParticipatingGroupMember(context, access);
  const canIntraTransferGroupIds = context.groups
    .filter((group) => {
      if (force) return true;
      if (!context.groupIds.includes(group.groupId)) return false;
      const leader = access.leaderGroupIds.includes(group.groupId);
      const groupHandler = group.handlerIds.includes(userId);
      return leader || groupHandler;
    })
    .map((group) => group.groupId);
  const canTransfer = force || handler || participatingLeader;
  return {
    canUpdateStatus,
    canEditContent,
    canTransfer,
    canIntraTransferGroupIds,
    canCrossTransfer: canTransfer,
    canForceTransfer: force,
  };
}

export function permissionsForBarcode(
  contexts: IssueContext[],
  access: ProjectAccess,
  userId: string,
): BarcodePermissions {
  const issuePerms = contexts.map((context) => permissionsForIssue(context, access, userId));
  return {
    canUpdateAllStatuses: issuePerms.length > 0 && issuePerms.every((permission) => permission.canUpdateStatus),
    canTransferAll: issuePerms.length > 0 && issuePerms.every((permission) => permission.canTransfer),
    canDelete: true,
    canEditTracking: true,
    canAddIssue: issuePerms.length > 0 && issuePerms.every((permission) => permission.canEditContent),
    canForceTransfer: access.isPm || access.isSupervisor,
  };
}
