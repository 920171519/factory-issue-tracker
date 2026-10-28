import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { getDb } from "@/lib/db";
import { createBarcode, addErrorIssue, getBarcodeDetail, getProjectStatuses, getProjectCategories } from "@/lib/issues";
import { updateIssueStatuses } from "@/lib/status-actions";
import { transferResponsibility } from "@/lib/assignments";
import { requestBarcodeDeletion, reviewDeletionRequest, listDeletionRequests } from "@/lib/deletion";
import { importIssuesFromExcel, buildImportTemplate } from "@/lib/import";
import { getHighFrequencyStats, getProjectHomeStats } from "@/lib/stats";
import { createCategory } from "@/lib/taxonomy";
import { deleteGroup, addSchedule, removeGroupMember, getGroupDetails, addGroupMember } from "@/lib/groups";
import { runShiftHandoff } from "@/lib/handoff";
import { listTimeSlots } from "@/lib/schedule";
import { sendNotifications, markNotificationsRead, unreadNotificationCount } from "@/lib/notifications";
import { createWorld, makeTestEnv, notificationCount, type TestEnv, type TestWorld } from "./helpers";
import { todayLocal } from "@/lib/time";

let env: TestEnv;
let w: TestWorld;
beforeEach(() => { env = makeTestEnv(); w = createWorld(); });
afterEach(() => { env.cleanup(); });

const testNow = new Date("2026-09-07T01:00:00Z");

function entry(barcode: string, groupIds: string[] = [w.cpuGroupId]) {
  return createBarcode(w.projectId, w.tester, {
    barcode, locationNo: "A-01", groupIds, priority: "MEDIUM", remark: "测试",
  }, { now: testNow });
}

describe("删除审批", () => {
  it("无历史立即删除，有历史合并为待审批并在通过时实际删除", () => {
    const plain = entry("DEL-PLAIN");
    const immediate = requestBarcodeDeletion(w.projectId, w.tester, [plain.barcodeId]);
    expect(immediate.deleted).toHaveLength(1);
    expect(immediate.requestId).toBeNull();
    expect(() => getBarcodeDetail(w.projectId, plain.barcodeId, w.pm)).toThrow();

    const processed = entry("DEL-PROCESSED");
    const issueId = getBarcodeDetail(w.projectId, processed.barcodeId, w.tester).issues[0].id;
    const identified = getProjectStatuses(w.projectId).find((status) => status.name === "已定位")!;
    updateIssueStatuses({
      projectId: w.projectId, userId: w.cpuLeader, issueIds: [issueId], statusId: identified.id,
      reasonHtml: "<p>已定位，需保留追溯</p>", confirmed: true,
    });
    const request = requestBarcodeDeletion(w.projectId, w.tester, [processed.barcodeId]);
    expect(request.deleted).toHaveLength(0);
    expect(request.requestId).toBeTruthy();
    expect(getBarcodeDetail(w.projectId, processed.barcodeId, w.pm).barcode).toBe("DEL-PROCESSED");
    const pending = listDeletionRequests(w.projectId, "PENDING");
    expect(pending).toHaveLength(1);
    expect(pending[0].barcodes.map((barcode) => barcode.barcode)).toEqual(["DEL-PROCESSED"]);

    const requestNotices = getDb()
      .prepare("SELECT recipient_id FROM notifications WHERE title = '删除审批待处理'")
      .all() as { recipient_id: string }[];
    expect(requestNotices.some((row) => row.recipient_id === w.pm)).toBe(true);
    expect(requestNotices.some((row) => row.recipient_id === w.supervisor)).toBe(false);

    expect(() => reviewDeletionRequest(w.projectId, request.requestId!, w.supervisor, "APPROVE")).toThrow(/项目 PM/);
    const approved = reviewDeletionRequest(w.projectId, request.requestId!, w.pm, "APPROVE");
    expect(approved.deletedCount).toBe(1);
    expect(() => getBarcodeDetail(w.projectId, processed.barcodeId, w.pm)).toThrow();
    const historyAfter = listDeletionRequests(w.projectId);
    expect(historyAfter[0].status).toBe("APPROVED");
    expect(historyAfter[0].barcodes[0].barcode).toBe("DEL-PROCESSED");
  });

  it("驳回时保留条码并通知发起人，多选只生成一条审核记录", () => {
    const first = entry("DEL-MULTI-1");
    const second = entry("DEL-MULTI-2");
    const firstIssue = getBarcodeDetail(w.projectId, first.barcodeId, w.tester).issues[0].id;
    const identified = getProjectStatuses(w.projectId).find((item) => item.name === "已定位")!;
    updateIssueStatuses({
      projectId: w.projectId, userId: w.cpuLeader, issueIds: [firstIssue], statusId: identified.id,
      reasonHtml: "<p>已完成定位</p>", confirmed: true,
    });
    const issue = getBarcodeDetail(w.projectId, second.barcodeId, w.tester).issues[0].id;
    const status = getProjectStatuses(w.projectId).find((item) => item.name === "挂起")!;
    updateIssueStatuses({
      projectId: w.projectId, userId: w.cpuLeader, issueIds: [issue], statusId: status.id,
      reasonHtml: "<p>等待备件，先挂起</p>", confirmed: true,
    });
    const result = requestBarcodeDeletion(w.projectId, w.tester, [first.barcodeId, second.barcodeId]);
    expect(result.requestId).toBeTruthy();
    expect(result.reviewRequired).toHaveLength(2);
    const pending = listDeletionRequests(w.projectId, "PENDING");
    expect(pending).toHaveLength(1);
    expect(pending[0].barcodes).toHaveLength(2);

    const beforeRequester = notificationCount(w.tester);
    reviewDeletionRequest(w.projectId, result.requestId!, w.pm, "REJECT", "<p>请补充现场信息后再删除</p>");
    expect(notificationCount(w.tester)).toBe(beforeRequester + 1);
    const rejectNotice = getDb().prepare("SELECT title, body FROM notifications WHERE recipient_id = ? AND title = '删除审批被驳回'").get(w.tester) as { title: string; body: string };
    expect(rejectNotice.body).toContain("驳回");
    expect(getBarcodeDetail(w.projectId, first.barcodeId, w.pm).barcode).toBe("DEL-MULTI-1");
    expect(getBarcodeDetail(w.projectId, second.barcodeId, w.pm).barcode).toBe("DEL-MULTI-2");
    expect(listDeletionRequests(w.projectId, "REJECTED")).toHaveLength(1);
  });
});

describe("Excel 批量导入", () => {
  it("按参与责任组解析处理人、按责任人合并通知，并逐行报告错误", () => {
    createCategory(w.projectId, w.pm, { name: "导入分类", color: "#334155" });
    const headers = ["条码", "库位号", "参与责任组", "问题分类", "优先级", "备注"];
    const rows = [
      ["IMP-001", "A-01", "CPU 组", "导入分类", "高", "第一行"],
      ["IMP-002", "A-02", "", "", "中", "使用默认责任组"],
      ["IMP-003", "A-03", "风扇组", "", "低", "第二组"],
      ["IMP-004", "A-04", "不存在的组", "", "中", "应失败"],
    ];
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "问题导入");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const result = importIssuesFromExcel(w.projectId, w.tester, buffer);
    expect(result.imported).toBe(3);
    expect(result.failed).toBe(1);
    expect(result.errors[0].row).toBe(5);
    expect(result.notifiedRecipients).toBeGreaterThan(0);
    const titles = getDb().prepare("SELECT title, COUNT(*) AS count FROM notifications GROUP BY title").all() as { title: string; count: number }[];
    const directNotices = titles.find((item) => item.title === "批量导入问题分配");
    expect(directNotices).toBeTruthy();
    // 同一个处理人只收到一条合并通知
    const recipientCounts = getDb()
      .prepare("SELECT recipient_id, COUNT(*) AS count FROM notifications WHERE title = '批量导入问题分配' GROUP BY recipient_id")
      .all() as { recipient_id: string; count: number }[];
    expect(recipientCounts.every((row) => row.count === 1)).toBe(true);

    const detail = getBarcodeDetail(w.projectId, result.barcodeIds[0], w.tester);
    expect(detail.category?.name).toBe("导入分类");
    expect(detail.priority).toBe("HIGH");
    expect(detail.issues[0].groups[0].handlers.length).toBeGreaterThan(0);
    const defaulted = listBarcodesLocal("IMP-002");
    expect(defaulted).toBe(true);

    const template = buildImportTemplate(w.projectId);
    const parsed = XLSX.read(template, { type: "buffer" });
    expect(parsed.SheetNames).toContain("问题导入");
    expect(parsed.SheetNames).toContain("填写说明");
  });

  function listBarcodesLocal(barcode: string): boolean {
    const row = getDb().prepare("SELECT 1 FROM barcodes WHERE project_id = ? AND barcode = ?").get(w.projectId, barcode);
    return Boolean(row);
  }
});

describe("统计与配置", () => {
  it("主页与高频报错统计按责任组、分类、时间段正确聚合", () => {
    const category = createCategory(w.projectId, w.pm, { name: "CPU 分类", color: "#2563eb" }).id;
    const created = createBarcode(w.projectId, w.tester, {
      barcode: "STAT-001", locationNo: "A-01", groupIds: [w.cpuGroupId],
      categoryId: category, priority: "HIGH", remark: "统计样例",
    }, { now: testNow });
    addErrorIssue(w.projectId, created.barcodeId, w.cpuLeader, { errorItem: "温度超过阈值" });
    addErrorIssue(w.projectId, created.barcodeId, w.cpuLeader, { errorItem: "温度超过阈值" });
    const second = createBarcode(w.projectId, w.tester, {
      barcode: "STAT-002", locationNo: "A-02", groupIds: [w.fanGroupId], priority: "LOW",
    }, { now: testNow });
    addErrorIssue(w.projectId, second.barcodeId, w.fanLeader, { errorItem: "转速波动" });

    const initialIssue = getBarcodeDetail(w.projectId, created.barcodeId, w.tester).issues[0].id;
    const identified = getProjectStatuses(w.projectId).find((status) => status.name === "已定位")!;
    updateIssueStatuses({
      projectId: w.projectId, userId: w.cpuLeader, issueIds: [initialIssue], statusId: identified.id,
      reasonHtml: "<p>定位完成</p>", confirmed: true,
    });

    const today = todayLocal();
    const stats = getHighFrequencyStats(w.projectId, w.tester, {
      startDate: today, endDate: today, groupId: w.cpuGroupId, categoryId: category,
    });
    expect(stats.totalOccurrences).toBe(2);
    expect(stats.items[0].errorItem).toBe("温度超过阈值");
    expect(stats.items[0].count).toBe(2);
    expect(stats.items[0].barcodeCount).toBe(1);
    expect(stats.timeline.find((point) => point.date === today)?.count).toBe(2);

    const single = getHighFrequencyStats(w.projectId, w.tester, {
      startDate: today, endDate: today, errorItem: "转速波动",
    });
    expect(single.totalOccurrences).toBe(1);
    expect(single.timeline.find((point) => point.date === today)?.count).toBe(1);

    const home = getProjectHomeStats(w.projectId, w.tester);
    expect(home.groups.find((group) => group.id === w.cpuGroupId)?.total).toBe(3);
    expect(home.categories.find((item) => item.id === category)?.total).toBe(3);
    expect(home.identified).toBe(1);
    expect(home.issueCount).toBe(5);
    expect(home.pendingApprovals).toBe(0);
  });

  it("成员变更会重新解析当前处理人，最后一名负责人与有问题的责任组不能被删除", () => {
    const created = entry("GRP-MEMBER-1");
    const detailBefore = getBarcodeDetail(w.projectId, created.barcodeId, w.tester);
    expect(detailBefore.issues[0].groups[0].handlers.some((handler) => handler.id === w.cpuMember)).toBe(true);

    expect(() => removeGroupMember(w.projectId, w.cpuGroupId, w.cpuLeader, w.cpuLeader)).toThrow(/最后一名负责人/);
    const result = removeGroupMember(w.projectId, w.cpuGroupId, w.cpuLeader, w.cpuMember);
    expect(result.reassignedIssues).toBeGreaterThanOrEqual(0);
    const detailAfter = getBarcodeDetail(w.projectId, created.barcodeId, w.tester);
    expect(detailAfter.issues[0].groups[0].handlers.some((handler) => handler.id === w.cpuMember)).toBe(false);
    const details = getGroupDetails(w.projectId, w.cpuGroupId, w.cpuLeader);
    expect(details.members.some((member) => member.userId === w.cpuMember)).toBe(false);

    expect(() => deleteGroup(w.projectId, w.cpuGroupId, w.pm)).toThrow(/仍参与/);
  });

  it("班次切换到无排班班次时兜底并记录异常", () => {
    const night = listTimeSlots(w.projectId).find((slot) => slot.name === "夜班")!;
    getDb().prepare("UPDATE groups SET last_handoff_key = NULL").run();
    runShiftHandoff(testNow);
    const created = entry("HANDOFF-FALLBACK");
    getDb().prepare("DELETE FROM schedules WHERE group_id = ? AND slot_id = ?").run(w.cpuGroupId, night.id);
    const beforeAnomalies = (getDb().prepare("SELECT COUNT(*) AS count FROM anomalies WHERE project_id = ?").get(w.projectId) as { count: number }).count;
    const result = runShiftHandoff(new Date("2026-09-07T13:00:00Z"));
    expect(result.handedOffGroups).toBeGreaterThan(0);
    const after = getBarcodeDetail(w.projectId, created.barcodeId, w.tester);
    const handlers = after.issues[0].groups[0].handlers.map((handler) => handler.id);
    expect(handlers).toContain(w.pm);
    expect(handlers).toContain(w.cpuLeader);
    const afterAnomalies = (getDb().prepare("SELECT COUNT(*) AS count FROM anomalies WHERE project_id = ?").get(w.projectId) as { count: number }).count;
    expect(afterAnomalies).toBeGreaterThan(beforeAnomalies);
    const history = after.issues[0].assignmentHistory.at(-1)!;
    expect(history.changeType).toBe("SHIFT_HANDOFF");
    expect(history.anomalies.length).toBeGreaterThan(0);
  });

  it("通知只记录发送日志且支持已读状态", () => {
    const count = sendNotifications({ projectId: w.projectId, recipientIds: [w.pm, w.pm], title: "测试日志", body: "基础发送日志", barcodeIds: [] });
    expect(count).toBe(1);
    const row = getDb().prepare("SELECT * FROM notifications WHERE title = '测试日志'").get() as Record<string, unknown>;
    expect(row.channel).toBe("IN_APP");
    expect(row.status).toBe("SENT");
    const before = unreadNotificationCount(w.pm);
    markNotificationsRead(w.pm, { ids: [String(row.id)] });
    expect(unreadNotificationCount(w.pm)).toBe(before - 1);
  });
});