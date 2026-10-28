import { z } from "zod";

export const statusUpdateSchema = z.object({
  statusId: z.string().trim().min(1, "请选择状态"),
  reasonHtml: z.string().max(50000, "原因内容过长").optional().default(""),
  confirmed: z.boolean(),
});

export const transferSchema = z.object({
  mode: z.enum(["INTRA", "CROSS"]),
  reasonHtml: z.string().min(1, "请填写定位结论或转移原因").max(50000, "原因内容过长"),
  groupId: z.string().trim().optional(),
  targetUserId: z.string().trim().optional(),
  targetGroupIds: z.array(z.string().trim()).max(20).optional(),
  retainedGroupIds: z.array(z.string().trim()).max(20).optional(),
});

export const transferBarcodeSchema = transferSchema;
export const transferBulkSchema = transferSchema.extend({
  barcodeIds: z.array(z.string().trim()).min(1, "请选择条码").max(500),
});

export const batchStatusSchema = z.object({
  barcodeIds: z.array(z.string().trim()).min(1, "请选择条码").max(500),
  statusId: z.string().trim().min(1, "请选择状态"),
  reasonHtml: z.string().max(50000).optional().default(""),
  confirmed: z.boolean(),
});

export const deleteRequestSchema = z.object({
  barcodeIds: z.array(z.string().trim()).min(1, "请选择条码").max(500),
});

export const trackingGroupsSchema = z.object({
  trackingGroups: z.array(z.string().trim().max(100)).max(20),
});

export const createIssueSchema = z.object({
  barcode: z.string().trim().min(1, "请输入条码").max(100, "条码过长"),
  locationNo: z.string().trim().min(1, "请输入库位号").max(50, "库位号过长"),
  groupIds: z.array(z.string().trim()).max(20).optional().default([]),
  categoryId: z.string().trim().nullable().optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().default("MEDIUM"),
  remark: z.string().trim().max(1000, "备注最多 1000 字").optional().default(""),
  deviceIp: z.string().trim().max(100).nullable().optional(),
});

export const errorItemSchema = z.object({
  errorItem: z.string().trim().min(1, "请填写报错测试项").max(500, "报错测试项过长"),
});
