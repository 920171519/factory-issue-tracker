import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveGroupAt, listTimeSlots } from "@/lib/schedule";
import { getDb } from "@/lib/db";
import { addGroupMember, addSchedule, addScheduleOverride, createGroup } from "@/lib/groups";
import { createBarcode } from "@/lib/issues";
import { addProjectMember, updateProjectMemberRoles } from "@/lib/projects";
import { createTimeSlot, saveHost } from "@/lib/taxonomy";
import { getProjectAccess } from "@/lib/access";
import { createWorld, insertUser, makeTestEnv, type TestEnv } from "./helpers";
import { addDays, getLocalParts, todayLocal } from "@/lib/time";

let env: TestEnv;

beforeEach(() => { env = makeTestEnv(); });
afterEach(() => { env.cleanup(); });

describe("排班解析", () => {
  it("按星期与班次解析，并支持按日期覆盖、兜底和班次重叠校验", () => {
    const w = createWorld();
    const slots = listTimeSlots(w.projectId);
    const white = slots.find((slot) => slot.name === "白班")!;
    const night = slots.find((slot) => slot.name === "夜班")!;

    // 独立创建一个只配置周一/周二的组
    const extraMember = insertUser("隔日成员", "ALT-T1");
    const group = createGroup(w.projectId, w.pm, { name: "隔日组", leaderIds: [w.cpuLeader] });
    addProjectMember(w.projectId, w.pm, { userId: extraMember });
    addGroupMember(w.projectId, group.id, w.pm, { userId: extraMember });
    addSchedule(w.projectId, group.id, w.pm, {
      weekday: 1, slotId: white.id, userId: w.cpuLeader, effectiveFrom: "2020-01-01", effectiveTo: null,
    });
    addSchedule(w.projectId, group.id, w.pm, {
      weekday: 2, slotId: white.id, userId: extraMember, effectiveFrom: "2020-01-01", effectiveTo: null,
    });

    const monday = "2026-09-07"; // Monday
    const tuesday = "2026-09-08";
    expect(getLocalParts(new Date("2026-09-07T01:00:00Z")).weekday).toBe(1);
    const mondayRes = resolveGroupAt(group.id, { date: monday, weekday: 1, minutes: 9 * 60, at: new Date() });
    expect(mondayRes.source).toBe("SCHEDULE");
    expect(mondayRes.handlerIds).toEqual([w.cpuLeader]);
    expect(mondayRes.primaryId).toBe(w.cpuLeader);

    const tuesdayRes = resolveGroupAt(group.id, { date: tuesday, weekday: 2, minutes: 9 * 60, at: new Date() });
    expect(tuesdayRes.handlerIds).toContain(extraMember);
    expect(tuesdayRes.handlerIds).not.toContain(w.cpuLeader);

    // 具体日期覆盖星期模板
    addScheduleOverride(w.projectId, group.id, w.pm, {
      overrideDate: monday, slotId: white.id, userId: extraMember, kind: "TEMP", note: "临时调班",
    });
    const overridden = resolveGroupAt(group.id, { date: monday, weekday: 1, minutes: 9 * 60, at: new Date() });
    expect(overridden.source).toBe("OVERRIDE");
    expect(overridden.handlerIds).toEqual([extraMember]);
    expect(overridden.overrideNote).toBe("临时调班");

    // 空组无排班时兜底到负责人、默认/兜底处理人与 PM（负责人已在）
    const emptyGroup = createGroup(w.projectId, w.pm, { name: "空排班组", leaderIds: [w.fanLeader] });
    const fallback = resolveGroupAt(emptyGroup.id, { date: monday, weekday: 1, minutes: 9 * 60, at: new Date() });
    expect(fallback.source).toBe("FALLBACK");
    expect(fallback.handlerIds).toContain(w.fanLeader);
    expect(fallback.handlerIds).toContain(w.pm);
    expect(fallback.fallbackReason).toContain("无排班");

    // 班次模板不允许重叠
    expect(() => createTimeSlot(w.projectId, w.pm, { name: "重叠班", start: "09:00", end: "10:00" })).toThrow(/重叠/);
  });

  it("多人排班全部通知，并按待处理数选择主处理人", () => {
    const w = createWorld();
    const moment = { date: "2026-09-07", weekday: 1, minutes: 9 * 60, at: new Date("2026-09-07T01:00:00Z") };
    // CPU 白班有负责人和成员两人
    const initial = resolveGroupAt(w.cpuGroupId, moment);
    expect(new Set(initial.handlerIds)).toEqual(new Set([w.cpuLeader, w.cpuMember]));

    // 连续录入两个问题后，负责人被选中过主处理人并积累待处理数
    createBarcode(w.projectId, w.tester, {
      barcode: "TEST-COUNT-1", locationNo: "A-01", groupIds: [w.cpuGroupId], priority: "HIGH",
    }, { now: moment.at });
    createBarcode(w.projectId, w.tester, {
      barcode: "TEST-COUNT-2", locationNo: "A-01", groupIds: [w.cpuGroupId], priority: "MEDIUM",
    }, { now: moment.at });

    const after = resolveGroupAt(w.cpuGroupId, moment);
    const handlerRows = getDb()
      .prepare(`SELECT h.user_id, h.is_primary FROM issue_group_handlers h
                JOIN issue_groups ig ON ig.id = h.issue_group_id
                JOIN issues i ON i.id = ig.issue_id
                WHERE ig.group_id = ? AND i.project_id = ?`)
      .all(w.cpuGroupId, w.projectId) as { user_id: string; is_primary: number }[];
    expect(handlerRows.length).toBe(4);
    // 每次分配都只产生一个主处理人
    const primaryByIssue = getDb()
      .prepare(`SELECT ig.issue_id, COUNT(*) AS primaries FROM issue_group_handlers h
                JOIN issue_groups ig ON ig.id = h.issue_group_id
                WHERE ig.group_id = ? AND h.is_primary = 1 GROUP BY ig.issue_id`)
      .all(w.cpuGroupId) as { issue_id: string; primaries: number }[];
    expect(primaryByIssue.every((row) => row.primaries === 1)).toBe(true);
    // 该组解析包含两名配置责任人
    expect(after.handlerIds.length).toBe(2);
  });

  it("项目访问与责任组负责人权限按范围隔离", () => {
    const w = createWorld();
    expect(getProjectAccess(w.outsider, w.projectId)).toBeNull();
    const pmAccess = getProjectAccess(w.pm, w.projectId)!;
    const leaderAccess = getProjectAccess(w.cpuLeader, w.projectId)!;
    const testerAccess = getProjectAccess(w.tester, w.projectId)!;
    const supAccess = getProjectAccess(w.supervisor, w.projectId)!;
    expect(pmAccess.isPm).toBe(true);
    expect(supAccess.isSupervisor).toBe(true);
    expect(leaderAccess.isGroupLeader).toBe(true);
    expect(leaderAccess.leaderGroupIds).toEqual([w.cpuGroupId]);
    expect(testerAccess.isGroupLeader).toBe(false);
    expect(testerAccess.groupIds).toEqual([]);
  });
});