import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getProjectPmIds, requireProjectAccess, requireProjectManager } from "@/lib/access";
import { hasRichText, sanitizeRichText } from "@/lib/sanitize";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { sendNotifications } from "@/lib/notifications";

export interface DeletionRequestSummary {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requester: string;
  requesterId: string;
  reviewer: string | null;
  reviewReasonHtml: string;
  createdAt: string;
  reviewedAt: string | null;
  barcodes: { barcodeId: string | null; barcode: string; locationNo: string | null }[];
}

export interface DeletionResult {
  deleted: { id: string; barcode: string }[];
  reviewRequired: { id: string; barcode: string }[];
  requestId: string | null;
}

export function barcodeNeedsDeletionReview(barcodeId: string): boolean {
  const db = getDb();
  const issueIds = db.prepare("SELECT id FROM issues WHERE barcode_id = ?").all(barcodeId) as { id: string }[];
  if (issueIds.length === 0) return false;
  const ids = issueIds.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const transfer = db
    .prepare(
      `SELECT 1 FROM assignment_history
       WHERE issue_id IN (${placeholders}) AND change_type <> 'ENTRY' LIMIT 1`,
    )
    .get(...ids);
  if (transfer) return true;
  const reasons = db
    .prepare(`SELECT reason_html FROM status_history WHERE issue_id IN (${placeholders}) AND reason_html <> ''`)
    .all(...ids) as { reason_html: string }[];
  return reasons.some((row) => hasRichText(row.reason_html));
}

export function requestBarcodeDeletion(
  projectId: string,
  userId: string,
  barcodeIds: string[],
): DeletionResult {
  requireProjectAccess(userId, projectId);
  const db = getDb();
  const unique = [...new Set(barcodeIds)];
  if (unique.length === 0) throw new AppError(400, "请选择要删除的条码");
  if (unique.length > 500) throw new AppError(400, "单次最多删除 500 个条码");
  const placeholders = unique.map(() => "?").join(",");
  const barcodes = db
    .prepare(`SELECT id, barcode, location_no FROM barcodes WHERE project_id = ? AND id IN (${placeholders})`)
    .all(projectId, ...unique) as { id: string; barcode: string; location_no: string }[];
  if (barcodes.length !== unique.length) throw new AppError(400, "部分条码不存在或不属于当前项目");

  const pending = db
    .prepare(
      `SELECT DISTINCT drb.barcode_id FROM delete_request_barcodes drb
       JOIN delete_requests dr ON dr.id = drb.request_id
       WHERE dr.project_id = ? AND dr.status = 'PENDING' AND drb.barcode_id IN (${placeholders})`,
    )
    .all(projectId, ...unique) as { barcode_id: string }[];
  if (pending.length > 0) {
    const affected = barcodes.filter((row) => pending.some((item) => item.barcode_id === row.id));
    throw new AppError(409, `以下条码已有待审批的删除申请：${affected.map((row) => row.barcode).join("、")}`);
  }

  const needReview = barcodes.filter((row) => barcodeNeedsDeletionReview(row.id));
  const immediate = barcodes.filter((row) => !needReview.some((review) => review.id === row.id));
  const now = nowIso();
  let requestId: string | null = null;

  db.transaction(() => {
    const deleteBarcode = db.prepare("DELETE FROM barcodes WHERE id = ? AND project_id = ?");
    for (const barcode of immediate) deleteBarcode.run(barcode.id, projectId);
    if (needReview.length > 0) {
      requestId = newId("dlr");
      db.prepare(
        `INSERT INTO delete_requests (id, project_id, requested_by, status, created_at)
         VALUES (?, ?, ?, 'PENDING', ?)`,
      ).run(requestId, projectId, userId, now);
      const insertBarcode = db.prepare(
        `INSERT INTO delete_request_barcodes (id, request_id, barcode_id, barcode, location_no, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const barcode of needReview) {
        insertBarcode.run(newId("drb"), requestId, barcode.id, barcode.barcode, barcode.location_no, now);
      }
    }
  })();

  if (requestId) {
    const pmIds = getProjectPmIds(projectId);
    const requester = db.prepare("SELECT name FROM users WHERE id = ?").get(userId) as { name: string };
    sendNotifications({
      projectId,
      recipientIds: pmIds,
      title: "删除审批待处理",
      body: `${requester.name} 发起了 ${needReview.length} 个条码的删除申请，请前往审批中心处理。`,
      barcodeIds: needReview.map((row) => row.id),
    });
  }

  return {
    deleted: immediate.map((row) => ({ id: row.id, barcode: row.barcode })),
    reviewRequired: needReview.map((row) => ({ id: row.id, barcode: row.barcode })),
    requestId,
  };
}

export function reviewDeletionRequest(
  projectId: string,
  requestId: string,
  reviewerId: string,
  action: "APPROVE" | "REJECT",
  reasonHtml = "",
): { status: "APPROVED" | "REJECTED"; deletedCount: number } {
  requireProjectManager(reviewerId, projectId);
  const db = getDb();
  const request = db
    .prepare("SELECT * FROM delete_requests WHERE id = ? AND project_id = ?")
    .get(requestId, projectId) as
    | { id: string; project_id: string; requested_by: string; status: string; created_at: string }
    | undefined;
  if (!request) throw new AppError(404, "审批记录不存在");
  if (request.status !== "PENDING") throw new AppError(409, "该审批已处理，不能重复操作");
  const reviewReason = sanitizeRichText(reasonHtml);
  const now = nowIso();
  let deletedCount = 0;

  db.transaction(() => {
    if (action === "APPROVE") {
      const barcodes = db
        .prepare("SELECT barcode_id FROM delete_request_barcodes WHERE request_id = ?")
        .all(requestId) as { barcode_id: string | null }[];
      const del = db.prepare("DELETE FROM barcodes WHERE id = ? AND project_id = ?");
      for (const row of barcodes) {
        if (row.barcode_id) {
          const result = del.run(row.barcode_id, projectId);
          deletedCount += result.changes;
        }
      }
    }
    db.prepare(
      `UPDATE delete_requests SET status = ?, reviewed_by = ?, review_reason_html = ?, reviewed_at = ?
       WHERE id = ? AND status = 'PENDING'`,
    ).run(action === "APPROVE" ? "APPROVED" : "REJECTED", reviewerId, reviewReason, now, requestId);
  })();

  if (action === "REJECT") {
    const barcodeNames = db
      .prepare("SELECT barcode_id, barcode FROM delete_request_barcodes WHERE request_id = ?")
      .all(requestId) as { barcode_id: string | null; barcode: string }[];
    sendNotifications({
      projectId,
      recipientIds: [request.requested_by],
      title: "删除审批被驳回",
      body: `你的删除申请（${barcodeNames.map((row) => row.barcode).join("、")}）已被驳回。${hasRichText(reviewReason) ? "请查看审批意见。" : ""}`,
      barcodeIds: barcodeNames.map((row) => row.barcode_id).filter((id): id is string => Boolean(id)),
    });
  }
  return { status: action === "APPROVE" ? "APPROVED" : "REJECTED", deletedCount };
}

export function listDeletionRequests(projectId: string, status?: string): DeletionRequestSummary[] {
  const db = getDb();
  const validStatus = status === "PENDING" || status === "APPROVED" || status === "REJECTED" ? status : null;
  const rows = db
    .prepare(
      `SELECT dr.*, requester.name AS requester_name, reviewer.name AS reviewer_name
       FROM delete_requests dr
       JOIN users requester ON requester.id = dr.requested_by
       LEFT JOIN users reviewer ON reviewer.id = dr.reviewed_by
       WHERE dr.project_id = ? ${validStatus ? "AND dr.status = ?" : ""}
       ORDER BY CASE dr.status WHEN 'PENDING' THEN 0 ELSE 1 END, dr.created_at DESC`,
    )
    .all(...(validStatus ? [projectId, validStatus] : [projectId])) as {
    id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    requested_by: string;
    requester_name: string;
    reviewed_by: string | null;
    reviewer_name: string | null;
    review_reason_html: string;
    created_at: string;
    reviewed_at: string | null;
  }[];
  if (rows.length === 0) return [];
  const requestIds = rows.map((row) => row.id);
  const placeholders = requestIds.map(() => "?").join(",");
  const barcodes = db
    .prepare(
      `SELECT request_id, barcode_id, barcode, location_no FROM delete_request_barcodes
       WHERE request_id IN (${placeholders}) ORDER BY barcode`,
    )
    .all(...requestIds) as { request_id: string; barcode_id: string | null; barcode: string; location_no: string | null }[];
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    requester: row.requester_name,
    requesterId: row.requested_by,
    reviewer: row.reviewer_name,
    reviewReasonHtml: row.review_reason_html,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    barcodes: barcodes
      .filter((barcode) => barcode.request_id === row.id)
      .map((barcode) => ({ barcodeId: barcode.barcode_id, barcode: barcode.barcode, locationNo: barcode.location_no })),
  }));
}

export function pendingDeletionCount(projectId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM delete_requests WHERE project_id = ? AND status = 'PENDING'")
    .get(projectId) as { count: number };
  return row.count;
}