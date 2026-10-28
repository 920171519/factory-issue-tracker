import { randomInt } from "node:crypto";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireProjectAccess } from "@/lib/access";
import { todayLocal } from "@/lib/time";

export interface StubDevice {
  barcode: string;
  deviceIp: string;
  hostIp: string | null;
  source: "STUB";
  note: string;
}

/**
 * 已知设备测试接口的桩实现。真实环境可替换为 MES / 设备测试平台查询。
 * 桩会基于库位生成一条当前测试条码，并返回该设备在云主机中的模拟 IP。
 */
export function getStubCurrentDevice(projectId: string, userId: string, locationNoInput: string): StubDevice {
  requireProjectAccess(userId, projectId);
  const locationNo = locationNoInput.trim();
  if (!locationNo) throw new AppError(400, "请先输入库位号");
  const db = getDb();
  const host = db
    .prepare("SELECT host_ip FROM location_hosts WHERE project_id = ? AND location_no = ?")
    .get(projectId, locationNo) as { host_ip: string } | undefined;
  const datePart = todayLocal().replaceAll("-", "");
  let barcode = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = randomInt(1000, 9999);
    const candidate = `SIM-${locationNo.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase()}-${datePart.slice(4)}-${suffix}`;
    const exists = db.prepare("SELECT 1 FROM barcodes WHERE project_id = ? AND barcode = ?").get(projectId, candidate);
    if (!exists) {
      barcode = candidate;
      break;
    }
  }
  if (!barcode) throw new AppError(409, "生成模拟条码失败，请重试");
  const octets = host?.host_ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  const prefix = octets ? `${octets[1]}.${octets[2]}.${octets[3]}` : "10.88.0";
  const deviceIp = `${prefix}.${randomInt(20, 240)}`;
  return {
    barcode,
    deviceIp,
    hostIp: host?.host_ip || null,
    source: "STUB",
    note: host
      ? "来自设备测试接口桩；录入时将自动关联库位云主机。"
      : "来自设备测试接口桩；当前库位尚未维护云主机映射，仍可手动录入问题。",
  };
}
