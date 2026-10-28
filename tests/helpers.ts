import bcrypt from "bcryptjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, useDatabaseForTests } from "@/lib/db";
import { newId } from "@/lib/ids";
import { addSchedule, createGroup } from "@/lib/groups";
import { createProject, addProjectMember, updateProjectMemberRoles } from "@/lib/projects";
import { listTimeSlots } from "@/lib/schedule";
import { setDefaultGroups } from "@/lib/taxonomy";

export interface TestEnv {
  dir: string;
  dbPath: string;
  cleanup: () => void;
}

export function makeTestEnv(): TestEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-test-"));
  const dbPath = path.join(dir, "test.db");
  useDatabaseForTests(dbPath);
  getDb();
  return {
    dir,
    dbPath,
    cleanup: () => {
      useDatabaseForTests(":memory:");
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function insertUser(name: string, employeeNo: string, password = "Test1234"): string {
  const id = newId("usr");
  getDb()
    .prepare("INSERT INTO users (id, name, employee_no, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, name, employeeNo, bcrypt.hashSync(password, 4), new Date().toISOString());
  return id;
}

export function addMember(projectId: string, pmId: string, userId: string, options: { isPm?: boolean; isSupervisor?: boolean } = {}): void {
  const exists = getDb()
    .prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(projectId, userId);
  if (!exists) addProjectMember(projectId, pmId, { userId, isPm: options.isPm, isSupervisor: options.isSupervisor });
  else if (options.isPm || options.isSupervisor) {
    updateProjectMemberRoles(projectId, pmId, userId, { isPm: Boolean(options.isPm), isSupervisor: Boolean(options.isSupervisor) });
  }
}

export interface TestWorld {
  projectId: string;
  pm: string;
  supervisor: string;
  tester: string;
  cpuLeader: string;
  cpuMember: string;
  cpuFallback: string;
  fanLeader: string;
  repairLeader: string;
  outsider: string;
  cpuGroupId: string;
  fanGroupId: string;
  repairGroupId: string;
  whiteSlotId: string;
  nightSlotId: string;
}

/** A fully scheduled 24/7 test project. */
export function createWorld(): TestWorld {
  const pm = insertUser("项目经理", "PM-T1");
  const supervisor = insertUser("项目主管", "SUP-T1");
  const tester = insertUser("测试员", "QA-T1");
  const cpuLeader = insertUser("CPU负责人", "CPU-T1");
  const cpuMember = insertUser("CPU成员", "CPU-T2");
  const cpuFallback = insertUser("CPU兜底", "CPU-T3");
  const fanLeader = insertUser("风扇负责人", "FAN-T1");
  const repairLeader = insertUser("维修负责人", "REP-T1");
  const outsider = insertUser("外部用户", "OUT-T1");
  const { id: projectId } = createProject(pm, { name: "测试项目", code: "TEST-001", description: "自动化测试" });
  addMember(projectId, pm, supervisor, { isSupervisor: true });
  addMember(projectId, pm, tester);

  const cpuGroup = createGroup(projectId, pm, {
    name: "CPU 组",
    leaderIds: [cpuLeader],
    defaultAssigneeId: cpuMember,
    fallbackAssigneeId: cpuFallback,
  });
  const fanGroup = createGroup(projectId, pm, {
    name: "风扇组",
    leaderIds: [fanLeader],
    defaultAssigneeId: fanLeader,
  });
  const repairGroup = createGroup(projectId, pm, {
    name: "维修组",
    leaderIds: [repairLeader],
    defaultAssigneeId: repairLeader,
  });
  const slots = listTimeSlots(projectId);
  const white = slots.find((slot) => slot.name === "白班")!;
  const night = slots.find((slot) => slot.name === "夜班")!;
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    addSchedule(projectId, cpuGroup.id, pm, { weekday, slotId: white.id, userId: cpuLeader, effectiveFrom: "2020-01-01", effectiveTo: null });
    addSchedule(projectId, cpuGroup.id, pm, { weekday, slotId: white.id, userId: cpuMember, effectiveFrom: "2020-01-01", effectiveTo: null });
    addSchedule(projectId, cpuGroup.id, pm, { weekday, slotId: night.id, userId: cpuFallback, effectiveFrom: "2020-01-01", effectiveTo: null });
    addSchedule(projectId, fanGroup.id, pm, { weekday, slotId: white.id, userId: fanLeader, effectiveFrom: "2020-01-01", effectiveTo: null });
    addSchedule(projectId, fanGroup.id, pm, { weekday, slotId: night.id, userId: fanLeader, effectiveFrom: "2020-01-01", effectiveTo: null });
    addSchedule(projectId, repairGroup.id, pm, { weekday, slotId: white.id, userId: repairLeader, effectiveFrom: "2020-01-01", effectiveTo: null });
    addSchedule(projectId, repairGroup.id, pm, { weekday, slotId: night.id, userId: repairLeader, effectiveFrom: "2020-01-01", effectiveTo: null });
  }
  setDefaultGroups(projectId, pm, [cpuGroup.id, fanGroup.id]);
  return {
    projectId,
    pm,
    supervisor,
    tester,
    cpuLeader,
    cpuMember,
    cpuFallback,
    fanLeader,
    repairLeader,
    outsider,
    cpuGroupId: cpuGroup.id,
    fanGroupId: fanGroup.id,
    repairGroupId: repairGroup.id,
    whiteSlotId: white.id,
    nightSlotId: night.id,
  };
}

export function notificationCount(recipientId?: string): number {
  if (recipientId) {
    return (getDb().prepare("SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ?").get(recipientId) as { count: number }).count;
  }
  return (getDb().prepare("SELECT COUNT(*) AS count FROM notifications").get() as { count: number }).count;
}

export function latestNotifications(recipientId?: string): Record<string, unknown>[] {
  const sql = recipientId
    ? "SELECT * FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC, id DESC"
    : "SELECT * FROM notifications ORDER BY created_at DESC, id DESC";
  return (recipientId ? getDb().prepare(sql).all(recipientId) : getDb().prepare(sql).all()) as Record<string, unknown>[];
}

export function userName(id: string): string {
  return (getDb().prepare("SELECT name FROM users WHERE id = ?").get(id) as { name: string }).name;
}
