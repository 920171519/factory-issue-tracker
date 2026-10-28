import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { requireProjectAccess, type ProjectAccess } from "@/lib/access";
import {
  loadIssueContexts,
  permissionsForIssue,
  type IssueContext,
} from "@/lib/issue-access";
import { resolveIssueSelection, type SelectedIssue } from "@/lib/issue-targets";
import {
  momentForNow,
  resolveGroupAt,
  setIssueGroupHandlers,
  type GroupResolution,
} from "@/lib/schedule";
import { richTextToPlain, sanitizeRichText } from "@/lib/sanitize";
import { recordAnomaly, recordAssignmentHistory, type AssignmentChangeType, type EntityRef } from "@/lib/history";
import { sendNotifications } from "@/lib/notifications";

export interface TransferSelection {
  issueId?: string;
  barcodeId?: string;
  barcodeIds?: string[];
}

export interface TransferRequest {
  projectId: string;
  userId: string;
  selection: TransferSelection;
  mode: "INTRA" | "CROSS";
  reasonHtml: string;
  groupId?: string;
  targetUserId?: string;
  targetGroupIds?: string[];
  retainedGroupIds?: string[];
}

export interface TransferResult {
  transferredIssues: number;
  transferredBarcodes: number;
  recipientIds: string[];
  notifiedRecipients: number;
}

function userRefs(userIds: string[]): EntityRef[] {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT id, name FROM users WHERE id IN (${placeholders}) ORDER BY name`)
    .all(...unique) as EntityRef[];
  return rows;
}

function groupRefsFromContexts(contexts: IssueContext[]): EntityRef[] {
  const map = new Map<string, EntityRef>();
  for (const context of contexts) {
    for (const group of context.groups) map.set(group.groupId, { id: group.groupId, name: group.groupName });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function groupRefs(groupIds: string[]): EntityRef[] {
  if (groupIds.length === 0) return [];
  const placeholders = groupIds.map(() => "?").join(",");
  return getDb()
    .prepare(`SELECT id, name FROM groups WHERE id IN (${placeholders}) ORDER BY name`)
    .all(...groupIds) as EntityRef[];
}

function assertPositiveReason(reasonHtml: string): string {
  const clean = sanitizeRichText(reasonHtml);
  if (!richTextToPlain(clean)) throw new AppError(400, "请填写当前定位结论或转移原因，可同时附带图片");
  return clean;
}

function isForcedForIntra(
  context: IssueContext,
  access: ProjectAccess,
  userId: string,
  groupId: string,
): boolean {
  const leader = access.leaderGroupIds.includes(groupId);
  const group = context.groups.find((item) => item.groupId === groupId);
  const handler = group?.handlerIds.includes(userId) || false;
  return (access.isPm || access.isSupervisor) && !leader && !handler;
}

function isForcedForCross(context: IssueContext, access: ProjectAccess, userId: string): boolean {
  const leader = access.leaderGroupIds.some((groupId) => context.groupIds.includes(groupId));
  const handler = context.handlerIds.includes(userId);
  return (access.isPm || access.isSupervisor) && !leader && !handler;
}

export function transferResponsibility(request: TransferRequest): TransferResult {
  const access = requireProjectAccess(request.userId, request.projectId);
  const reasonHtml = assertPositiveReason(request.reasonHtml);
  const issues = resolveIssueSelection(request.projectId, request.selection);
  if (issues.length === 0) throw new AppError(400, "没有可转移的问题");
  const issueIds = issues.map((issue) => issue.id);
  const contexts = loadIssueContexts(issueIds);
  const now = new Date();
  const timestamp = now.toISOString();
  const moment = momentForNow(now);
  const db = getDb();
  const recipients = new Set<string>();
  let transferredIssues = 0;

  if (request.mode === "INTRA") {
    const groupId = request.groupId;
    const targetUserId = request.targetUserId;
    if (!groupId) throw new AppError(400, "请选择要转交的责任组");
    if (!targetUserId) throw new AppError(400, "请选择本责任组的接收成员");
    const group = db
      .prepare("SELECT id, name, enabled, project_id FROM groups WHERE id = ? AND project_id = ?")
      .get(groupId, request.projectId) as { id: string; name: string; enabled: number; project_id: string } | undefined;
    if (!group) throw new AppError(400, "责任组不存在");
    if (group.enabled === 0) throw new AppError(400, "责任组已停用，不能执行转交");
    const targetMembership = db
      .prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
      .get(groupId, targetUserId);
    if (!targetMembership) throw new AppError(400, "目标成员不属于该责任组，组内转交只能选择本组成员");
    const targetUser = db.prepare("SELECT id, name FROM users WHERE id = ?").get(targetUserId) as { id: string; name: string } | undefined;
    if (!targetUser) throw new AppError(404, "目标成员不存在");

    for (const issue of issues) {
      const context = contexts.get(issue.id);
      if (!context) throw new AppError(409, "问题责任数据异常");
      const issueGroup = context.groups.find((item) => item.groupId === groupId);
      if (!issueGroup) {
        throw new AppError(400, `条码「${issue.barcode}」的问题未参与责任组「${group.name}」，不能对该组执行组内转交`);
      }
      const permission = permissionsForIssue(context, access, request.userId);
      if (!permission.canIntraTransferGroupIds.includes(groupId)) {
        throw new AppError(403, `你没有权限转交条码「${issue.barcode}」在责任组「${group.name}」中的处理人`);
      }
      if (issueGroup.handlerIds.length === 1 && issueGroup.handlerIds[0] === targetUserId) {
        throw new AppError(400, `目标成员已是条码「${issue.barcode}」在该组唯一的当前处理人`);
      }
    }

    const tx = db.transaction(() => {
      const touchBarcode = db.prepare("UPDATE barcodes SET updated_at = ? WHERE id = ?");
      for (const issue of issues) {
        const before = loadIssueContexts([issue.id]).get(issue.id);
        if (!before) throw new AppError(409, "问题责任数据异常");
        const issueGroup = before.groups.find((item) => item.groupId === groupId);
        if (!issueGroup) throw new AppError(409, "责任组数据发生变化，请重试");
        const forced = isForcedForIntra(before, access, request.userId, groupId);
        const fromGroups = groupRefsFromContexts([before]);
        const fromHandlers = userRefs(before.handlerIds);
        setIssueGroupHandlers(db, issueGroup.issueGroupId, [targetUserId], timestamp, targetUserId);
        db.prepare("UPDATE issues SET updated_at = ? WHERE id = ?").run(timestamp, issue.id);
        touchBarcode.run(timestamp, issue.barcode_id);
        const after = loadIssueContexts([issue.id]).get(issue.id);
        if (!after) throw new AppError(409, "问题责任数据异常");
        const toGroups = groupRefsFromContexts([after]);
        const toHandlers = userRefs(after.handlerIds);
        recordAssignmentHistory({
          issueId: issue.id,
          changeType: (forced ? "FORCED" : "INTRA_GROUP") as AssignmentChangeType,
          operatorId: request.userId,
          fromGroups,
          toGroups,
          retainedGroups: toGroups,
          fromHandlers,
          toHandlers,
          reasonHtml,
          meta: {
            mode: "INTRA",
            changedGroupId: groupId,
            changedGroupName: group.name,
            fromGroupNames: fromGroups.map((item) => item.name),
            toGroupNames: toGroups.map((item) => item.name),
            retainedGroupNames: toGroups.map((item) => item.name),
            fromHandlerNames: fromHandlers.map((item) => item.name),
            toHandlerNames: toHandlers.map((item) => item.name),
            targetUserName: targetUser.name,
          },
          createdAt: timestamp,
        });
        recipients.add(targetUserId);
        transferredIssues += 1;
      }
    });
    tx();
  } else {
    const targetGroupIds = [...new Set(request.targetGroupIds || [])];
    if (targetGroupIds.length === 0) throw new AppError(400, "请选择一个或多个目标责任组");
    if (targetGroupIds.length > 20) throw new AppError(400, "单次最多选择 20 个目标责任组");
    const placeholders = targetGroupIds.map(() => "?").join(",");
    const targetGroups = db
      .prepare(
        `SELECT id, name, enabled, project_id FROM groups
         WHERE project_id = ? AND id IN (${placeholders})`,
      )
      .all(request.projectId, ...targetGroupIds) as { id: string; name: string; enabled: number; project_id: string }[];
    if (targetGroups.length !== targetGroupIds.length) throw new AppError(400, "目标责任组包含不属于当前项目的责任组");
    if (targetGroups.some((group) => group.enabled === 0)) throw new AppError(400, "不能转接到已停用的责任组");
    const targetGroupMap = new Map(targetGroups.map((group) => [group.id, group]));
    const participatingGroupIds = new Set<string>();
    for (const issue of issues) {
      const context = contexts.get(issue.id);
      if (!context) throw new AppError(409, "问题责任数据异常");
      for (const groupId of context.groupIds) participatingGroupIds.add(groupId);
    }
    for (const targetId of targetGroupIds) {
      if (participatingGroupIds.has(targetId)) {
        throw new AppError(400, `责任组「${targetGroupMap.get(targetId)?.name}」已在所选问题中参与，无需重复转接；如需保留请勾选保留`);
      }
    }
    const retainedGroupIds = [...new Set(request.retainedGroupIds || [])];
    for (const groupId of retainedGroupIds) {
      if (!participatingGroupIds.has(groupId)) throw new AppError(400, "保留的责任组不在所选问题的当前参与责任组内");
    }

    const resolutionByGroup = new Map<string, GroupResolution>();
    for (const groupId of targetGroupIds) {
      resolutionByGroup.set(groupId, resolveGroupAt(groupId, moment));
    }

    for (const issue of issues) {
      const context = contexts.get(issue.id);
      if (!context) throw new AppError(409, "问题责任数据异常");
      const permission = permissionsForIssue(context, access, request.userId);
      if (!permission.canCrossTransfer) {
        throw new AppError(403, `你没有权限转接条码「${issue.barcode}」的责任组`);
      }
    }

    const tx = db.transaction(() => {
      const touchBarcode = db.prepare("UPDATE barcodes SET updated_at = ? WHERE id = ?");
      for (const issue of issues) {
        const before = loadIssueContexts([issue.id]).get(issue.id);
        if (!before) throw new AppError(409, "问题责任数据异常");
        const forced = isForcedForCross(before, access, request.userId);
        const fromGroups = groupRefsFromContexts([before]);
        const fromHandlers = userRefs(before.handlerIds);
        const retainedForIssue = before.groups.filter((group) => retainedGroupIds.includes(group.groupId));
        const retainedIds = retainedForIssue.map((group) => group.groupId);

        for (const group of before.groups) {
          if (!retainedIds.includes(group.groupId)) {
            db.prepare("DELETE FROM issue_groups WHERE issue_id = ? AND group_id = ?").run(issue.id, group.groupId);
          }
        }
        const anomalyMessages: string[] = [];
        for (const targetGroupId of targetGroupIds) {
          const targetGroup = targetGroupMap.get(targetGroupId)!;
          const resolution = resolutionByGroup.get(targetGroupId)!;
          const issueGroupId = newId("igr");
          db.prepare(
            "INSERT INTO issue_groups (id, issue_id, group_id, pinned_user_id, created_at) VALUES (?, ?, ?, NULL, ?)",
          ).run(issueGroupId, issue.id, targetGroupId, timestamp);
          setIssueGroupHandlers(db, issueGroupId, resolution.handlerIds, timestamp, null);
          for (const handlerId of resolution.handlerIds) recipients.add(handlerId);
          if (resolution.source === "FALLBACK") {
            const message = `责任组「${targetGroup.name}」${resolution.fallbackReason || "排班缺失"}，已兜底分配`;
            anomalyMessages.push(message);
            recordAnomaly({
              projectId: request.projectId,
              issueId: issue.id,
              groupId: targetGroupId,
              kind: "SCHEDULE_MISSING",
              message,
              createdAt: timestamp,
            });
          }
        }
        db.prepare("UPDATE issues SET updated_at = ? WHERE id = ?").run(timestamp, issue.id);
        touchBarcode.run(timestamp, issue.barcode_id);
        const after = loadIssueContexts([issue.id]).get(issue.id);
        if (!after) throw new AppError(409, "问题责任数据异常");
        const toGroups = groupRefsFromContexts([after]);
        const retainedRefs = groupRefs(retainedIds);
        const toHandlers = userRefs(after.handlerIds);
        recordAssignmentHistory({
          issueId: issue.id,
          changeType: (forced ? "FORCED" : "CROSS_GROUP") as AssignmentChangeType,
          operatorId: request.userId,
          fromGroups,
          toGroups,
          retainedGroups: retainedRefs,
          fromHandlers,
          toHandlers,
          reasonHtml,
          meta: {
            mode: "CROSS",
            targetGroupIds,
            targetGroupNames: targetGroups.map((group) => group.name),
            fromGroupNames: fromGroups.map((item) => item.name),
            toGroupNames: toGroups.map((item) => item.name),
            retainedGroupNames: retainedRefs.map((item) => item.name),
            fromHandlerNames: fromHandlers.map((item) => item.name),
            toHandlerNames: toHandlers.map((item) => item.name),
            anomalies: anomalyMessages,
          },
          createdAt: timestamp,
        });
        transferredIssues += 1;
      }
    });
    tx();
  }

  const recipientIds = [...recipients];
  if (recipientIds.length > 0) {
    const barcodeCount = new Set(issues.map((issue) => issue.barcode_id)).size;
    const title = request.mode === "INTRA" ? "组内转交通知" : "跨组转接通知";
    sendNotifications({
      projectId: request.projectId,
      recipientIds,
      title,
      body:
        request.mode === "INTRA"
          ? `${barcodeCount > 1 ? `${barcodeCount} 个条码的` : "条码"}问题已组内转交给你继续定位，请及时处理。`
          : `${barcodeCount > 1 ? `${barcodeCount} 个条码的` : "条码"}问题已跨组转接，你被解析为该责任组当前处理人，请及时跟进。`,
      barcodeIds: [...new Set(issues.map((issue) => issue.barcode_id))],
    });
  }
  return {
    transferredIssues,
    transferredBarcodes: new Set(issues.map((issue) => issue.barcode_id)).size,
    recipientIds,
    notifiedRecipients: recipientIds.length,
  };
}

/** Reassign every issue in a group that currently has the removed member as a handler. */
export function reassignGroupAssignmentsAfterMemberRemoval(
  projectId: string,
  groupId: string,
  removedUserId: string,
  operatorId: string | null,
): number {
  const db = getDb();
  const group = db
    .prepare("SELECT id, name, project_id FROM groups WHERE id = ? AND project_id = ?")
    .get(groupId, projectId) as { id: string; name: string; project_id: string } | undefined;
  if (!group) return 0;
  const issueGroups = db
    .prepare(
      `SELECT DISTINCT ig.id AS issue_group_id, ig.issue_id, i.barcode_id
       FROM issue_groups ig
       JOIN issue_group_handlers h ON h.issue_group_id = ig.id AND h.user_id = ?
       JOIN issues i ON i.id = ig.issue_id
       WHERE ig.group_id = ?`,
    )
    .all(removedUserId, groupId) as { issue_group_id: string; issue_id: string; barcode_id: string }[];
  if (issueGroups.length === 0) return 0;
  const now = new Date();
  const timestamp = now.toISOString();
  const moment = momentForNow(now);
  const resolution = resolveGroupAt(groupId, moment);
  const recipients = new Set<string>();
  const affectedBarcodes = new Set<string>();
  let reassigned = 0;
  const removedName = (() => {
    const row = db.prepare("SELECT name FROM users WHERE id = ?").get(removedUserId) as { name: string } | undefined;
    return row?.name || removedUserId;
  })();
  const anomalyMessages: string[] = [];
  if (resolution.source === "FALLBACK") {
    anomalyMessages.push(`排班缺失（${resolution.fallbackReason || "无排班"}），已兜底分配`);
  }

  db.transaction(() => {
    const touchIssue = db.prepare("UPDATE issues SET updated_at = ? WHERE id = ?");
    const touchBarcode = db.prepare("UPDATE barcodes SET updated_at = ? WHERE id = ?");
    for (const issueGroup of issueGroups) {
      const before = loadIssueContexts([issueGroup.issue_id]).get(issueGroup.issue_id);
      if (!before) continue;
      const beforeGroup = before.groups.find((item) => item.groupId === groupId);
      if (!beforeGroup) continue;
      const fromHandlers = userRefs(before.handlerIds);
      setIssueGroupHandlers(db, issueGroup.issue_group_id, resolution.handlerIds, timestamp, null);
      touchIssue.run(timestamp, issueGroup.issue_id);
      touchBarcode.run(timestamp, issueGroup.barcode_id);
      const after = loadIssueContexts([issueGroup.issue_id]).get(issueGroup.issue_id);
      if (!after) continue;
      const afterGroup = after.groups.find((item) => item.groupId === groupId);
      const toHandlerIds = afterGroup?.handlerIds || [];
      const toHandlers = userRefs(after.handlerIds);
      if (resolution.source === "FALLBACK") {
        recordAnomaly({
          projectId,
          issueId: issueGroup.issue_id,
          groupId,
          kind: "SCHEDULE_MISSING",
          message: `责任组「${group.name}」成员移出后重新解析，${resolution.fallbackReason || "排班缺失"}，已兜底分配`,
          createdAt: timestamp,
        });
      }
      recordAssignmentHistory({
        issueId: issueGroup.issue_id,
        changeType: "INTRA_GROUP",
        operatorId,
        fromGroups: [{ id: groupId, name: group.name }],
        toGroups: [{ id: groupId, name: group.name }],
        retainedGroups: [{ id: groupId, name: group.name }],
        fromHandlers,
        toHandlers,
        reasonHtml: `成员「${removedName}」移出责任组，系统按当前排班重新解析该组处理人`,
        meta: {
          reasonText: "MEMBER_REMOVED",
          fromGroupNames: [group.name],
          toGroupNames: [group.name],
          retainedGroupNames: [group.name],
          fromHandlerNames: fromHandlers.map((item) => item.name),
          toHandlerNames: toHandlers.map((item) => item.name),
          anomalies: anomalyMessages,
        },
        createdAt: timestamp,
      });
      for (const handlerId of toHandlerIds) recipients.add(handlerId);
      affectedBarcodes.add(issueGroup.barcode_id);
      reassigned += 1;
    }
  })();

  if (recipients.size > 0) {
    sendNotifications({
      projectId,
      recipientIds: [...recipients],
      title: "责任组成员变更提醒",
      body: `责任组「${group.name}」成员调整后，你被重新解析为该组相关问题的处理人，请及时跟进。`,
      barcodeIds: [...affectedBarcodes],
    });
  }
  return reassigned;
}