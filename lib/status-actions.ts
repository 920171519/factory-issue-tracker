import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireProjectAccess } from "@/lib/access";
import { loadIssueContexts, permissionsForIssue } from "@/lib/issue-access";
import { resolveIssueSelection, uniqueBarcodeIds } from "@/lib/issue-targets";
import { assertStatusBelongsToProject, requireReasonIfNeeded } from "@/lib/issues";
import { hasRichText, sanitizeRichText } from "@/lib/sanitize";
import { recordStatusHistory } from "@/lib/history";
import { sendNotifications } from "@/lib/notifications";

interface StatusUpdateInput {
  projectId: string;
  userId: string;
  issueIds: string[];
  statusId: string;
  reasonHtml?: string;
  confirmed: boolean;
  scopeLabel?: string;
}

export interface StatusUpdateResult {
  updatedIssues: number;
  skippedIssues: number;
  barcodeIds: string[];
  notifiedRecipients: number;
}

export function updateIssueStatuses(input: StatusUpdateInput): StatusUpdateResult {
  if (!input.confirmed) throw new AppError(400, "操作需要二次确认");
  const access = requireProjectAccess(input.userId, input.projectId);
  const db = getDb();
  const issueIds = [...new Set(input.issueIds)];
  if (issueIds.length === 0) throw new AppError(400, "请选择要更新状态的问题");
  const placeholders = issueIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT i.id, i.barcode_id, b.barcode, i.project_id, i.status_id, i.error_item
       FROM issues i JOIN barcodes b ON b.id = i.barcode_id
       WHERE i.project_id = ? AND i.id IN (${placeholders})`,
    )
    .all(input.projectId, ...issueIds) as {
    id: string;
    barcode_id: string;
    barcode: string;
    project_id: string;
    status_id: string;
    error_item: string;
  }[];
  if (rows.length !== issueIds.length) throw new AppError(400, "部分问题不存在或不属于当前项目");
  const status = assertStatusBelongsToProject(input.projectId, input.statusId);
  const reasonHtml = sanitizeRichText(input.reasonHtml || "");

  const contexts = loadIssueContexts(issueIds);
  for (const issue of rows) {
    const context = contexts.get(issue.id);
    if (!context) throw new AppError(409, "问题责任数据异常");
    if (!permissionsForIssue(context, access, input.userId).canUpdateStatus) {
      throw new AppError(403, "你没有权限修改所选问题中的部分问题状态（仅当前处理人或相关责任组负责人可修改）");
    }
  }

  const changes = rows.filter((row) => row.status_id !== status.id);
  if (changes.length === 0) throw new AppError(400, "所选问题已经是该状态，无需更新");
  requireReasonIfNeeded(status, reasonHtml);

  const changedIds = changes.map((row) => row.id);
  const changedContexts = loadIssueContexts(changedIds);
  const now = new Date();
  const timestamp = now.toISOString();
  const recipientSet = new Set<string>();
  for (const issueId of changedIds) {
    const context = changedContexts.get(issueId);
    if (context) for (const userId of context.handlerIds) recipientSet.add(userId);
  }
  const operator = db.prepare("SELECT id, name FROM users WHERE id = ?").get(input.userId) as { id: string; name: string } | undefined;
  if (!operator) throw new AppError(401, "登录已失效");
  const project = db
    .prepare("SELECT notify_self_on_status FROM projects WHERE id = ?")
    .get(input.projectId) as { notify_self_on_status: number };
  if (project.notify_self_on_status === 0) recipientSet.delete(input.userId);

  db.transaction(() => {
    const update = db.prepare("UPDATE issues SET status_id = ?, updated_at = ? WHERE id = ?");
    const touchBarcode = db.prepare("UPDATE barcodes SET updated_at = ? WHERE id = ?");
    for (const issue of changes) {
      update.run(status.id, timestamp, issue.id);
      recordStatusHistory({
        issueId: issue.id,
        oldStatusId: issue.status_id,
        newStatusId: status.id,
        reasonHtml,
        operatorId: input.userId,
        createdAt: timestamp,
      });
      touchBarcode.run(timestamp, issue.barcode_id);
    }
  })();

  const barcodeIds = [...new Set(changes.map((issue) => issue.barcode_id))];
  const recipients = [...recipientSet];
  let notified = 0;
  if (recipients.length > 0) {
    const detail = barcodeIds.length > 1
      ? `你参与的 ${barcodeIds.length} 个条码（${changes.length} 个报错项）状态已更新为「${status.name}」。`
      : `条码「${changes[0].barcode}」的状态已更新为「${status.name}」。`;
    notified = sendNotifications({
      projectId: input.projectId,
      recipientIds: recipients,
      title: barcodeIds.length > 1 ? "批量状态更新通知" : "问题状态更新通知",
      body: `${detail}操作人：${operator.name}。${hasRichText(reasonHtml) ? "定位原因已记录到问题历史。" : ""}`,
      barcodeIds,
    });
  }
  return {
    updatedIssues: changes.length,
    skippedIssues: rows.length - changes.length,
    barcodeIds,
    notifiedRecipients: notified,
  };
}

/** Update all issues under a barcode or a multi-barcode selection. */
export function updateStatusForSelection(input: {
  projectId: string;
  userId: string;
  selection: { barcodeId?: string; barcodeIds?: string[]; issueId?: string };
  statusId: string;
  reasonHtml?: string;
  confirmed: boolean;
}): StatusUpdateResult {
  requireProjectAccess(input.userId, input.projectId);
  const issues = resolveIssueSelection(input.projectId, input.selection);
  return updateIssueStatuses({
    projectId: input.projectId,
    userId: input.userId,
    issueIds: issues.map((issue) => issue.id),
    statusId: input.statusId,
    reasonHtml: input.reasonHtml,
    confirmed: input.confirmed,
  });
}