import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createBarcode, getBarcodeDetail, getProjectStatuses, listBarcodes } from "@/lib/issues";
import { createWorld, makeTestEnv, type TestEnv, type TestWorld } from "./helpers";

let env: TestEnv;
let w: TestWorld;
beforeEach(() => {
  env = makeTestEnv();
  w = createWorld();
});
afterEach(() => { env.cleanup(); });

const DAY1 = new Date("2026-09-07T01:00:00Z"); // 2026-09-07 09:00 Asia/Shanghai
const DAY2 = new Date("2026-09-08T01:00:00Z");

function entry(barcode: string, now: Date = DAY1, extra: { errorItem?: string; append?: boolean } = {}) {
  return createBarcode(
    w.projectId,
    w.cpuMember,
    { barcode, locationNo: "A-01", groupIds: [w.cpuGroupId], priority: "MEDIUM", ...extra },
    { now },
  );
}

function listOn(from: string, to: string, openOnly = false) {
  return listBarcodes(w.projectId, w.pm, { entryFrom: from, entryTo: to, openOnly, pageSize: 50 });
}

describe("同一条码多次录入", () => {
  it("同一條码分别录入两次，保留独立的录入时间与报错测试项", () => {
    const first = entry("BAR-REPEAT", DAY1, { errorItem: "首次上电失败" });
    expect(() => entry("BAR-REPEAT", DAY1)).toThrow(/此前录入/);
    try {
      entry("BAR-REPEAT", DAY1);
    } catch (error) {
      const details = (error as { details?: { requiresAppend?: boolean; barcodeId?: string } }).details;
      expect(details?.requiresAppend).toBe(true);
      expect(details?.barcodeId).toBe(first.barcodeId);
    }

    const appended = entry("BAR-REPEAT", DAY2, { errorItem: "复测再次报错", append: true });
    expect(appended.appended).toBe(true);
    expect(appended.entryIndex).toBe(2);
    expect(appended.barcodeId).toBe(first.barcodeId);

    const detail = getBarcodeDetail(w.projectId, first.barcodeId, w.pm);
    expect(detail.issues).toHaveLength(2);
    expect(detail.issues[0].errorItem).toBe("首次上电失败");
    expect(detail.issues[1].errorItem).toBe("复测再次报错");
    expect(detail.issues[0].createdAt < detail.issues[1].createdAt).toBe(true);
    expect(detail.issues[1].createdAt).toMatch(/^2026-09-08/);
  });

  it("追加录入会重新解析当前排班处理人并记录责任转移历史", () => {
    const first = entry("BAR-ASSIGN", DAY1);
    const before = getBarcodeDetail(w.projectId, first.barcodeId, w.pm).issues[0].groups;
    entry("BAR-ASSIGN", DAY2, { append: true });
    const detail = getBarcodeDetail(w.projectId, first.barcodeId, w.pm);
    expect(detail.issues).toHaveLength(2);
    expect(detail.issues[1].groups.length).toBe(before.length);
    expect(detail.issues[1].assignmentHistory.some((item) => item.changeType === "ENTRY")).toBe(true);
  });
});

describe("按录入时间筛选与默认未闭环", () => {
  it("默认项目带有「已闭环」状态", () => {
    const closed = getProjectStatuses(w.projectId).filter((status) => status.is_closed === 1);
    expect(closed).toHaveLength(1);
    expect(closed[0].name).toBe("已闭环");
  });

  it("按录入日期范围筛选：不同日期的条码分别命中", () => {
    entry("BAR-D1", DAY1);
    entry("BAR-D2", DAY2);

    const day1 = listOn("2026-09-07", "2026-09-07");
    expect(day1.rows.map((row) => row.barcode)).toEqual(["BAR-D1"]);
    const day2 = listOn("2026-09-08", "2026-09-08");
    expect(day2.rows.map((row) => row.barcode)).toEqual(["BAR-D2"]);
    const both = listOn("2026-09-07", "2026-09-08");
    expect(both.rows.map((row) => row.barcode).sort()).toEqual(["BAR-D1", "BAR-D2"]);
  });

  it("重复录入的条码在任一次录入日期都能被查询到，并显示匹配次数", () => {
    const created = entry("BAR-MULTI", DAY1, { errorItem: "第一次" });
    entry("BAR-MULTI", DAY2, { errorItem: "第二次", append: true });

    const day2 = listOn("2026-09-08", "2026-09-08");
    expect(day2.rows).toHaveLength(1);
    expect(day2.rows[0].id).toBe(created.barcodeId);
    expect(day2.rows[0].entry_count).toBe(2);
    expect(day2.rows[0].matched_entry_count).toBe(1);
    expect(day2.rows[0].last_entry_at).toMatch(/^2026-09-08/);

    const day1 = listOn("2026-09-07", "2026-09-07");
    expect(day1.rows[0].matched_entry_count).toBe(1);
    const both = listOn("2026-09-07", "2026-09-08");
    expect(both.rows[0].matched_entry_count).toBe(2);
  });

  it("「仅未闭环」会排除所有问题项均已闭环的条码", () => {
    const closedStatus = getProjectStatuses(w.projectId).find((status) => status.is_closed === 1)!;
    const open = entry("BAR-OPEN", DAY1);
    const toClose = entry("BAR-CLOSED", DAY1);
    const db = getDb();
    db.prepare("UPDATE issues SET status_id = ? WHERE barcode_id = ?").run(closedStatus.id, toClose.barcodeId);

    const openOnly = listOn("2026-09-07", "2026-09-07", true);
    expect(openOnly.rows.map((row) => row.id)).toEqual([open.barcodeId]);
    expect(openOnly.rows[0].is_closed).toBe(false);

    const all = listOn("2026-09-07", "2026-09-07", false);
    expect(all.rows).toHaveLength(2);
    expect(all.rows.find((row) => row.id === toClose.barcodeId)?.is_closed).toBe(true);
  });

  it("列表按最近录入时间倒序，便于看到最新问题", () => {
    entry("BAR-OLD", DAY1);
    entry("BAR-NEW", DAY2);
    const rows = listOn("2026-09-07", "2026-09-08").rows;
    expect(rows[0].barcode).toBe("BAR-NEW");
  });
});
