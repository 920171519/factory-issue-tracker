import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { updateProjectMemberRoles } from "@/lib/projects";
import { createWorld, makeTestEnv, type TestEnv, type TestWorld } from "./helpers";
import {
  concludeItem,
  createBatch,
  createPackage,
  createRequest,
  deletePackage,
  getPackageHistory,
  getPackagesPayload,
  promoteItems,
  setItemBarcodes,
  setTesterGroup,
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

function makePackage(code: string, version: string, groupId: string | null, ownerId: string | null = null): string {
  return createPackage(w.projectId, w.pm, { code, description: `${code} 描述`, version, groupId, ownerId }).id;
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
    .prepare("SELECT package_id AS packageId, version, official_version AS officialVersion, updated_vs_official AS vsOfficial, updated_vs_previous AS vsPrevious, previous_version AS previousVersion, request_id AS requestId, conclusion, barcodes FROM package_batch_items WHERE batch_id = ?")
    .all(batchId) as {
    packageId: string;
    version: string | null;
    officialVersion: string | null;
    vsOfficial: number;
    vsPrevious: number;
    previousVersion: string | null;
    requestId: string | null;
    conclusion: string;
    barcodes: string;
  }[];
}

function itemId(batchId: string, packageId: string): string {
  const row = getDb()
    .prepare("SELECT id FROM package_batch_items WHERE batch_id = ? AND package_id = ?")
    .get(batchId, packageId) as { id: string } | undefined;
  if (!row) throw new Error("批次条目不存");
  return row.id;
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

  it("未分配责任组的软件包不能提交转测试申请", () => {
    const orphan = makePackage("PKG-ORPHAN", "1.0", null);
    expect(() => submitTest(orphan, "1.1")).toThrow(/责任组/);
  });

  it("项目成员都能提交，但只能选择自己责任组内的软件包", () => {
    const pkg = makePackage("PKG-A", "1.0", w.cpuGroupId);
    // 风扇组负责人不属于 CPU 组 → 拒绝。
    expect(() => submitTest(pkg, "1.1", w.fanLeader)).toThrow(/自己责任组/);
    // 项目成员但不在任何责任组 → 拒绝。
    expect(() => submitTest(pkg, "1.1", w.tester)).toThrow(/自己责任组/);
    // 同组成员可以提交。
    expect(() => submitTest(pkg, "1.1", w.cpuMember)).not.toThrow();
    expect(() => submitTest(pkg, "1.1", w.cpuMember)).toThrow(/已有待组织/);
    // PM / 主管 / 软件经理可代任意责任组提交。
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

  it("软件经理、PM、主管可组织批次，责任组负责人不再具备组织权限", () => {
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
    const rowC = items.find((row) => row.packageId === c)!;
    expect(rowA.version).toBe("1.1");
    expect(rowA.officialVersion).toBe("1.0");
    expect(rowA.vsOfficial).toBe(1);
    expect(rowA.vsPrevious).toBe(1);
    expect(rowA.requestId).toBeTruthy();
    expect(rowB.version).toBe("2.0");
    expect(rowB.vsOfficial).toBe(0);
    expect(rowB.vsPrevious).toBe(0);
    expect(rowB.requestId).toBeNull();
    expect(rowC.version).toBe("3.0");

    const payload = getPackagesPayload(w.projectId, w.pm);
    expect(payload.testBatches).toHaveLength(1);
    expect(payload.testBatches[0].transferredCount).toBe(1);
    expect(payload.packages.find((pkg) => pkg.id === a)?.testVersion).toBe("1.1");
    expect(payload.packages.find((pkg) => pkg.id === b)?.testVersion).toBeNull();
  });

  it("连续两次转测：分别标注相较正式版本与相较上一批转测版本", () => {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    const b = makePackage("PKG-B", "2.0", w.cpuGroupId);
    const first = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(a, "1.1")], title: "第一批" });
    const firstA = batchItems(first.batchId).find((row) => row.packageId === a)!;
    const firstB = batchItems(first.batchId).find((row) => row.packageId === b)!;
    expect(firstA.vsOfficial).toBe(1);
    expect(firstA.vsPrevious).toBe(1);
    expect(firstB.vsPrevious).toBe(0);

    const second = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(b, "2.1")], title: "第二批" });
    const secondA = batchItems(second.batchId).find((row) => row.packageId === a)!;
    const secondB = batchItems(second.batchId).find((row) => row.packageId === b)!;
    expect(secondA.version).toBe("1.0");
    expect(secondA.vsOfficial).toBe(0);
    expect(secondA.vsPrevious).toBe(1);
    expect(secondA.previousVersion).toBe("1.1");
    expect(secondB.version).toBe("2.1");
    expect(secondB.vsOfficial).toBe(1);
    expect(secondB.vsPrevious).toBe(1);

    const payload = getPackagesPayload(w.projectId, w.pm);
    expect(payload.testBatches.map((batch) => batch.code)).toEqual([second.code, first.code]);
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
    expect(secondItem.batchCode).toBe(second.code);
    expect(secondItem.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    concludeItem(w.projectId, first.batchId, itemId(first.batchId, a), w.repairLeader, { conclusion: "PASS", note: "通过" });
    payload = getPackagesPayload(w.projectId, w.pm);
    expect(payload.stats.openTest).toBe(1);
    expect(payload.openTestItems[0].packageCode).toBe("PKG-B");
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
    const payload = getPackagesPayload(w.projectId, w.pm);
    expect(payload.testBatches[0].status).toBe("DONE");
    expect(payload.testBatches[0].summary.pass).toBe(1);
  });

  it("未转测的配套表行不能填写结论", () => {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    const b = makePackage("PKG-B", "2.0", w.cpuGroupId);
    const { batchId } = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(a, "1.1")] });
    expect(() => concludeItem(w.projectId, batchId, itemId(batchId, b), w.repairLeader, { conclusion: "PASS" })).toThrow(/实际转测/);
  });
});

describe("转验证与条码", () => {
  function passedTest() {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    const { batchId } = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(a, "1.1")] });
    const id = itemId(batchId, a);
    concludeItem(w.projectId, batchId, id, w.repairLeader, { conclusion: "PASS", note: "通过" });
    return { a, batchId, testItemId: id };
  }

  it("测试通过后该包责任组任意成员都可提交转验证申请", () => {
    const { a, testItemId } = passedTest();
    expect(() => createRequest(w.projectId, w.fanLeader, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: testItemId })).toThrow(/转验证申请/);
    const requestId = createRequest(w.projectId, w.cpuMember, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: testItemId }).id;
    expect(requestId).toMatch(/^prq_/);
    expect(getPackagesPayload(w.projectId, w.pm).pendingVerifyRequests.map((request) => request.id)).toContain(requestId);
  });

  it("转验证申请必须基于测试通过记录且版本一致", () => {
    const { a, testItemId } = passedTest();
    expect(() => createRequest(w.projectId, w.cpuLeader, { kind: "VERIFY", packageId: a, version: "9.9", sourceItemId: testItemId })).toThrow(/版本/);
    createRequest(w.projectId, w.cpuLeader, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: testItemId });
    expect(() => createRequest(w.projectId, w.cpuLeader, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: testItemId })).toThrow(/已提交/);
  });

  it("组织转验证时必须逐包填写验证条码，之后仍可修改", () => {
    const { a, testItemId } = passedTest();
    makePackage("PKG-B", "2.0", w.cpuGroupId);
    const verifyRequest = createRequest(w.projectId, w.cpuMember, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: testItemId }).id;
    expect(() => createBatch(w.projectId, w.pm, { kind: "VERIFY", requestIds: [verifyRequest] })).toThrow(/验证条码/);

    const { batchId } = createBatch(w.projectId, w.pm, {
      kind: "VERIFY",
      requestIds: [verifyRequest],
      barcodes: [{ requestId: verifyRequest, barcodes: ["BAR-1", "BAR-2", "BAR-1"] }],
    });
    const items = batchItems(batchId);
    expect(items).toHaveLength(1);
    expect(items[0].packageId).toBe(a);
    expect(items[0].version).toBe("1.1");
    expect(JSON.parse(items[0].barcodes)).toEqual(["BAR-1", "BAR-2"]);

    const verifyItem = itemId(batchId, a);
    setItemBarcodes(w.projectId, batchId, verifyItem, w.repairLeader, ["BAR-3", "BAR-4"]);
    const payload = getPackagesPayload(w.projectId, w.pm);
    expect(payload.verifyBatches[0].items[0].barcodes).toEqual(["BAR-3", "BAR-4"]);
    expect(payload.barcodeLedger.map((entry) => entry.barcode).sort()).toEqual(["BAR-3", "BAR-4"]);
    expect(() => setItemBarcodes(w.projectId, batchId, itemId(batchId, a), w.repairLeader, ["X"])).not.toThrow();
  });

  it("验证条码台账按条码关联软件包、结论与转正状态", () => {
    const { a } = passedTest();
    const testItemId = getPackagesPayload(w.projectId, w.pm).testBatches[0].items.find((item) => item.packageId === a)!.id;
    const requestId = createRequest(w.projectId, w.cpuMember, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: testItemId }).id;
    const { batchId } = createBatch(w.projectId, w.pm, {
      kind: "VERIFY",
      requestIds: [requestId],
      barcodes: [{ requestId, barcodes: ["BAR-1", "BAR-2"] }],
    });
    const verifyItem = itemId(batchId, a);
    concludeItem(w.projectId, batchId, verifyItem, w.repairLeader, { conclusion: "PASS", note: "验证通过" });
    promoteItems(w.projectId, w.pm, batchId, [verifyItem]);

    const payload = getPackagesPayload(w.projectId, w.pm);
    const ledger = payload.barcodeLedger;
    expect(ledger).toHaveLength(2);
    const entry = ledger.find((item) => item.barcode === "BAR-2")!;
    expect(entry.packageId).toBe(a);
    expect(entry.conclusion).toBe("PASS");
    expect(entry.promoted).toBe(true);
    expect(entry.batchId).toBe(batchId);
  });
});

describe("转正与历史", () => {
  function verified() {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    makePackage("PKG-B", "2.0", w.fanGroupId);
    const testBatch = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(a, "1.1")], title: "第一批" });
    const testItem = itemId(testBatch.batchId, a);
    concludeItem(w.projectId, testBatch.batchId, testItem, w.repairLeader, { conclusion: "PASS" });
    const request = createRequest(w.projectId, w.cpuMember, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: testItem }).id;
    const verifyBatch = createBatch(w.projectId, w.pm, {
      kind: "VERIFY",
      requestIds: [request],
      barcodes: [{ requestId: request, barcodes: ["BAR-1", "BAR-2"] }],
    });
    const verifyItem = itemId(verifyBatch.batchId, a);
    return { a, verifyBatchId: verifyBatch.batchId, verifyItem, testItem };
  }

  it("只有验证通过且未转正的软件包可以转正，转正后正式版本更新", () => {
    const { a, verifyBatchId, verifyItem } = verified();
    expect(() => promoteItems(w.projectId, w.pm, verifyBatchId, [verifyItem])).toThrow(/验证结论/);
    concludeItem(w.projectId, verifyBatchId, verifyItem, w.repairLeader, { conclusion: "PASS", note: "验证通过" });
    expect(() => promoteItems(w.projectId, w.cpuLeader, verifyBatchId, [verifyItem])).toThrow(/PM/);
    const result = promoteItems(w.projectId, w.pm, verifyBatchId, [verifyItem]);
    expect(result.promoted).toBe(1);
    const payload = getPackagesPayload(w.projectId, w.pm);
    const pkg = payload.packages.find((entry) => entry.id === a)!;
    expect(pkg.officialVersion).toBe("1.1");
    expect(pkg.verificationVersion).toBe("1.1");
    expect(pkg.status).toBe("OFFICIAL");
    expect(payload.promoteCandidates).toHaveLength(0);
    expect(() => promoteItems(w.projectId, w.pm, verifyBatchId, [verifyItem])).toThrow(/验证结论/);
  });

  it("有流转记录的软件包不能删除", () => {
    const { a } = verified();
    expect(() => deletePackage(w.projectId, a, w.pm)).toThrow(/不能删除/);
    const clean = makePackage("PKG-CLEAN", "1.0", w.cpuGroupId);
    expect(() => deletePackage(w.projectId, clean, w.pm)).not.toThrow();
  });

  it("历史按时间倒序记录申请、批次、结论、条码与转正", () => {
    const { a, verifyBatchId, verifyItem } = verified();
    concludeItem(w.projectId, verifyBatchId, verifyItem, w.repairLeader, { conclusion: "PASS", note: "验证通过" });
    promoteItems(w.projectId, w.pm, verifyBatchId, [verifyItem]);

    const history = getPackageHistory(w.projectId, a, w.pm);
    const types = history.events.map((event) => event.type);
    expect(types).toContain("REQUEST");
    expect(types).toContain("BATCH");
    expect(types).toContain("CONCLUSION");
    expect(types).toContain("BARCODES");
    expect(types).toContain("PROMOTE");
    expect(history.package.officialVersion).toBe("1.1");
    for (let index = 0; index < history.events.length - 1; index += 1) {
      expect(history.events[index].at >= history.events[index + 1].at).toBe(true);
    }
    expect(history.events[0].type).toBe("PROMOTE");
    // 历史时间精确到毫秒 ISO，展示层精确到秒。
    expect(history.events[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("转正后可继续提交下一次转测试，状态回到待组织", () => {
    const { a, verifyBatchId, verifyItem } = verified();
    concludeItem(w.projectId, verifyBatchId, verifyItem, w.repairLeader, { conclusion: "PASS" });
    promoteItems(w.projectId, w.pm, verifyBatchId, [verifyItem]);
    submitTest(a, "1.2");
    const pkg = getPackagesPayload(w.projectId, w.pm).packages.find((entry) => entry.id === a)!;
    expect(pkg.status).toBe("TEST_PENDING");
    expect(pkg.officialVersion).toBe("1.1");
  });
});
