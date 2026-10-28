import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  addErrorIssue,
  createBarcode,
  getBarcodeDetail,
  getMyPendingInProject,
  getProjectStatuses,
  listBarcodes,
  updateErrorItem,
  updateTrackingGroups,
} from "@/lib/issues";
import { updateIssueStatuses } from "@/lib/status-actions";
import { transferResponsibility } from "@/lib/assignments";
import { runShiftHandoff } from "@/lib/handoff";
import { addGroupMember, addSchedule, createGroup } from "@/lib/groups";
import { addProjectMember } from "@/lib/projects";
import { getPendingCount, listTimeSlots, resolveGroupAt } from "@/lib/schedule";
import { listNotifications } from "@/lib/notifications";
import { sanitizeRichText } from "@/lib/sanitize";
import { createWorld, insertUser, makeTestEnv, notificationCount, type TestEnv, type TestWorld } from "./helpers";

let env: TestEnv;
let w: TestWorld;

beforeEach(() => {
  env = makeTestEnv();
  w = createWorld();
});
afterEach(() => { env.cleanup(); });

const testNow = new Date("2026-09-07T01:00:00Z"); // 周一 09:00 Asia/Shanghai
const testMoment = { date: "2026-09-07", weekday: 1, minutes: 9 * 60, at: testNow };

function createEntry(barcode: string, options: { groupIds?: string[]; categoryId?: string | null } = {}) {
  return createBarcode(w.projectId, w.tester, {
    barcode,
    locationNo: "A-01",
    groupIds: options.groupIds || [w.cpuGroupId],
    categoryId: options.categoryId || null,
    priority: "HIGH",
    remark: "自动化测试录入",
  }, { now: testNow });
}

describe("问题录入、状态与责任转移", () => {
  it("录入后按排班分配处理人、发通知，并支持报错项、跟踪群号与详情", () => {
    const created = createEntry("BAR-001");
    expect(created.recipientIds.length).toBe(2);
    expect(notificationCount()).toBe(2);

    const detail = getBarcodeDetail(w.projectId, created.barcodeId, w.tester);
    expect(detail.issues).toHaveLength(1);
    expect(detail.issues[0].groups[0].groupId).toBe(w.cpuGroupId);
    expect(new Set(detail.issues[0].groups[0].handlers.map((handler) => handler.id))).toEqual(new Set([w.cpuLeader, w.cpuMember]));
    expect(detail.issues[0].assignmentHistory[0].changeType).toBe("ENTRY");
    expect(detail.hostIp).toBeNull();

    // 组内成员追加报错项，继承当前责任配置
    const added = addErrorIssue(w.projectId, created.barcodeId, w.cpuLeader, { errorItem: "CPU 温度过高" });
    const withItem = getBarcodeDetail(w.projectId, created.barcodeId, w.tester);
    expect(withItem.issues).toHaveLength(2);
    expect(withItem.issues[1].errorItem).toBe("CPU 温度过高");
    expect(withItem.issues[1].groups[0].groupId).toBe(w.cpuGroupId);
    expect(withItem.issues[1].assignmentHistory[0].changeType).toBe("ENTRY");

    updateErrorItem(w.projectId, added.issueId, w.cpuLeader, "CPU 满载温度过高");
    expect(getBarcodeDetail(w.projectId, created.barcodeId, w.tester).issues[1].errorItem).toBe("CPU 满载温度过高");

    // 项目参与成员可编辑跟踪群号（可多个）
    updateTrackingGroups(w.projectId, created.barcodeId, w.tester, ["群 1001", "群 1002"]);
    expect(getBarcodeDetail(w.projectId, created.barcodeId, w.tester).trackingGroups).toEqual(["群 1001", "群 1002"]);

    const list = listBarcodes(w.projectId, w.tester, { search: "BAR-001" });
    expect(list.total).toBe(1);
    expect(list.rows[0].issue_count).toBe(2);
    expect(list.rows[0].groups[0].name).toBe("CPU 组");

    expect(() => getBarcodeDetail(w.projectId, created.barcodeId, w.outsider)).toThrow(/无权|不存在/);
  });

  it("状态更新要求二次确认与必填原因，并且不改变责任组或处理人", () => {
    const created = createEntry("BAR-002");
    const detail = getBarcodeDetail(w.projectId, created.barcodeId, w.tester);
    const issueId = detail.issues[0].id;
    const statuses = getProjectStatuses(w.projectId);
    const identified = statuses.find((status) => status.name === "已定位")!;

    expect(() => updateIssueStatuses({
      projectId: w.projectId, userId: w.cpuLeader, issueIds: [issueId], statusId: identified.id,
      reasonHtml: "", confirmed: false,
    })).toThrow(/二次确认/);
    expect(() => updateIssueStatuses({
      projectId: w.projectId, userId: w.cpuLeader, issueIds: [issueId], statusId: identified.id,
      reasonHtml: "", confirmed: true,
    })).toThrow(/必须填写定位原因/);
    expect(() => updateIssueStatuses({
      projectId: w.projectId, userId: w.tester, issueIds: [issueId], statusId: identified.id,
      reasonHtml: "<p>没有权限</p>", confirmed: true,
    })).toThrow(/权限/);

    const beforeGroupHandlers = getBarcodeDetail(w.projectId, created.barcodeId, w.tester).issues[0].groups[0].handlers.map((handler) => handler.id);
    const result = updateIssueStatuses({
      projectId: w.projectId, userId: w.cpuLeader, issueIds: [issueId], statusId: identified.id,
      reasonHtml: "<p>复现定位到 <strong>散热接触不良</strong></p><img src=\"/api/uploads/demo.png\" />",
      confirmed: true,
    });
    expect(result.updatedIssues).toBe(1);
    const updated = getBarcodeDetail(w.projectId, created.barcodeId, w.tester);
    expect(updated.issues[0].status.name).toBe("已定位");
    expect(updated.issues[0].groups[0].handlers.map((handler) => handler.id)).toEqual(beforeGroupHandlers);
    expect(updated.issues[0].statusHistory[0].newStatus).toBe("已定位");
    expect(updated.issues[0].statusHistory[0].reasonHtml).toContain("散热接触不良");
    expect(updated.issues[0].statusHistory[0].reasonHtml).toContain("<img");

    // 已定位不计入当前处理人的待处理数
    expect(getPendingCount(w.cpuLeader)).toBe(0);
    expect(getMyPendingInProject(w.cpuMember, w.projectId)).toBe(0);

    // 通知发送给所有当前处理人；操作人本身也接收（默认开启）
    const statusNotices = getDb()
      .prepare("SELECT recipient_id FROM notifications WHERE title LIKE '%状态更新%'")
      .all() as { recipient_id: string }[];
    expect(statusNotices.map((row) => row.recipient_id)).toContain(w.cpuLeader);
    expect(statusNotices.map((row) => row.recipient_id)).toContain(w.cpuMember);
  });

  it("项目配置关闭后，状态更新不再通知操作人本人", () => {
    getDb().prepare("UPDATE projects SET notify_self_on_status = 0 WHERE id = ?").run(w.projectId);
    const created = createEntry("BAR-003");
    const issueId = getBarcodeDetail(w.projectId, created.barcodeId, w.tester).issues[0].id;
    const pendingStatus = getProjectStatuses(w.projectId).find((status) => status.name === "待维修")!;
    const before = notificationCount(w.cpuLeader);
    updateIssueStatuses({
      projectId: w.projectId, userId: w.cpuLeader, issueIds: [issueId], statusId: pendingStatus.id,
      reasonHtml: "<p>转待维修</p>", confirmed: true,
    });
    const after = notificationCount(w.cpuLeader);
    // 操作人没有收到状态通知，但另一位参与处理人收到了
    expect(after).toBe(before);
    const notices = getDb().prepare("SELECT recipient_id FROM notifications WHERE title LIKE '%状态更新%' AND body LIKE '%待维修%'").all() as { recipient_id: string }[];
    expect(notices.some((row) => row.recipient_id === w.cpuLeader)).toBe(false);
    expect(notices.some((row) => row.recipient_id === w.cpuMember)).toBe(true);
  });

  it("组内转交只能选择本组成员，并写入转交历史与目标通知", () => {
    const newMember = insertUser("新成员", "CPU-T9");
    addProjectMember(w.projectId, w.pm, { userId: newMember });
    addGroupMember(w.projectId, w.cpuGroupId, w.pm, { userId: newMember });
    const created = createEntry("BAR-004");
    const issueId = getBarcodeDetail(w.projectId, created.barcodeId, w.tester).issues[0].id;
    const before = notificationCount(newMember);

    // 跨组个人不能作为组内转交目标
    expect(() => transferResponsibility({
      projectId: w.projectId, userId: w.cpuLeader, selection: { issueId },
      mode: "INTRA", groupId: w.cpuGroupId, targetUserId: w.repairLeader,
      reasonHtml: "<p>组内转交</p>",
    })).toThrow(/不属于该责任组/);

    const result = transferResponsibility({
      projectId: w.projectId, userId: w.cpuLeader, selection: { issueId },
      mode: "INTRA", groupId: w.cpuGroupId, targetUserId: newMember,
      reasonHtml: "<p>请新成员继续定位，结论：疑似供电纹波异常。</p>",
    });
    expect(result.transferredIssues).toBe(1);
    expect(notificationCount(newMember)).toBe(before + 1);
    const detail = getBarcodeDetail(w.projectId, created.barcodeId, w.tester);
    expect(detail.issues[0].groups[0].handlers.map((handler) => handler.id)).toEqual([newMember]);
    expect(detail.issues[0].groups[0].pinnedUserId).toBe(newMember);
    expect(detail.issues[0].groups[0].groupId).toBe(w.cpuGroupId);
    const history = detail.issues[0].assignmentHistory.at(-1)!;
    expect(history.changeType).toBe("INTRA_GROUP");
    expect(history.reasonHtml).toContain("供电纹波异常");
  });

  it("跨组转接只按目标组解析处理人，可保留原组，并记录强制历史", () => {
    const created = createEntry("BAR-005");
    const issueId = getBarcodeDetail(w.projectId, created.barcodeId, w.tester).issues[0].id;
    const before = notificationCount(w.repairLeader);
    // PM 不是当前处理人，系统记录为强制转交
    const result = transferResponsibility({
      projectId: w.projectId, userId: w.pm, selection: { barcodeId: created.barcodeId },
      mode: "CROSS", targetGroupIds: [w.repairGroupId], retainedGroupIds: [],
      reasonHtml: "<p>不属于 CPU 领域，转维修组检查连接器。</p>",
    });
    expect(result.transferredIssues).toBe(1);
    expect(notificationCount(w.repairLeader)).toBe(before + 1);
    const detail = getBarcodeDetail(w.projectId, created.barcodeId, w.tester);
    expect(detail.issues[0].groups.map((group) => group.groupId)).toEqual([w.repairGroupId]);
    expect(detail.issues[0].groups[0].handlers.map((handler) => handler.id)).toContain(w.repairLeader);
    expect(detail.issues[0].assignmentHistory.at(-1)?.changeType).toBe("FORCED");
    void issueId;

    // 保留原责任组再添加一个目标组
    const second = createEntry("BAR-006");
    transferResponsibility({
      projectId: w.projectId, userId: w.cpuLeader, selection: { barcodeId: second.barcodeId },
      mode: "CROSS", targetGroupIds: [w.fanGroupId], retainedGroupIds: [w.cpuGroupId],
      reasonHtml: "<p>CPU 与风扇联合定位。</p>",
    });
    const retained = getBarcodeDetail(w.projectId, second.barcodeId, w.tester);
    expect(new Set(retained.issues[0].groups.map((group) => group.groupId))).toEqual(new Set([w.cpuGroupId, w.fanGroupId]));
    // 需要 CPU 组完整参与才能对其整码做组内转交
    expect(() => transferResponsibility({
      projectId: w.projectId, userId: w.cpuLeader, selection: { barcodeId: second.barcodeId },
      mode: "INTRA", groupId: w.cpuGroupId, targetUserId: w.cpuMember,
      reasonHtml: "<p>组内转交</p>",
    })).not.toThrow();
  });

  it("目标组没有排班时兜底并记录异常，不阻塞转接", () => {
    const emptyLeader = insertUser("空组负责人", "EMPTY-T1");
    const emptyGroup = createGroup(w.projectId, w.pm, { name: "空组", leaderIds: [emptyLeader] });
    const created = createEntry("BAR-007");
    const result = transferResponsibility({
      projectId: w.projectId, userId: w.pm, selection: { barcodeId: created.barcodeId },
      mode: "CROSS", targetGroupIds: [emptyGroup.id], retainedGroupIds: [],
      reasonHtml: "<p>转空组</p>",
    });
    expect(result.transferredIssues).toBe(1);
    const detail = getBarcodeDetail(w.projectId, created.barcodeId, w.tester);
    const handlerIds = detail.issues[0].groups[0].handlers.map((handler) => handler.id);
    expect(handlerIds).toContain(emptyLeader);
    expect(handlerIds).toContain(w.pm);
    const anomalies = getDb().prepare("SELECT * FROM anomalies WHERE group_id = ?").all(emptyGroup.id);
    expect(anomalies.length).toBeGreaterThan(0);
  });

  it("班次交接不依赖状态，保留仍被排班的组内转交指定人", () => {
    const night = listTimeSlots(w.projectId).find((slot) => slot.name === "夜班")!;
    addSchedule(w.projectId, w.cpuGroupId, w.pm, {
      weekday: 1, slotId: night.id, userId: w.cpuMember, effectiveFrom: "2020-01-01", effectiveTo: null,
    });
    // 重置并初始化排班键
    getDb().prepare("UPDATE groups SET last_handoff_key = NULL").run();
    const init = runShiftHandoff(testNow);
    expect(init.initializedGroups).toBeGreaterThan(0);

    const pinned = createEntry("BAR-008");
    const normal = createEntry("BAR-009");
    const pinnedIssue = getBarcodeDetail(w.projectId, pinned.barcodeId, w.tester).issues[0].id;
    const normalIssue = getBarcodeDetail(w.projectId, normal.barcodeId, w.tester).issues[0].id;
    transferResponsibility({
      projectId: w.projectId, userId: w.cpuLeader, selection: { issueId: pinnedIssue },
      mode: "INTRA", groupId: w.cpuGroupId, targetUserId: w.cpuMember,
      reasonHtml: "<p>指定成员继续跟进</p>",
    });
    const identified = getProjectStatuses(w.projectId).find((status) => status.name === "已定位")!;
    updateIssueStatuses({
      projectId: w.projectId, userId: w.cpuLeader, issueIds: [normalIssue], statusId: identified.id,
      reasonHtml: "<p>已定位，但班次仍需交接</p>", confirmed: true,
    });
    const pinnedStatusBefore = getBarcodeDetail(w.projectId, normal.barcodeId, w.tester).issues[0].status.id;

    const handoff = runShiftHandoff(new Date("2026-09-07T13:00:00Z")); // 周一 21:00
    expect(handoff.handedOffGroups).toBeGreaterThan(0);

    const pinnedAfter = getBarcodeDetail(w.projectId, pinned.barcodeId, w.tester);
    expect(pinnedAfter.issues[0].groups[0].handlers.map((handler) => handler.id)).toEqual([w.cpuMember]);
    expect(pinnedAfter.issues[0].groups[0].pinnedUserId).toBe(w.cpuMember);
    expect(pinnedAfter.issues[0].assignmentHistory.some((history) => history.changeType === "SHIFT_HANDOFF")).toBe(true);

    const normalAfter = getBarcodeDetail(w.projectId, normal.barcodeId, w.tester);
    expect(normalAfter.issues[0].status.id).toBe(pinnedStatusBefore);
    expect(new Set(normalAfter.issues[0].groups[0].handlers.map((handler) => handler.id))).toEqual(new Set([w.cpuFallback, w.cpuMember]));
    expect(normalAfter.issues[0].assignmentHistory.some((history) => history.changeType === "SHIFT_HANDOFF")).toBe(true);
    const handoffNotices = getDb().prepare("SELECT * FROM notifications WHERE title = '班次交接提醒'").all();
    expect(handoffNotices.length).toBeGreaterThan(0);
    expect(listNotifications(w.cpuMember).length).toBeGreaterThan(0);
  });

  it("仅图片而没有文字的原因会被拒绝，批量状态更新按责任人合并通知", () => {
    const first = createEntry("BAR-MERGE-1");
    const second = createEntry("BAR-MERGE-2");
    const issueIds = [
      getBarcodeDetail(w.projectId, first.barcodeId, w.tester).issues[0].id,
      getBarcodeDetail(w.projectId, second.barcodeId, w.tester).issues[0].id,
    ];
    const identified = getProjectStatuses(w.projectId).find((status) => status.name === "已定位")!;
    expect(() => updateIssueStatuses({
      projectId: w.projectId, userId: w.cpuLeader, issueIds, statusId: identified.id,
      reasonHtml: '<img src="/api/uploads/only-image.png" />', confirmed: true,
    })).toThrow(/必须填写定位原因/);
    expect(() => transferResponsibility({
      projectId: w.projectId, userId: w.cpuLeader, selection: { issueId: issueIds[0] },
      mode: "INTRA", groupId: w.cpuGroupId, targetUserId: w.cpuMember,
      reasonHtml: '<img src="/api/uploads/only-image.png" />',
    })).toThrow(/请填写当前定位结论/);

    const leaderBefore = notificationCount(w.cpuLeader);
    const memberBefore = notificationCount(w.cpuMember);
    const result = updateIssueStatuses({
      projectId: w.projectId, userId: w.cpuLeader, issueIds, statusId: identified.id,
      reasonHtml: "<p>两条问题先后确认定位</p>", confirmed: true,
    });
    expect(result.updatedIssues).toBe(2);
    // 每个当前处理人只新增一条合并通知
    expect(notificationCount(w.cpuLeader)).toBe(leaderBefore + 1);
    expect(notificationCount(w.cpuMember)).toBe(memberBefore + 1);
    const notice = getDb().prepare("SELECT recipient_id, COUNT(*) AS count FROM notifications WHERE title = '批量状态更新通知' GROUP BY recipient_id").all() as { recipient_id: string; count: number }[];
    expect(notice.every((row) => row.count === 1)).toBe(true);
  });

  it("富文本清理保留图片与安全格式，移除脚本", () => {
    const cleaned = sanitizeRichText('<p onclick="alert(1)">结论<strong>明确</strong></p><script>alert(2)</script><img src="/api/uploads/abc.png" onerror="x" />');
    expect(cleaned).toContain("<strong>明确</strong>");
    expect(cleaned).toContain('src="/api/uploads/abc.png"');
    expect(cleaned).not.toContain("script");
    expect(cleaned).not.toContain("onclick");
    expect(cleaned).not.toContain("onerror");
  });
});