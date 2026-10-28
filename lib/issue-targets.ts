import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";

export interface SelectedIssue {
  id: string;
  barcode_id: string;
  barcode: string;
  location_no: string;
  project_id: string;
  status_id: string;
  error_item: string;
}

export function resolveIssueSelection(
  projectId: string,
  selection: { issueId?: string; barcodeId?: string; barcodeIds?: string[] },
): SelectedIssue[] {
  const db = getDb();
  if (selection.issueId) {
    const row = db
      .prepare(
        `SELECT i.id, i.barcode_id, b.barcode, b.location_no, i.project_id, i.status_id, i.error_item
         FROM issues i JOIN barcodes b ON b.id = i.barcode_id
         WHERE i.id = ? AND i.project_id = ?`,
      )
      .get(selection.issueId, projectId) as SelectedIssue | undefined;
    if (!row) throw new AppError(404, "问题不存在或不属于当前项目");
    return [row];
  }
  if (selection.barcodeId) {
    return resolveIssueSelection(projectId, { barcodeIds: [selection.barcodeId] });
  }
  const barcodeIds = [...new Set(selection.barcodeIds || [])];
  if (barcodeIds.length === 0) throw new AppError(400, "请选择要操作的条码");
  if (barcodeIds.length > 500) throw new AppError(400, "单次最多操作 500 个条码");
  const placeholders = barcodeIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT i.id, i.barcode_id, b.barcode, b.location_no, i.project_id, i.status_id, i.error_item
       FROM issues i JOIN barcodes b ON b.id = i.barcode_id
       WHERE b.project_id = ? AND b.id IN (${placeholders})
       ORDER BY b.barcode, i.created_at`,
    )
    .all(projectId, ...barcodeIds) as SelectedIssue[];
  if (rows.length === 0) throw new AppError(404, "所选条码不存在");
  const foundBarcodeIds = new Set(rows.map((row) => row.barcode_id));
  if (foundBarcodeIds.size !== barcodeIds.length) throw new AppError(400, "所选条码中存在不属于当前项目的条码");
  return rows;
}

export function uniqueBarcodeIds(issues: SelectedIssue[]): string[] {
  return [...new Set(issues.map((issue) => issue.barcode_id))];
}
