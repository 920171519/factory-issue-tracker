import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { updateProjectMemberRoles } from "@/lib/projects";
import { createCategory } from "@/lib/taxonomy";
import { createWorld, makeTestEnv, type TestEnv, type TestWorld } from "./helpers";
import {
  concludeItem,
  concludeVerification,
  createBatch,
  createPackage,
  createRequest,
  deletePackage,
  getPackageHistory,
  getPackagesPayload,
  handleVerification,
  promoteVerifications,
  setTesterGroup,
  updateVerification,
} from "@/lib/packages";

let env: TestEnv;
let w: TestWorld;
beforeEach(() => {
  env = makeTestEnv();
  w = createWorld();
  setTesterGroup(w.projectId, w.pm, w.repairGroupId);
});
afterEach(() => { env.cleanup(); });

const REQUEST = { changeSummary: "修复测试问题", packageUrl: "\\\\share\\pkg" };
const PROCESS_URL = "https://flow.example.com/BIOS-1";

function makePackage(
  code: string,
  version: string,
  groupId: string | null,
  ownerId: string | null = null,
  extra: { nodeId?: string | null; usageNote?: string } = {},
): string {
  return createPackage(w.projectId, w.pm, { code, description: `${code} 描述`, version, groupId, ownerId, ...extra }).id;
}

/** 把项目成员测试员设置为「软件经理」并返回其 id。 */
function makeSoftwareManager(): string {
  updateProjectMemberRoles(w.projectId, w.pm, w.tester, { isPm: false, isSupervisor: false, isSoftwareManager: true });
  return w.tester;
}

function submitTest(packageId: string, version: string, userId = w.cpuLeader): string {
  return createRequest(w.projectId, userId, { kind: "TEST", packageId, version, ...REQUEST }).id;
}

function batchItems(batchId: string) {
  return getDb()
    .prepare("SELECT package_id AS packageId, version, official_version AS officialVersion, updated_vs_official AS vsOfficial, updated_vs_previous AS vsPrevious, previous_version AS previousVersion, request_id AS requestId, conclusion FROM package_batch_items WHERE batch_id = ?")
    .all(batchId) as {
    packageId: string;
    version: string | null;
    officialVersion: string | null;
    vsOfficial: number;
    vsPrevious: number;
    previousVersion: string | null;
    requestId: string | null;
    conclusion: string;
  }[];
}

function itemId(batchId: string, packageId: string): string {
  const row = getDb()
    .prepare("SELECT id FROM package_batch_items WHERE batch_id = ? AND package_id = ?")
    .get(batchId, packageId) as { id: string } | undefined;
  if (!row) throw new Error("批次条目不存");
  return row.id;
}

function packageState(packageId: string) {
  return getPackagesPayload(w.projectId, w.pm).packages.find((entry) => entry.id === packageId)!;
}

describe("软件包基础能力与提交权限", () => {
  it("仅项目 PM 可维护软件包与测试责任组", () => {
    expect(() => createPackage(w.projectId, w.cpuLeader, { code: "X1", version: "1.0", groupId: w.cpuGroupId })).toThrow(/项目 PM/);
    const id = makePackage("PKG-A", "1.0", w.cpuGroupId);
    expect(id).toMatch(/^cod_/);
    expect(() => createPackage(w.projectId, w.pm, { code: "PKG-A", version: "2.0", groupId: w.cpuGroupId })).toThrow(/已存在/);
    expect(() => setTesterGroup(w.projectId, w.cpuLeader, w.repairGroupId)).toThrow(/项目 PM/);
    expect(getPackagesPayload(w.projectId, w.pm).testerGroup?.id).toBe(w.repairGroupId);
  });

  it("软件包可配置归属节点与说明，节点必须属于本项目", () => {
    const { id: categoryId } = createCategory(w.projectId, w.pm, { name: "整机老化节点", color: "#2563eb" });
    const id = makePackage("PKG-NODE", "1.0", w.cpuGroupId, null, { nodeId: categoryId, usageNote: "星河服务器 · 整机测试" });
    const overview = packageState(id);
    expect(overview.nodeId).toBe(categoryId);
    expect(overview.nodeName).toBe("整机老化节点");
    expect(overview.usageNote).toBe("星河服务器 · 整机测试");
    const payload = getPackagesPayload(w.projectId, w.pm);
    expect(payload.nodes.some((node) => node.id === categoryId)).toBe(true);
    expect(() => makePackage("PKG-BAD-NODE", "1.0", w.cpuGroupId, null, { nodeId: "cat_missing" })).toThrow(/节点/);
  });

  it("未分配责任组的软件包不能提交转测试申请", () => {
    const orphan = makePackage("PKG-ORPHAN", "1.0", null);
    expect(() => submitTest(orphan, "1.1")).toThrow(/责任组/);
  });

  it("项目成员都能提交，但只能选择自己责任组内的软件包", () => {
    const pkg = makePackage("PKG-A", "1.0", w.cpuGroupId);
    expect(() => submitTest(pkg, "1.1", w.fanLeader)).toThrow(/自己责任组/);
    expect(() => submitTest(pkg, "1.1", w.tester)).toThrow(/自己责任组/);
    expect(() => submitTest(pkg, "1.1", w.cpuMember)).not.toThrow();
    expect(() => submitTest(pkg, "1.1", w.cpuMember)).toThrow(/已有待组织/);
    expect(() => createRequest(w.projectId, w.pm, { kind: "TEST", packageId: pkg, version: "1.2", ...REQUEST })).not.toThrow();
    expect(() => createRequest(w.projectId, w.supervisor, { kind: "TEST", packageId: pkg, version: "1.3", ...REQUEST })).not.toThrow();
    const softwareManager = makeSoftwareManager();
    expect(() => createRequest(w.projectId, softwareManager, { kind: "TEST", packageId: pkg, version: "1.4", ...REQUEST })).not.toThrow();
  });

  it("缺少修改内容或存放链接时拒绝提交", () => {
    const pkg = makePackage("PKG-A", "1.0", w.cpuGroupId);
    expect(() => createRequest(w.projectId, w.cpuLeader, { kind: "TEST", packageId: pkg, version: "1.1", changeSummary: "", packageUrl: "x" })).toThrow(/修改内容/);
    expect(() => createRequest(w.projectId, w.cpuLeader, { kind: "TEST", packageId: pkg, version: "1.1", changeSummary: "改动", packageUrl: "" })).toThrow(/链接/);
  });

  it("软件经理、PM、主管可组织批次，责任组负责人不具备组织权限", () => {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    const requestId = submitTest(a, "1.1");
    expect(() => createBatch(w.projectId, w.cpuLeader, { kind: "TEST", requestIds: [requestId] })).toThrow(/组织/);
    expect(() => createBatch(w.projectId, w.repairLeader, { kind: "TEST", requestIds: [requestId] })).toThrow(/组织/);
    const softwareManager = makeSoftwareManager();
    expect(() => createBatch(w.projectId, softwareManager, { kind: "TEST", requestIds: [requestId] })).not.toThrow();
  });
});

describe("转测试批次与配套表", () => {
  it("批次包含全部软件包，转测包取申请版本，其余保持正式版本", () => {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    const b = makePackage("PKG-B", "2.0", w.fanGroupId);
    const c = makePackage("PKG-C", "3.0", w.cpuGroupId);
    const requestId = submitTest(a, "1.1");
    const { batchId } = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [requestId], title: "第一批" });

    const items = batchItems(batchId);
    expect(items).toHaveLength(3);
    const rowA = items.find((row) => row.packageId === a)!;
    const rowB = items.find((row) => row.packageId === b)!;
    expect(rowA.version).toBe("1.1");
    expect(rowA.officialVersion).toBe("1.0");
    expect(rowA.vsOfficial).toBe(1);
    expect(rowA.vsPrevious).toBe(1);
    expect(rowB.version).toBe("2.0");
    expect(rowB.vsPrevious).toBe(0);
    expect(rowB.requestId).toBeNull();

    const payload = getPackagesPayload(w.projectId, w.pm);
    expect(payload.testBatches).toHaveLength(1);
    expect(payload.testBatches[0].transferredCount).toBe(1);
    expect(packageState(a).testVersion).toBe("1.1");
    expect(packageState(b).testVersion).toBeNull();
    expect(packageState(c).verificationVersion).toBeNull();
  });

  it("连续两次转测：分别标注相较正式版本与相较上一批转测版本", () => {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    const b = makePackage("PKG-B", "2.0", w.cpuGroupId);
    const first = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(a, "1.1")], title: "第一批" });
    expect(batchItems(first.batchId).find((row) => row.packageId === b)!.vsPrevious).toBe(0);

    const second = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(b, "2.1")], title: "第二批" });
    const secondA = batchItems(second.batchId).find((row) => row.packageId === a)!;
    const secondB = batchItems(second.batchId).find((row) => row.packageId === b)!;
    expect(secondA.version).toBe("1.0");
    expect(secondA.vsOfficial).toBe(0);
    expect(secondA.vsPrevious).toBe(1);
    expect(secondA.previousVersion).toBe("1.1");
    expect(secondB.version).toBe("2.1");
    expect(secondB.vsOfficial).toBe(1);
    expect(getPackagesPayload(w.projectId, w.pm).testBatches.map((batch) => batch.code)).toEqual([second.code, first.code]);
  });
});

describe("在测跟踪与测试结论", () => {
  it("在测跟踪跨批次汇总未出结论的转测包", () => {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    const b = makePackage("PKG-B", "2.0", w.cpuGroupId);
    const first = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(a, "1.1")], title: "第一批" });
    const second = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(b, "2.1")], title: "第二批" });

    let payload = getPackagesPayload(w.projectId, w.pm);
    expect(payload.stats.openTest).toBe(2);
    expect(payload.openTestItems.map((item) => item.packageCode).sort()).toEqual(["PKG-A", "PKG-B"]);
    const secondItem = payload.openTestItems.find((item) => item.packageId === b)!;
    expect(secondItem.batchId).toBe(second.batchId);
    expect(secondItem.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    concludeItem(w.projectId, first.batchId, itemId(first.batchId, a), w.repairLeader, { conclusion: "PASS", note: "通过" });
    payload = getPackagesPayload(w.projectId, w.pm);
    expect(payload.stats.openTest).toBe(1);
    expect(payload.openTestItems[0].packageCode).toBe("PKG-B");
  });

  it("测试结论给出后总览不再显示测试版本，且可提交转验证", () => {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    const { batchId } = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(a, "1.1")] });
    expect(packageState(a).testVersion).toBe("1.1");
    concludeItem(w.projectId, batchId, itemId(batchId, a), w.repairLeader, { conclusion: "PASS", note: "通过" });
    const overview = packageState(a);
    expect(overview.testVersion).toBeNull();
    expect(overview.lastTestConclusion).toBe("PASS");
    const payload = getPackagesPayload(w.projectId, w.pm);
    expect(payload.verifyRequestCandidates.some((item) => item.packageId === a)).toBe(true);
  });

  it("结论仅测试责任组成员或 PM/主管可填写，失败必须说明", () => {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    const { batchId } = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(a, "1.1")] });
    const id = itemId(batchId, a);
    const softwareManager = makeSoftwareManager();
    expect(() => concludeItem(w.projectId, batchId, id, softwareManager, { conclusion: "PASS" })).toThrow(/测试责任组/);
    expect(() => concludeItem(w.projectId, batchId, id, w.repairLeader, { conclusion: "FAIL", note: "" })).toThrow(/说明/);
    expect(() => concludeItem(w.projectId, batchId, id, w.repairLeader, { conclusion: "CONDITIONAL", note: "需复测" })).not.toThrow();
    expect(() => concludeItem(w.projectId, batchId, id, w.pm, { conclusion: "PASS", note: "PM 兜底" })).not.toThrow();
    expect(getPackagesPayload(w.projectId, w.pm).testBatches[0].status).toBe("DONE");
  });

  it("未转测的配套表行不能填写结论", () => {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    const b = makePackage("PKG-B", "2.0", w.cpuGroupId);
    const { batchId } = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(a, "1.1")] });
    expect(() => concludeItem(w.projectId, batchId, itemId(batchId, b), w.repairLeader, { conclusion: "PASS" })).toThrow(/实际转测/);
  });
});

describe("逐包转验证（无批次）", () => {
  function passedTest() {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    const { batchId } = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(a, "1.1")] });
    const id = itemId(batchId, a);
    concludeItem(w.projectId, batchId, id, w.repairLeader, { conclusion: "PASS", note: "通过" });
    return { a, testItemId: id };
  }

  function verifyRequest(a: string, testItemId: string, userId = w.cpuMember): string {
    return createRequest(w.projectId, userId, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: testItemId }).id;
  }

  it("测试通过后该包责任组任意成员都可提交转验证申请", () => {
    const { a, testItemId } = passedTest();
    expect(() => createRequest(w.projectId, w.fanLeader, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: testItemId })).toThrow(/转验证申请/);
    expect(verifyRequest(a, testItemId)).toMatch(/^prq_/);
    expect(getPackagesPayload(w.projectId, w.pm).pendingVerifyRequests).toHaveLength(1);
  });

  it("转验证申请必须基于测试通过记录且版本一致", () => {
    const { a, testItemId } = passedTest();
    expect(() => createRequest(w.projectId, w.cpuLeader, { kind: "VERIFY", packageId: a, version: "9.9", sourceItemId: testItemId })).toThrow(/版本/);
    verifyRequest(a, testItemId);
    expect(() => createRequest(w.projectId, w.cpuLeader, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: testItemId })).toThrow(/已提交/);
  });

  it("转验证不再组织批次", () => {
    const { a, testItemId } = passedTest();
    const requestId = verifyRequest(a, testItemId);
    expect(() => createBatch(w.projectId, w.pm, { kind: "VERIFY", requestIds: [requestId] })).toThrow(/逐个处理/);
  });

  it("软件经理逐包处理时必须填写电子流程链接与验证条码", () => {
    const { a, testItemId } = passedTest();
    const requestId = verifyRequest(a, testItemId);
    expect(() => handleVerification(w.projectId, w.cpuLeader, { requestId, processUrl: PROCESS_URL, barcodes: ["BAR-1"] })).toThrow(/软件经理/);
    expect(() => handleVerification(w.projectId, w.pm, { requestId, processUrl: "", barcodes: ["BAR-1"] })).toThrow(/电子流程/);
    expect(() => handleVerification(w.projectId, w.pm, { requestId, processUrl: PROCESS_URL, barcodes: [] })).toThrow(/条码/);

    const softwareManager = makeSoftwareManager();
    const { verificationId } = handleVerification(w.projectId, softwareManager, {
      requestId,
      processUrl: PROCESS_URL,
      barcodes: ["BAR-1", "BAR-2", "BAR-1"],
    });
    const payload = getPackagesPayload(w.projectId, w.pm);
    expect(payload.pendingVerifyRequests).toHaveLength(0);
    const record = payload.verifications.find((item) => item.id === verificationId)!;
    expect(record.packageId).toBe(a);
    expect(record.version).toBe("1.1");
    expect(record.processUrl).toBe(PROCESS_URL);
    expect(record.barcodes).toEqual(["BAR-1", "BAR-2"]);
    expect(record.conclusion).toBe("PENDING");
    expect(record.handledByName).toBeTruthy();
    expect(packageState(a).status).toBe("IN_VERIFY");
    expect(packageState(a).verificationVersion).toBe("1.1");
  });

  it("处理后可修改电子流程链接与条码，转正后不可再改", () => {
    const { a, testItemId } = passedTest();
    const requestId = verifyRequest(a, testItemId);
    const { verificationId } = handleVerification(w.projectId, w.pm, { requestId, processUrl: PROCESS_URL, barcodes: ["BAR-1"] });
    updateVerification(w.projectId, w.pm, verificationId, { processUrl: "https://flow.example.com/BIOS-2", barcodes: ["BAR-3", "BAR-4"] });
    let record = getPackagesPayload(w.projectId, w.pm).verifications.find((item) => item.id === verificationId)!;
    expect(record.processUrl).toBe("https://flow.example.com/BIOS-2");
    expect(record.barcodes).toEqual(["BAR-3", "BAR-4"]);

    concludeVerification(w.projectId, w.pm, verificationId, { conclusion: "PASS" });
    expect(() => updateVerification(w.projectId, w.pm, verificationId, { barcodes: [] })).toThrow(/条码/);
    promoteVerifications(w.projectId, w.pm, [verificationId]);
    expect(() => updateVerification(w.projectId, w.pm, verificationId, { processUrl: "x" })).toThrow(/已转正/);
    record = getPackagesPayload(w.projectId, w.pm).verifications.find((item) => item.id === verificationId)!;
    expect(record.promoted).toBe(true);
  });

  it("验证条码台账按条码关联软件包、电子流程、结论与转正状态", () => {
    const { a, testItemId } = passedTest();
    const requestId = verifyRequest(a, testItemId);
    const { verificationId } = handleVerification(w.projectId, w.pm, { requestId, processUrl: PROCESS_URL, barcodes: ["BAR-1", "BAR-2"] });
    concludeVerification(w.projectId, w.pm, verificationId, { conclusion: "PASS", note: "验证通过" });
    promoteVerifications(w.projectId, w.pm, [verificationId]);

    const ledger = getPackagesPayload(w.projectId, w.pm).barcodeLedger;
    expect(ledger).toHaveLength(2);
    const entry = ledger.find((item) => item.barcode === "BAR-2")!;
    expect(entry.packageId).toBe(a);
    expect(entry.processUrl).toBe(PROCESS_URL);
    expect(entry.conclusion).toBe("PASS");
    expect(entry.promoted).toBe(true);
    expect(entry.verificationId).toBe(verificationId);
  });
});

describe("转正与历史", () => {
  function verified() {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    makePackage("PKG-B", "2.0", w.fanGroupId);
    const testBatch = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(a, "1.1")] });
    const testItem = itemId(testBatch.batchId, a);
    concludeItem(w.projectId, testBatch.batchId, testItem, w.repairLeader, { conclusion: "PASS" });
    const request = createRequest(w.projectId, w.cpuMember, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: testItem }).id;
    const { verificationId } = handleVerification(w.projectId, w.pm, { requestId: request, processUrl: PROCESS_URL, barcodes: ["BAR-1", "BAR-2"] });
    return { a, verificationId };
  }

  it("只有验证通过且未转正的软件包可以转正，转正后正式版本更新", () => {
    const { a, verificationId } = verified();
    expect(() => promoteVerifications(w.projectId, w.pm, [verificationId])).toThrow(/验证结论/);
    concludeVerification(w.projectId, w.pm, verificationId, { conclusion: "PASS", note: "验证通过" });
    expect(() => promoteVerifications(w.projectId, w.cpuLeader, [verificationId])).toThrow(/PM/);
    expect(promoteVerifications(w.projectId, w.pm, [verificationId]).promoted).toBe(1);
    const pkg = packageState(a);
    expect(pkg.officialVersion).toBe("1.1");
    expect(pkg.verificationVersion).toBe("1.1");
    expect(pkg.status).toBe("OFFICIAL");
    expect(getPackagesPayload(w.projectId, w.pm).promoteCandidates).toHaveLength(0);
    expect(() => promoteVerifications(w.projectId, w.pm, [verificationId])).toThrow(/验证结论/);
  });

  it("有流转记录的软件包不能删除", () => {
    const { a } = verified();
    expect(() => deletePackage(w.projectId, a, w.pm)).toThrow(/不能删除/);
    const clean = makePackage("PKG-CLEAN", "1.0", w.cpuGroupId);
    expect(() => deletePackage(w.projectId, clean, w.pm)).not.toThrow();
  });

  it("历史按时间倒序记录申请、批次、转验证处理、结论与转正", () => {
    const { a, verificationId } = verified();
    concludeVerification(w.projectId, w.pm, verificationId, { conclusion: "PASS", note: "验证通过" });
    promoteVerifications(w.projectId, w.pm, [verificationId]);

    const history = getPackageHistory(w.projectId, a, w.pm);
    const types = history.events.map((event) => event.type);
    expect(types).toContain("REQUEST");
    expect(types).toContain("BATCH");
    expect(types).toContain("VERIFICATION");
    expect(types).toContain("CONCLUSION");
    expect(types).toContain("PROMOTE");
    expect(history.package.officialVersion).toBe("1.1");
    for (let index = 0; index < history.events.length - 1; index += 1) {
      expect(history.events[index].at >= history.events[index + 1].at).toBe(true);
    }
    expect(history.events[0].type).toBe("PROMOTE");
    expect(history.events[0].processUrl).toBe(PROCESS_URL);
    expect(history.events.some((event) => event.processUrl === PROCESS_URL)).toBe(true);
    expect(history.events[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("转正后可继续提交下一次转测试，状态回到待组织", () => {
    const { a, verificationId } = verified();
    concludeVerification(w.projectId, w.pm, verificationId, { conclusion: "PASS" });
    promoteVerifications(w.projectId, w.pm, [verificationId]);
    submitTest(a, "1.2");
    const pkg = packageState(a);
    expect(pkg.status).toBe("TEST_PENDING");
    expect(pkg.officialVersion).toBe("1.1");
  });
});
