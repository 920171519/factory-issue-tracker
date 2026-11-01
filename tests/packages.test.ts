import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
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

describe("软件包基础能力", () => {
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

  it("仅软件包所属责任组成员或 PM/主管可提交转测试申请", () => {
    const pkg = makePackage("PKG-A", "1.0", w.cpuGroupId);
    expect(() => submitTest(pkg, "1.1", w.fanLeader)).toThrow(/所属责任组/);
    expect(() => submitTest(pkg, "1.1", w.cpuMember)).not.toThrow();
    expect(() => submitTest(pkg, "1.1", w.cpuMember)).toThrow(/已有待组织/);
    expect(() => createRequest(w.projectId, w.pm, { kind: "TEST", packageId: pkg, version: "1.2", ...REQUEST })).not.toThrow();
  });

  it("缺少修改内容或存放链接时拒绝提交", () => {
    const pkg = makePackage("PKG-A", "1.0", w.cpuGroupId);
    expect(() => createRequest(w.projectId, w.cpuLeader, { kind: "TEST", packageId: pkg, version: "1.1", changeSummary: "", packageUrl: "x" })).toThrow(/修改内容/);
    expect(() => createRequest(w.projectId, w.cpuLeader, { kind: "TEST", packageId: pkg, version: "1.1", changeSummary: "改动", packageUrl: "" })).toThrow(/链接/);
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
    const first = createBatch(w.projectId, w.pm, {
      kind: "TEST",
      requestIds: [submitTest(a, "1.1")],
      title: "第一批",
    });
    // 第一批：A 更新，B 未变。
    const firstA = batchItems(first.batchId).find((row) => row.packageId === a)!;
    const firstB = batchItems(first.batchId).find((row) => row.packageId === b)!;
    expect(firstA.vsOfficial).toBe(1);
    expect(firstA.vsPrevious).toBe(1);
    expect(firstB.vsPrevious).toBe(0);

    // 第二批只转 B：A 回到正式版本（相较上一批有变化），B 相较正式版本更新。
    const second = createBatch(w.projectId, w.pm, {
      kind: "TEST",
      requestIds: [submitTest(b, "2.1")],
      title: "第二批",
    });
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

  it("只有 PM / 主管 / 测试责任组负责人可组织批次", () => {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    const requestId = submitTest(a, "1.1");
    expect(() => createBatch(w.projectId, w.cpuLeader, { kind: "TEST", requestIds: [requestId] })).toThrow(/组织/);
    expect(() => createBatch(w.projectId, w.repairLeader, { kind: "TEST", requestIds: [requestId] })).not.toThrow();
  });
});

describe("测试结论与转验证", () => {
  function prepared() {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    const { batchId } = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(a, "1.1")], title: "第一批" });
    return { a, batchId, itemId: itemId(batchId, a) };
  }

  it("结论仅测试责任组成员或 PM/主管可填写，失败必须说明", () => {
    const { batchId, itemId: id } = prepared();
    expect(() => concludeItem(w.projectId, batchId, id, w.cpuLeader, { conclusion: "PASS" })).toThrow(/测试责任组/);
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

  it("转验证申请必须基于测试通过记录且版本一致", () => {
    const { a, batchId, itemId: id } = prepared();
    // 未出结论前不能申请。
    expect(() => createRequest(w.projectId, w.cpuLeader, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: id })).toThrow(/通过/);
    concludeItem(w.projectId, batchId, id, w.repairLeader, { conclusion: "PASS", note: "通过" });
    expect(() => createRequest(w.projectId, w.cpuLeader, { kind: "VERIFY", packageId: a, version: "9.9", sourceItemId: id })).toThrow(/版本/);
    const requestId = createRequest(w.projectId, w.cpuLeader, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: id }).id;
    expect(() => createRequest(w.projectId, w.cpuLeader, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: id })).toThrow(/已提交/);
    expect(getPackagesPayload(w.projectId, w.pm).pendingVerifyRequests.map((request) => request.id)).toContain(requestId);
  });

  it("转验证批次只包含被申请的软件包，并可绑定多个条码", () => {
    const { a, batchId, itemId: id } = prepared();
    makePackage("PKG-B", "2.0", w.cpuGroupId);
    concludeItem(w.projectId, batchId, id, w.repairLeader, { conclusion: "PASS" });
    const verifyRequest = createRequest(w.projectId, w.cpuLeader, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: id }).id;
    const { batchId: verifyBatchId } = createBatch(w.projectId, w.pm, { kind: "VERIFY", requestIds: [verifyRequest] });
    const items = batchItems(verifyBatchId);
    expect(items).toHaveLength(1);
    expect(items[0].packageId).toBe(a);
    expect(items[0].version).toBe("1.1");

    const verifyItem = itemId(verifyBatchId, a);
    setItemBarcodes(w.projectId, verifyBatchId, verifyItem, w.repairLeader, ["BAR-1", "BAR-2", "BAR-1"]);
    const payload = getPackagesPayload(w.projectId, w.pm);
    expect(payload.verifyBatches[0].items[0].barcodes).toEqual(["BAR-1", "BAR-2"]);
    expect(() => setItemBarcodes(w.projectId, batchId, id, w.repairLeader, ["X"])).toThrow(/转验证/);
  });
});

describe("验证结论、转正与历史", () => {
  function verified() {
    const a = makePackage("PKG-A", "1.0", w.cpuGroupId);
    const b = makePackage("PKG-B", "2.0", w.fanGroupId);
    const testBatch = createBatch(w.projectId, w.pm, { kind: "TEST", requestIds: [submitTest(a, "1.1")], title: "第一批" });
    const testItem = itemId(testBatch.batchId, a);
    concludeItem(w.projectId, testBatch.batchId, testItem, w.repairLeader, { conclusion: "PASS" });
    const request = createRequest(w.projectId, w.cpuLeader, { kind: "VERIFY", packageId: a, version: "1.1", sourceItemId: testItem }).id;
    const verifyBatch = createBatch(w.projectId, w.pm, { kind: "VERIFY", requestIds: [request] });
    const verifyItem = itemId(verifyBatch.batchId, a);
    return { a, b, verifyBatchId: verifyBatch.batchId, verifyItem, testItem };
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
    setItemBarcodes(w.projectId, verifyBatchId, verifyItem, w.repairLeader, ["BAR-1"]);
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
    // 时间倒序：时间戳不倒挂，最新事件在最前。
    for (let index = 0; index < history.events.length - 1; index += 1) {
      expect(history.events[index].at >= history.events[index + 1].at).toBe(true);
    }
    expect(history.events[0].type).toBe("PROMOTE");
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
