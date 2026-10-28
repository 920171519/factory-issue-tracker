import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { sanitizeRichText, richTextToPlain, truncateText } from "@/lib/sanitize";

export interface NotificationInput {
  projectId: string | null;
  recipientIds: string[];
  title: string;
  body: string;
  barcodeIds?: string[];
}

export interface NotificationRow {
  id: string;
  project_id: string | null;
  project_name?: string | null;
  recipient_id: string;
  title: string;
  body: string;
  channel: string;
  status: string;
  barcode_ids: string;
  created_at: string;
  read_at: string | null;
}

export function sendNotifications(input: NotificationInput): number {
  const recipientIds = [...new Set(input.recipientIds)].filter(Boolean);
  if (recipientIds.length === 0) return 0;
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO notifications
      (id, project_id, recipient_id, title, body, channel, status, barcode_ids, created_at)
     VALUES (?, ?, ?, ?, ?, 'IN_APP', 'SENT', ?, ?)`,
  );
  const at = nowIso();
  const barcodeIds = JSON.stringify([...new Set(input.barcodeIds || [])]);
  const transaction = db.transaction(() => {
    for (const recipientId of recipientIds) {
      insert.run(newId("ntf"), input.projectId, recipientId, input.title, sanitizeRichText(input.body), barcodeIds, at);
    }
  });
  transaction();
  return recipientIds.length;
}

export function issueHandlerIds(issueId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT h.user_id
       FROM issue_groups ig JOIN issue_group_handlers h ON h.issue_group_id = ig.id
       WHERE ig.issue_id = ?`,
    )
    .all(issueId) as { user_id: string }[];
  return rows.map((row) => row.user_id);
}

export function barcodeHandlerIds(barcodeId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT h.user_id
       FROM issues i
       JOIN issue_groups ig ON ig.issue_id = i.id
       JOIN issue_group_handlers h ON h.issue_group_id = ig.id
       WHERE i.barcode_id = ?`,
    )
    .all(barcodeId) as { user_id: string }[];
  return rows.map((row) => row.user_id);
}

export function listNotifications(userId: string, limit = 100): NotificationRow[] {
  return getDb()
    .prepare(
      `SELECT n.*, p.name AS project_name
       FROM notifications n LEFT JOIN projects p ON p.id = n.project_id
       WHERE n.recipient_id = ? ORDER BY n.created_at DESC LIMIT ?`,
    )
    .all(userId, limit) as NotificationRow[];
}

export function unreadNotificationCount(userId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND read_at IS NULL")
    .get(userId) as { count: number };
  return row.count;
}

export function markNotificationsRead(userId: string, options: { ids?: string[]; all?: boolean }): void {
  const db = getDb();
  const at = nowIso();
  if (options.all) {
    db.prepare("UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL").run(at, userId);
    return;
  }
  const ids = [...new Set(options.ids || [])].slice(0, 500);
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND id IN (${placeholders})`).run(at, userId, ...ids);
}

export function notificationPlainPreview(body: string): string {
  return truncateText(richTextToPlain(body), 100);
}
