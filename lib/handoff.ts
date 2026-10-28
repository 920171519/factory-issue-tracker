import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { findActiveSlot, momentForNow, resolveGroupAt, setIssueGroupHandlers } from "@/lib/schedule";
import { loadIssueContexts } from "@/lib/issue-access";
import { recordAnomaly, recordAssignmentHistory } from "@/lib/history";
import { sendNotifications } from "@/lib/notifications";
import { formatDateTime, getLocalParts } from "@/lib/time";

export interface HandoffResult {
  checkedGroups: number;
  initializedGroups: number;
  handedOffGroups: number;
  handedOffIssues: number;
  notified: number;
  errors: string[];
}

let running = false;

interface GroupRow {
  id: string;
  project_id: string;
  name: string;
  last_handoff_key: string | null;
}

function userNames(ids: string[]): Map<string, string> {
  const result = new Map<string, string>();
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT id, name FROM users WHERE id IN (${placeholders})`)
    .all(...ids) as { id: string; name: string }[];
  for (const row of rows) result.set(row.id, row.name);
  return result;
}

/**
 * Runs a handoff check for every enabled responsibility group. A group's
 * current shift key is persisted so repeated ticks inside one shift never
 * reassign manually transferred issues.
 */
export function runShiftHandoff(now: Date = new Date()): HandoffResult {
  const result: HandoffResult = {
    checkedGroups: 0,
    initializedGroups: 0,
    handedOffGroups: 0,
    handedOffIssues: 0,
    notified: 0,
    errors: [],
  };
  if (running) return result;
  running = true;
  try {
    const db = getDb();
    const moment = momentForNow(now);
    const groups = db
      .prepare("SELECT id, project_id, name, last_handoff_key FROM groups ORDER BY project_id, name")
      .all() as GroupRow[];
    const notificationItems = new Map<string, { projectId: string; recipientId: string; barcodes: Set<string> }>();

    for (const group of groups) {
      result.checkedGroups += 1;
      try {
        const active = findActiveSlot(group.project_id, moment);
        const currentKey = active ? `${active.anchorDate}|${active.slot.id}` : `${moment.date}|none`;
        if (!group.last_handoff_key) {
          db.prepare("UPDATE groups SET last_handoff_key = ?, last_handoff_at = ? WHERE id = ?").run(
            currentKey,
            now.toISOString(),
            group.id,
          );
          result.initializedGroups += 1;
          continue;
        }
        if (group.last_handoff_key === currentKey) continue;
        if (!active) {
          // Between configured shifts: keep current handlers until a new shift starts.
          db.prepare("UPDATE groups SET last_handoff_key = ?, last_handoff_at = ? WHERE id = ?").run(
            currentKey,
            now.toISOString(),
            group.id,
          );
          continue;
        }

        const resolution = resolveGroupAt(group.id, moment);
        const issueGroups = db
          .prepare(
            `SELECT ig.id, ig.issue_id, ig.pinned_user_id, i.barcode_id
             FROM issue_groups ig JOIN issues i ON i.id = ig.issue_id
             WHERE ig.group_id = ? ORDER BY i.created_at`,
          )
          .all(group.id) as { id: string; issue_id: string; pinned_user_id: string | null; barcode_id: string }[];

        const timestamp = now.toISOString();
        let groupIssues = 0;
        const recipientSet = new Set<string>();
        const affectedBarcodes = new Set<string>();
        const tx = db.transaction(() => {
          const touchIssue = db.prepare("UPDATE issues SET updated_at = ? WHERE id = ?");
          const touchBarcode = db.prepare("UPDATE barcodes SET updated_at = ? WHERE id = ?");
          for (const issueGroup of issueGroups) {
            const before = loadIssueContexts([issueGroup.issue_id]).get(issueGroup.issue_id);
            if (!before) continue;
            const beforeGroup = before.groups.find((item) => item.groupId === group.id);
            if (!beforeGroup) continue;
            const pinnedUserId = issueGroup.pinned_user_id;
            const pinnedStillScheduled =
              Boolean(pinnedUserId) &&
              resolution.source !== "FALLBACK" &&
              resolution.handlerIds.includes(pinnedUserId as string);
            const effectiveHandlers = pinnedStillScheduled
              ? [pinnedUserId as string]
              : resolution.handlerIds;
            const pinnedAfterHandoff = pinnedStillScheduled ? pinnedUserId : null;
            const fromHandlerIds = beforeGroup.handlerIds;
            const fromNames = userNames(fromHandlerIds);

            setIssueGroupHandlers(db, issueGroup.id, effectiveHandlers, timestamp, pinnedAfterHandoff);
            touchIssue.run(timestamp, issueGroup.issue_id);
            touchBarcode.run(timestamp, issueGroup.barcode_id);

            const after = loadIssueContexts([issueGroup.issue_id]).get(issueGroup.issue_id);
            if (!after) continue;
            const afterGroup = after.groups.find((item) => item.groupId === group.id);
            const toHandlerIds = afterGroup?.handlerIds || [];
            const toNames = userNames(toHandlerIds);
            const anomalyMessages: string[] = [];
            if (resolution.source === "FALLBACK") {
              const message = `责任组「${group.name}」进入新班次时排班缺失（${resolution.fallbackReason || "无排班"}），已兜底分配`;
              anomalyMessages.push(message);
              recordAnomaly({
                projectId: group.project_id,
                issueId: issueGroup.issue_id,
                groupId: group.id,
                kind: "SCHEDULE_MISSING",
                message,
                createdAt: timestamp,
              });
            }
            const shiftLabel = active ? `${active.anchorDate} ${active.slot.name}` : "新班次";
            recordAssignmentHistory({
              issueId: issueGroup.issue_id,
              changeType: "SHIFT_HANDOFF",
              operatorId: null,
              fromGroups: [{ id: group.id, name: group.name }],
              toGroups: [{ id: group.id, name: group.name }],
              retainedGroups: [{ id: group.id, name: group.name }],
              fromHandlers: fromHandlerIds.map((id) => ({ id, name: fromNames.get(id) || id })),
              toHandlers: toHandlerIds.map((id) => ({ id, name: toNames.get(id) || id })),
              reasonHtml: pinnedStillScheduled
                ? `${shiftLabel}班次交接：新排班仍包含组内转交指定处理人，保留当前处理人。`
                : `${shiftLabel}班次交接：系统按新班次排班自动解析处理人。`,
              meta: {
                shiftKey: currentKey,
                shiftLabel,
                pinnedRetained: pinnedStillScheduled,
                fallback: resolution.source === "FALLBACK",
                anomalies: anomalyMessages,
                fromGroupNames: [group.name],
                toGroupNames: [group.name],
                retainedGroupNames: [group.name],
                fromHandlerNames: fromHandlerIds.map((id) => fromNames.get(id) || id),
                toHandlerNames: toHandlerIds.map((id) => toNames.get(id) || id),
              },
              createdAt: timestamp,
            });
            for (const handlerId of effectiveHandlers) recipientSet.add(handlerId);
            affectedBarcodes.add(issueGroup.barcode_id);
            groupIssues += 1;
          }
          db.prepare("UPDATE groups SET last_handoff_key = ?, last_handoff_at = ? WHERE id = ?").run(
            currentKey,
            timestamp,
            group.id,
          );
        });
        tx();

        if (groupIssues > 0) {
          result.handedOffGroups += 1;
          result.handedOffIssues += groupIssues;
          for (const recipientId of recipientSet) {
            const key = `${group.project_id}::${recipientId}`;
            const item = notificationItems.get(key) || {
              projectId: group.project_id,
              recipientId,
              barcodes: new Set<string>(),
            };
            for (const barcodeId of affectedBarcodes) item.barcodes.add(barcodeId);
            notificationItems.set(key, item);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`责任组 ${group.name}: ${message}`);
      }
    }

    for (const item of notificationItems.values()) {
      result.notified += sendNotifications({
        projectId: item.projectId,
        recipientIds: [item.recipientId],
        title: "班次交接提醒",
        body: `新班次已开始，${item.barcodes.size} 个条码的相关问题已交接至当前排班处理人，请及时跟进。`,
        barcodeIds: [...item.barcodes],
      });
    }
    return result;
  } finally {
    running = false;
  }
}

export function handoffNowDescription(now: Date = new Date()): string {
  const parts = getLocalParts(now);
  return `${formatDateTime(now)}（${parts.date} 第 ${parts.minutes} 分钟）`;
}

/** Initializes missing handoff keys so the next real shift transition is detected. */
export function initializeHandoffKeys(now: Date = new Date()): number {
  const db = getDb();
  const groups = db.prepare("SELECT id, project_id, last_handoff_key FROM groups").all() as {
    id: string;
    project_id: string;
    last_handoff_key: string | null;
  }[];
  const moment = momentForNow(now);
  let count = 0;
  for (const group of groups) {
    if (group.last_handoff_key) continue;
    const active = findActiveSlot(group.project_id, moment);
    const key = active ? `${active.anchorDate}|${active.slot.id}` : `${moment.date}|none`;
    db.prepare("UPDATE groups SET last_handoff_key = ?, last_handoff_at = ? WHERE id = ?").run(key, now.toISOString(), group.id);
    count += 1;
  }
  return count;
}

/** Exposed for tests that need a hard failure fallback check. */
export function resolveHandoffForGroupAt(groupId: string, now: Date) {
  const resolution = resolveGroupAt(groupId, momentForNow(now));
  if (!resolution.handlerIds.length) throw new AppError(409, "无处理人");
  return resolution;
}
