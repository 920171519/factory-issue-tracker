import * as XLSX from "xlsx";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireProjectAccess } from "@/lib/access";
import { createBarcode } from "@/lib/issues";
import { getDefaultGroupIds } from "@/lib/issues";
import { getProjectGroups, getProjectCategories } from "@/lib/issues";
import { sendNotifications } from "@/lib/notifications";

const HEADERS = ["条码", "库位号", "参与责任组", "问题分类", "优先级", "备注"] as const;
const MAX_ROWS = 500;

export interface ImportError {
  row: number;
  message: string;
}

export interface ImportResult {
  imported: number;
  failed: number;
  errors: ImportError[];
  barcodeIds: string[];
  notifiedRecipients: number;
}

function cellString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function splitGroups(value: string): string[] {
  return [...new Set(value.split(/[,，、;；/／|]+/).map((item) => item.trim()).filter(Boolean))];
}

function parsePriority(value: string): "HIGH" | "MEDIUM" | "LOW" | null {
  if (!value) return "MEDIUM";
  if (value === "高" || value.toUpperCase() === "HIGH") return "HIGH";
  if (value === "中" || value.toUpperCase() === "MEDIUM") return "MEDIUM";
  if (value === "低" || value.toUpperCase() === "LOW") return "LOW";
  return null;
}

export function buildImportTemplate(projectId: string): Buffer {
  const groups = getProjectGroups(projectId, true);
  const defaults = getDefaultGroupIds(projectId).map((id) => groups.find((group) => group.id === id)?.name).filter(Boolean);
  const categories = getProjectCategories(projectId);
  const dataSheet = XLSX.utils.aoa_to_sheet([[...HEADERS]]);
  dataSheet["!cols"] = [
    { wch: 24 },
    { wch: 14 },
    { wch: 28 },
    { wch: 16 },
    { wch: 10 },
    { wch: 36 },
  ];
  const instructionRows: (string | number)[][] = [
    ["批量导入填写说明"],
    ["1. 第 1 行为表头，请勿修改；从第 2 行开始填写，一行代表一个条码。"],
    ["2. 条码和库位号为必填；条码在同一项目内不可重复。建议将条码、库位号列设置为文本格式。"],
    ["3. 参与责任组可填写一个或多个，多个用顿号、逗号、分号或斜杠分隔。"],
    [`4. 参与责任组留空时使用项目默认责任组：${defaults.length ? defaults.join("、") : "当前项目未配置默认责任组，留空将报错"}。`],
    ["5. 优先级可填：高、中、低；留空默认为中。"],
    ["6. 问题分类必须是以下已配置分类之一，留空表示不分类。"],
    [`已配置分类：${categories.length ? categories.map((item) => item.name).join("、") : "无"}`],
    ["7. 导入后系统按每个参与责任组 + 当前星期 + 当前时间段排班解析处理人；排班缺失时按兜底规则分配。"],
    ["8. 本系统当前每行只会创建一个条码初始问题，报错项可在问题详情中继续追加。"],
  ];
  const instructionSheet = XLSX.utils.aoa_to_sheet(instructionRows);
  instructionSheet["!cols"] = [{ wch: 110 }];
  const groupRows: (string | number)[][] = [
    ["责任组", "组负责人", "默认处理人", "兜底处理人"],
  ];
  const db = getDb();
  for (const group of groups) {
    const members = db
      .prepare(
        `SELECT u.name, gm.is_leader, gm.is_default_assignee, gm.is_fallback_assignee
         FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY u.name`,
      )
      .all(group.id) as { name: string; is_leader: number; is_default_assignee: number; is_fallback_assignee: number }[];
    groupRows.push([
      group.name,
      members.filter((member) => member.is_leader === 1).map((member) => member.name).join("、") || "—",
      members.find((member) => member.is_default_assignee === 1)?.name || "—",
      members.find((member) => member.is_fallback_assignee === 1)?.name || "—",
    ]);
  }
  const groupSheet = XLSX.utils.aoa_to_sheet(groupRows);
  groupSheet["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, dataSheet, "问题导入");
  XLSX.utils.book_append_sheet(wb, instructionSheet, "填写说明");
  XLSX.utils.book_append_sheet(wb, groupSheet, "责任组参考");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function importIssuesFromExcel(
  projectId: string,
  userId: string,
  fileBuffer: Buffer,
): ImportResult {
  requireProjectAccess(userId, projectId);
  if (!fileBuffer || fileBuffer.length === 0) throw new AppError(400, "请选择要导入的 Excel 文件");
  if (fileBuffer.length > 10 * 1024 * 1024) throw new AppError(400, "Excel 文件不能超过 10MB");
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(fileBuffer, { type: "buffer", cellDates: false });
  } catch {
    throw new AppError(400, "无法解析 Excel 文件，请使用系统提供的模板");
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new AppError(400, "Excel 文件中没有工作表");
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
  if (matrix.length === 0) throw new AppError(400, "Excel 内容为空");
  const header = (matrix[0] as unknown[]).map((cell) => cellString(cell));
  const indexes = new Map<string, number>();
  for (const expected of HEADERS) {
    const index = header.findIndex((cell) => cell === expected);
    if (index === -1) throw new AppError(400, `模板缺少表头「${expected}」，请下载最新模板`);
    indexes.set(expected, index);
  }
  const dataRows = matrix.slice(1).filter((row) => (row as unknown[]).some((cell) => cellString(cell) !== ""));
  if (dataRows.length === 0) throw new AppError(400, "Excel 中没有可导入的数据行");
  if (dataRows.length > MAX_ROWS) throw new AppError(400, `单次最多导入 ${MAX_ROWS} 行`);

  const groups = getProjectGroups(projectId, true);
  const groupByName = new Map(groups.map((group) => [group.name, group]));
  const defaultGroupNames = getDefaultGroupIds(projectId)
    .map((id) => groups.find((group) => group.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const categories = getProjectCategories(projectId);
  const categoryByName = new Map(categories.map((category) => [category.name, category]));
  const db = getDb();
  const errors: ImportError[] = [];
  const prepared: {
    row: number;
    barcode: string;
    locationNo: string;
    groupIds: string[];
    categoryId: string | null;
    priority: "HIGH" | "MEDIUM" | "LOW";
    remark: string;
  }[] = [];
  const seenBarcodes = new Set<string>();

  dataRows.forEach((rawRow, index) => {
    const rowNumber = index + 2;
    const row = rawRow as unknown[];
    const barcode = cellString(row[indexes.get("条码")!]);
    const locationNo = cellString(row[indexes.get("库位号")!]);
    const groupCell = cellString(row[indexes.get("参与责任组")!]);
    const categoryCell = cellString(row[indexes.get("问题分类")!]);
    const priorityCell = cellString(row[indexes.get("优先级")!]);
    const remark = cellString(row[indexes.get("备注")!]);
    if (!barcode) {
      errors.push({ row: rowNumber, message: "条码不能为空" });
      return;
    }
    if (barcode.length > 100) {
      errors.push({ row: rowNumber, message: "条码长度不能超过 100 个字符" });
      return;
    }
    if (!locationNo) {
      errors.push({ row: rowNumber, message: "库位号不能为空" });
      return;
    }
    if (seenBarcodes.has(barcode)) {
      errors.push({ row: rowNumber, message: "文件内条码重复" });
      return;
    }
    seenBarcodes.add(barcode);
    const existing = db.prepare("SELECT 1 FROM barcodes WHERE project_id = ? AND barcode = ?").get(projectId, barcode);
    if (existing) {
      errors.push({ row: rowNumber, message: "该条码已在项目中录入" });
      return;
    }
    const groupNames = groupCell ? splitGroups(groupCell) : defaultGroupNames;
    if (groupNames.length === 0) {
      errors.push({ row: rowNumber, message: "参与责任组为空且项目未配置默认责任组" });
      return;
    }
    const groupIds: string[] = [];
    const unknownGroups: string[] = [];
    for (const name of groupNames) {
      const group = groupByName.get(name);
      if (!group) unknownGroups.push(name);
      else groupIds.push(group.id);
    }
    if (unknownGroups.length > 0) {
      errors.push({ row: rowNumber, message: `责任组不存在或已停用：${unknownGroups.join("、")}` });
      return;
    }
    let categoryId: string | null = null;
    if (categoryCell) {
      const category = categoryByName.get(categoryCell);
      if (!category) {
        errors.push({ row: rowNumber, message: `问题分类不存在：${categoryCell}` });
        return;
      }
      categoryId = category.id;
    }
    const priority = parsePriority(priorityCell);
    if (!priority) {
      errors.push({ row: rowNumber, message: "优先级必须为高、中、低之一" });
      return;
    }
    prepared.push({ row: rowNumber, barcode, locationNo, groupIds, categoryId, priority, remark });
  });

  const importedBarcodes: string[] = [];
  const recipientsByUser = new Map<string, Set<string>>();
  const importNow = new Date();
  for (const item of prepared) {
    try {
      const result = createBarcode(
        projectId,
        userId,
        {
          barcode: item.barcode,
          locationNo: item.locationNo,
          groupIds: item.groupIds,
          categoryId: item.categoryId,
          priority: item.priority,
          remark: item.remark,
        },
        { notify: false, now: importNow },
      );
      importedBarcodes.push(result.barcodeId);
      for (const recipient of result.recipientIds) {
        const set = recipientsByUser.get(recipient) || new Set<string>();
        set.add(result.barcodeId);
        recipientsByUser.set(recipient, set);
      }
    } catch (error) {
      errors.push({
        row: item.row,
        message: error instanceof Error ? error.message : "导入失败",
      });
    }
  }

  let notifiedRecipients = 0;
  for (const [recipientId, barcodeIds] of recipientsByUser) {
    notifiedRecipients += sendNotifications({
      projectId,
      recipientIds: [recipientId],
      title: "批量导入问题分配",
      body: `批量导入已为你分配 ${barcodeIds.size} 个条码的问题，请及时跟进。`,
      barcodeIds: [...barcodeIds],
    });
  }

  errors.sort((a, b) => a.row - b.row);
  return {
    imported: importedBarcodes.length,
    failed: errors.length,
    errors,
    barcodeIds: importedBarcodes,
    notifiedRecipients,
  };
}

export function importErrorSummary(errors: ImportError[], max = 12): string {
  return errors
    .slice(0, max)
    .map((error) => `第 ${error.row} 行：${error.message}`)
    .join("；");
}