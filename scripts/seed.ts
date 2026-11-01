import bcrypt from "bcryptjs";
import { getDb } from "../lib/db";
import { newId } from "../lib/ids";
import { addDays, nowIso, todayLocal } from "../lib/time";
import { createProject, addProjectMember, updateProjectMemberRoles } from "../lib/projects";
import {
  addGroupMember,
  addSchedule,
  createGroup,
} from "../lib/groups";
import { createCategory, listTimeSlotViews, saveHost, setDefaultGroups, createCode } from "../lib/taxonomy";
import {
  concludeItem,
  createBatch,
  createPackage,
  createRequest,
  setTesterGroup,
  updatePackage,
} from "../lib/packages";
import { addErrorIssue, createBarcode, getProjectStatuses, updateTrackingGroups } from "../lib/issues";
import { updateIssueStatuses } from "../lib/status-actions";
import { transferResponsibility } from "../lib/assignments";

const PASSWORD = "Demo1234";
const DEMO_PROJECT_CODE = "XH-NPI-2026";

interface Person {
  key: string;
  name: string;
  employeeNo: string;
  isSystemAdmin?: boolean;
}

const PEOPLE: Person[] = [
  { key: "admin", name: "系统管理员", employeeNo: "a00000001", isSystemAdmin: true },
  { key: "pm", name: "林晓", employeeNo: "p00000001" },
  { key: "supervisor", name: "陈工", employeeNo: "s00000002" },
  { key: "cpuLeader", name: "张伟", employeeNo: "c00000003" },
  { key: "cpuDefault", name: "李娜", employeeNo: "c00000004" },
  { key: "cpuFallback", name: "王强", employeeNo: "c00000005" },
  { key: "cpuMember", name: "刘洋", employeeNo: "c00000006" },
  { key: "fanLeader", name: "赵敏", employeeNo: "f00000007" },
  { key: "fanDefault", name: "周航", employeeNo: "f00000008" },
  { key: "repairLeader", name: "孙磊", employeeNo: "r00000009" },
  { key: "retestLeader", name: "吴倩", employeeNo: "t00000010" },
  { key: "tester", name: "郑一", employeeNo: "q00000011" },
  { key: "softwareManager", name: "周敏", employeeNo: "m00000012" },
];

async function ensureUser(person: Person): Promise<string> {
  const db = getDb();
  const existing = db.prepare("SELECT id, is_system_admin FROM users WHERE employee_no = ?").get(person.employeeNo) as { id: string; is_system_admin: number } | undefined;
  if (existing) {
    if (person.isSystemAdmin && existing.is_system_admin !== 1) {
      db.prepare("UPDATE users SET is_system_admin = 1 WHERE id = ?").run(existing.id);
    }
    return existing.id;
  }
  const id = newId("usr");
  const hash = await bcrypt.hash(PASSWORD, 10);
  db.prepare("INSERT INTO users (id, name, employee_no, password_hash, is_system_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id,
    person.name,
    person.employeeNo,
    hash,
    person.isSystemAdmin ? 1 : 0,
    nowIso(),
  );
  return id;
}

function ensureProjectMember(projectId: string, pmId: string, userId: string): void {
  const exists = getDb()
    .prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(projectId, userId);
  if (!exists) addProjectMember(projectId, pmId, { userId });
}

function groupIdByName(projectId: string, name: string): string {
  const row = getDb().prepare("SELECT id FROM groups WHERE project_id = ? AND name = ?").get(projectId, name) as
    | { id: string }
    | undefined;
  if (!row) throw new Error(`缺少演示责任组：${name}`);
  return row.id;
}

/** 软件包与转测/验证演示数据（幂等：已存在则不重复创建）。 */
async function seedPackageDemo(
  projectId: string,
  ids: Record<string, string>,
  groups: { cpu: string; fan: string; repair: string; retest: string },
): Promise<void> {
  const db = getDb();
  setTesterGroup(projectId, ids.pm, groups.retest);
  ensureProjectMember(projectId, ids.pm, ids.softwareManager);
  updateProjectMemberRoles(projectId, ids.pm, ids.softwareManager, { isPm: false, isSupervisor: false, isSoftwareManager: true });

  // 历史编码补责任组（编码清单已迁移为软件包管理）
  const legacy = db.prepare("SELECT id, code FROM code_list WHERE project_id = ?").all(projectId) as { id: string; code: string }[];
  for (const row of legacy) {
    if (row.code === "XH-SYS-PCB-A01") updatePackage(projectId, row.id, ids.pm, { groupId: groups.cpu, ownerId: ids.cpuLeader });
    if (row.code === "XH-FAN-4020") updatePackage(projectId, row.id, ids.pm, { groupId: groups.fan, ownerId: ids.fanLeader });
    if (row.code === "XH-PSU-1600") updatePackage(projectId, row.id, ids.pm, { groupId: groups.repair, ownerId: ids.repairLeader });
  }

  function ensurePackage(code: string, description: string, version: string, groupId: string, ownerId: string): string {
    const existing = db.prepare("SELECT id FROM code_list WHERE project_id = ? AND code = ?").get(projectId, code) as
      | { id: string }
      | undefined;
    if (existing) {
      updatePackage(projectId, existing.id, ids.pm, { groupId, ownerId });
      return existing.id;
    }
    return createPackage(projectId, ids.pm, { code, description, version, groupId, ownerId }).id;
  }

  const bios = ensurePackage("XH-BIOS-FW", "服务器 BIOS 固件", "Rev.B2", groups.cpu, ids.cpuLeader);
  const bmc = ensurePackage("XH-BMC-FW", "BMC 管理固件", "V1.4", groups.fan, ids.fanLeader);
  const cpld = ensurePackage("XH-CPLD-LOGIC", "CPLD 逻辑固件", "V2.1", groups.retest, ids.retestLeader);

  const board = ensurePackage("XH-SYS-PCB-A01", "整机主板组件编码", "Rev.B2", groups.cpu, ids.cpuLeader);

  const batchCount = db
    .prepare("SELECT COUNT(*) AS count FROM package_batches WHERE project_id = ? AND kind = 'TEST'")
    .get(projectId) as { count: number };
  if (batchCount.count > 0) return;

  console.log("正在创建软件包转测/验证演示数据…");
  const biosRequest = createRequest(projectId, ids.cpuLeader, {
    kind: "TEST",
    packageId: bios,
    version: "Rev.C1",
    changeSummary: "修复 CPU 满载降频策略，新增温度阈值日志与风扇联动。",
    packageUrl: "\\\\share\\release\\XH-BIOS-FW\\Rev.C1",
  });
  const bmcRequest = createRequest(projectId, ids.fanLeader, {
    kind: "TEST",
    packageId: bmc,
    version: "V1.5",
    changeSummary: "修复风扇转速曲线在小负载下的周期性抖动。",
    packageUrl: "\\\\share\\release\\XH-BMC-FW\\V1.5",
  });
  const boardRequest = createRequest(projectId, ids.cpuLeader, {
    kind: "TEST",
    packageId: board,
    version: "Rev.B3",
    changeSummary: "修正主板电源时序与 CPU 供电反馈环路。",
    packageUrl: "\\\\share\\release\\XH-SYS-PCB-A01\\Rev.B3",
  });

  const testBatch = createBatch(projectId, ids.pm, {
    kind: "TEST",
    requestIds: [biosRequest.id, bmcRequest.id, boardRequest.id],
    title: "11 月第一次转测",
    scheduledDate: todayLocal(),
    note: "常规月度转测，重点验证降频策略、风扇曲线与主板供电时序。",
  });
  const testItems = db
    .prepare("SELECT id, package_id AS packageId FROM package_batch_items WHERE batch_id = ?")
    .all(testBatch.batchId) as { id: string; packageId: string }[];
  const biosTestItem = testItems.find((item) => item.packageId === bios);
  const bmcTestItem = testItems.find((item) => item.packageId === bmc);
  const boardTestItem = testItems.find((item) => item.packageId === board);
  if (!biosTestItem || !bmcTestItem || !boardTestItem) throw new Error("演示批次条目缺失");

  concludeItem(projectId, testBatch.batchId, biosTestItem.id, ids.retestLeader, {
    conclusion: "PASS",
    note: "满载 8 小时稳定，降频温度曲线符合预期，可提交转验证。",
  });
  concludeItem(projectId, testBatch.batchId, bmcTestItem.id, ids.retestLeader, {
    conclusion: "CONDITIONAL",
    note: "小负载转速仍有约 3% 抖动，需在 V1.6 复测后再提交转验证。",
  });
  concludeItem(projectId, testBatch.batchId, boardTestItem.id, ids.retestLeader, {
    conclusion: "PASS",
    note: "电源时序与供电反馈均正常，可转正式服务器验证。",
  });

  const verifyRequest = createRequest(projectId, ids.cpuLeader, {
    kind: "VERIFY",
    packageId: board,
    version: "Rev.B3",
    changeSummary: "主板 Rev.B3 转正式服务器验证。",
    packageUrl: "\\\\share\\release\\XH-SYS-PCB-A01\\Rev.B3",
    sourceItemId: boardTestItem.id,
  });
  const verifyBatch = createBatch(projectId, ids.pm, {
    kind: "VERIFY",
    requestIds: [verifyRequest.id],
    title: "11 月第一次转验证",
    scheduledDate: todayLocal(),
    note: "正式服务器 A-01 验证主板 Rev.B3。",
    barcodes: [{ requestId: verifyRequest.id, barcodes: ["XH-CPU-2601001", "XH-MIX-2601003"] }],
  });
  const verifyItem = db
    .prepare("SELECT id FROM package_batch_items WHERE batch_id = ? AND package_id = ?")
    .get(verifyBatch.batchId, board) as { id: string } | undefined;
  if (!verifyItem) throw new Error("演示验证条目缺失");
  concludeItem(projectId, verifyBatch.batchId, verifyItem.id, ids.retestLeader, {
    conclusion: "PASS",
    note: "正式服务器条码 XH-CPU-2601001 与 XH-MIX-2601003 连续运行 48 小时无异常，可转正。",
  });

  // 第二次转测：CPLD 已组织但尚未出结论，用于演示「在测跟踪」跨批次视图。
  const cpldRequest = createRequest(projectId, ids.retestLeader, {
    kind: "TEST",
    packageId: cpld,
    version: "Rev.A2",
    changeSummary: "调整上电时序，缩短 PCIe 复位等待时间。",
    packageUrl: "\\\\share\\release\\XH-CPLD-LOGIC\\Rev.A2",
  });
  createBatch(projectId, ids.pm, {
    kind: "TEST",
    requestIds: [cpldRequest.id],
    title: "11 月第二次转测",
    scheduledDate: todayLocal(),
    note: "第一批尚未全部验证完成，第二批单独转 CPLD。",
  });

  // 仍待组织的下一次转测申请（演示待办队列）。
  createRequest(projectId, ids.cpuMember, {
    kind: "TEST",
    packageId: bios,
    version: "Rev.C2",
    changeSummary: "补充风扇联动曲线，修复待机噪音偏大问题。",
    packageUrl: "\\\\share\\release\\XH-BIOS-FW\\Rev.C2",
  });
}

async function main() {
  const db = getDb();

  console.log("正在创建演示账号…");
  const ids: Record<string, string> = {};
  for (const person of PEOPLE) ids[person.key] = await ensureUser(person);

  const existing = db.prepare("SELECT id, name FROM projects WHERE code = ?").get(DEMO_PROJECT_CODE) as
    | { id: string; name: string }
    | undefined;
  if (existing) {
    await seedPackageDemo(existing.id, ids, {
      cpu: groupIdByName(existing.id, "CPU 测试组"),
      fan: groupIdByName(existing.id, "风扇测试组"),
      repair: groupIdByName(existing.id, "维修组"),
      retest: groupIdByName(existing.id, "复测组"),
    });
    console.log("\n演示项目已存在，跳过基础种子数据创建（已补齐软件包演示数据）。");
    console.log(`项目：${existing.name}（${existing.id}）`);
    console.log(`登录账号：a00000001（系统管理员）/ ${PASSWORD}`);
    return;
  }

  console.log("正在创建项目与基础配置…");
  const { id: projectId } = createProject(ids.pm, {
    name: "星河服务器 NPI 验证项目",
    code: DEMO_PROJECT_CODE,
    description: "用于服务器整机 NPI 阶段的问题定位、责任组排班与跨组协作演示。覆盖 CPU 测试、风扇测试、维修与复测场景。",
  });

  for (const person of PEOPLE) ensureProjectMember(projectId, ids.pm, ids[person.key]);
  updateProjectMemberRoles(projectId, ids.pm, ids.supervisor, { isPm: false, isSupervisor: true });
  updateProjectMemberRoles(projectId, ids.pm, ids.admin, { isPm: true, isSupervisor: false });

  const categories = {
    cpu: createCategory(projectId, ids.pm, { name: "CPU 异常", color: "#2563eb" }).id,
    fan: createCategory(projectId, ids.pm, { name: "风扇异常", color: "#0891b2" }).id,
    power: createCategory(projectId, ids.pm, { name: "电源异常", color: "#d97706" }).id,
    structural: createCategory(projectId, ids.pm, { name: "结构异常", color: "#7c3aed" }).id,
  };

  const cpuGroup = createGroup(projectId, ids.pm, {
    name: "CPU 测试组",
    description: "负责 CPU 相关的功能、性能与稳定性问题定位。",
    leaderIds: [ids.cpuLeader],
    defaultAssigneeId: ids.cpuDefault,
    fallbackAssigneeId: ids.cpuFallback,
  }).id;
  const fanGroup = createGroup(projectId, ids.pm, {
    name: "风扇测试组",
    description: "负责风扇、散热模块与转速策略问题定位。",
    leaderIds: [ids.fanLeader],
    defaultAssigneeId: ids.fanDefault,
    fallbackAssigneeId: ids.fanLeader,
  }).id;
  const repairGroup = createGroup(projectId, ids.pm, {
    name: "维修组",
    description: "负责故障件维修、更换与维修结果确认。",
    leaderIds: [ids.repairLeader],
    defaultAssigneeId: ids.repairLeader,
    fallbackAssigneeId: ids.repairLeader,
  }).id;
  const retestGroup = createGroup(projectId, ids.pm, {
    name: "复测组",
    description: "负责维修后复测与隔离设备复测。",
    leaderIds: [ids.retestLeader],
    defaultAssigneeId: ids.retestLeader,
    fallbackAssigneeId: ids.retestLeader,
  }).id;

  addGroupMember(projectId, cpuGroup, ids.pm, { userId: ids.cpuMember });
  addGroupMember(projectId, repairGroup, ids.pm, { userId: ids.supervisor });

  const slots = listTimeSlotViews(projectId);
  const white = slots.find((slot) => slot.name === "白班");
  const night = slots.find((slot) => slot.name === "夜班");
  if (!white || !night) throw new Error("默认班次模板缺失");
  const effectiveFrom = addDays(todayLocal(), -120);

  const schedulePlan: { groupId: string; userId: string; slotId: string }[] = [
    { groupId: cpuGroup, userId: ids.cpuLeader, slotId: white.id },
    { groupId: cpuGroup, userId: ids.cpuDefault, slotId: white.id },
    { groupId: cpuGroup, userId: ids.cpuFallback, slotId: night.id },
    { groupId: fanGroup, userId: ids.fanDefault, slotId: white.id },
    { groupId: fanGroup, userId: ids.fanLeader, slotId: night.id },
    { groupId: repairGroup, userId: ids.repairLeader, slotId: white.id },
    { groupId: repairGroup, userId: ids.supervisor, slotId: night.id },
    { groupId: retestGroup, userId: ids.retestLeader, slotId: white.id },
    { groupId: retestGroup, userId: ids.retestLeader, slotId: night.id },
  ];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    for (const plan of schedulePlan) {
      addSchedule(projectId, plan.groupId, ids.pm, {
        weekday,
        slotId: plan.slotId,
        userId: plan.userId,
        effectiveFrom,
        effectiveTo: null,
      });
    }
  }

  setDefaultGroups(projectId, ids.pm, [cpuGroup, fanGroup]);

  saveHost(projectId, ids.pm, { locationNo: "A-01", hostIp: "192.168.30.11", hostAccount: "tester", hostPassword: "factory@2026" });
  saveHost(projectId, ids.pm, { locationNo: "A-02", hostIp: "192.168.30.12", hostAccount: "tester", hostPassword: "factory@2026" });
  saveHost(projectId, ids.pm, { locationNo: "B-01", hostIp: "192.168.31.21", hostAccount: "tester", hostPassword: "factory@2026" });
  saveHost(projectId, ids.pm, { locationNo: "B-02", hostIp: "192.168.31.22", hostAccount: "tester", hostPassword: "factory@2026" });

  createCode(projectId, ids.pm, { code: "XH-SYS-PCB-A01", description: "整机主板组件编码", version: "Rev.B2", ownerId: ids.cpuLeader });
  createCode(projectId, ids.pm, { code: "XH-FAN-4020", description: "4020 规格系统风扇", version: "V1.4", ownerId: ids.fanLeader });
  createCode(projectId, ids.pm, { code: "XH-PSU-1600", description: "1600W 冗余电源模块", version: "Rev.A1", ownerId: ids.pm });

  await seedPackageDemo(projectId, ids, { cpu: cpuGroup, fan: fanGroup, repair: repairGroup, retest: retestGroup });

  console.log("正在创建演示问题…");
  const statuses = getProjectStatuses(projectId);
  const identifiedStatus = statuses.find((status) => status.name === "已定位");
  if (!identifiedStatus) throw new Error("缺少已定位状态");

  const first = createBarcode(projectId, ids.tester, {
    barcode: "XH-CPU-2601001",
    locationNo: "A-01",
    groupIds: [cpuGroup],
    categoryId: categories.cpu,
    priority: "HIGH",
    remark: "满载压测过程中 CPU 温度触发告警，现场等待初步定位结论。",
  });
  const firstDetailIssues = getDb().prepare("SELECT id FROM issues WHERE barcode_id = ? ORDER BY created_at").all(first.barcodeId) as { id: string }[];
  updateTrackingGroups(projectId, first.barcodeId, ids.tester, ["CPU 定位协作群 9001", "NPI 现场支持群 9002"]);
  addErrorIssue(projectId, first.barcodeId, ids.cpuLeader, { errorItem: "CPU 满载温度超过 95℃ 阈值" });
  updateIssueStatuses({
    projectId,
    userId: ids.cpuLeader,
    issueIds: [firstDetailIssues[0].id],
    statusId: identifiedStatus.id,
    reasonHtml: "<p>已完成复现，定位为散热器扣具压力不足导致接触热阻偏高；待维修组更换散热器后复测。</p>",
    confirmed: true,
  });

  const second = createBarcode(projectId, ids.tester, {
    barcode: "XH-FAN-2601002",
    locationNo: "A-02",
    groupIds: [fanGroup],
    categoryId: categories.fan,
    priority: "MEDIUM",
    remark: "系统风扇转速周期性波动，未见宕机。",
  });
  const secondIssue = getDb().prepare("SELECT id FROM issues WHERE barcode_id = ?").get(second.barcodeId) as { id: string };
  const { updateErrorItem } = await import("../lib/issues");
  updateErrorItem(projectId, secondIssue.id, ids.fanLeader, "风扇转速波动超出允许范围");
  updateTrackingGroups(projectId, second.barcodeId, ids.tester, ["风扇问题跟踪群 9010"]);

  const third = createBarcode(projectId, ids.tester, {
    barcode: "XH-MIX-2601003",
    locationNo: "B-01",
    groupIds: [cpuGroup, fanGroup],
    categoryId: categories.power,
    priority: "LOW",
    remark: "随机整机掉电，需 CPU 与风扇组共同定位。",
  });
  addErrorIssue(projectId, third.barcodeId, ids.pm, { errorItem: "整机随机掉电并自动重启" });

  const fourth = createBarcode(projectId, ids.tester, {
    barcode: "XH-TR-2601004",
    locationNo: "B-02",
    groupIds: [cpuGroup],
    categoryId: categories.structural,
    priority: "HIGH",
    remark: "疑似散热结构问题，转维修组进一步处理。",
  });
  addErrorIssue(projectId, fourth.barcodeId, ids.cpuLeader, { errorItem: "散热模组固定螺柱滑牙" });
  transferResponsibility({
    projectId,
    userId: ids.pm,
    selection: { barcodeId: fourth.barcodeId },
    mode: "CROSS",
    targetGroupIds: [repairGroup],
    retainedGroupIds: [],
    reasonHtml: "<p>初步确认为散热模组结构问题，现转维修组更换固定组件；CPU 测试组不再继续参与。</p>",
  });

  console.log("\n✔ 演示数据创建完成");
  console.log("项目：星河服务器 NPI 验证项目");
  console.log("账号（密码均为 " + PASSWORD + "）：");
  console.log("  a00000001   系统管理员  全局唯一可创建项目的管理员 / 演示项目 PM");
  console.log("  p00000001   林晓        项目 PM");
  console.log("  s00000002   陈工        项目主管 / 维修组夜班处理人");
  console.log("  c00000003   张伟        CPU 测试组负责人");
  console.log("  c00000004   李娜        CPU 测试组默认处理人");
  console.log("  c00000005   王强        CPU 测试组夜班");
  console.log("  c00000006   刘洋        CPU 测试组成员（组内转交对象）");
  console.log("  f00000007   赵敏        风扇测试组负责人");
  console.log("  f00000008   周航        风扇测试组默认处理人");
  console.log("  r00000009   孙磊        维修组负责人");
  console.log("  t00000010   吴倩        复测组负责人");
  console.log("  q00000011   郑一        测试录入人（普通项目成员）");
  console.log("  m00000012   周敏        软件经理（组织转测试/转验证批次）");
  console.log("\n登录地址：http://localhost:3000/login");
}

main()
  .catch((error) => {
    console.error("种子数据创建失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { closeDb } = await import("../lib/db");
    closeDb();
  });
