"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, MapPin, RadioTower, Server, WandSparkles } from "lucide-react";
import { Modal } from "@/components/Modal";
import { apiFetch, errorMessage } from "@/lib/client-api";
import type { GroupDirectoryEntry } from "@/components/issues/types";
import type { ProjectCategory } from "@/lib/issues";

interface EntryModalProps {
  projectId: string;
  groups: GroupDirectoryEntry[];
  defaultGroupIds: string[];
  categories: ProjectCategory[];
  onClose: () => void;
  onCreated: (barcodeId: string, barcodeLabel: string) => void;
}

interface HostLookup {
  host: { hostIp: string; hostAccount: string | null } | null;
}

interface StubDevice {
  barcode: string;
  deviceIp: string;
  hostIp: string | null;
  source: string;
  note: string;
}

export function EntryModal({ projectId, groups, defaultGroupIds, categories, onClose, onCreated }: EntryModalProps) {
  const enabledGroups = groups.filter((group) => group.enabled);
  const initialGroups = defaultGroupIds.filter((id) => enabledGroups.some((group) => group.id === id));
  const [barcode, setBarcode] = useState("");
  const [locationNo, setLocationNo] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>(initialGroups);
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [remark, setRemark] = useState("");
  const [deviceIp, setDeviceIp] = useState("");
  const [host, setHost] = useState<{ hostIp: string; hostAccount: string | null } | null>(null);
  const [pending, setPending] = useState(false);
  const [stubLoading, setStubLoading] = useState(false);
  const [error, setError] = useState("");
  const [stubNote, setStubNote] = useState("");

  async function lookupHost(value: string) {
    if (!value.trim()) {
      setHost(null);
      return;
    }
    try {
      const result = await apiFetch<HostLookup>(`/api/projects/${projectId}/location-host?locationNo=${encodeURIComponent(value.trim())}`);
      setHost(result.host);
    } catch {
      setHost(null);
    }
  }

  useEffect(() => {
    if (!locationNo.trim()) {
      setHost(null);
      return;
    }
    const timeout = window.setTimeout(() => void lookupHost(locationNo), 450);
    return () => window.clearTimeout(timeout);
  }, [locationNo]);

  async function readCurrentDevice() {
    setError("");
    if (!locationNo.trim()) {
      setError("请先填写库位号");
      return;
    }
    setStubLoading(true);
    try {
      const result = await apiFetch<{ device: StubDevice }>(
        `/api/projects/${projectId}/integrations/current-device?locationNo=${encodeURIComponent(locationNo.trim())}`,
      );
      setBarcode(result.device.barcode);
      setDeviceIp(result.device.deviceIp);
      setStubNote(result.device.note);
      setHost(result.device.hostIp ? { hostIp: result.device.hostIp, hostAccount: host?.hostAccount ?? null } : null);
    } catch (readError) {
      setError(errorMessage(readError));
    } finally {
      setStubLoading(false);
    }
  }

  function toggleGroup(id: string) {
    setGroupIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (groupIds.length === 0) {
      setError("请选择至少一个参与责任组");
      return;
    }
    setPending(true);
    try {
      const created = await apiFetch<{ barcodeId: string; issueId: string }>(`/api/projects/${projectId}/issues`, {
        method: "POST",
        body: JSON.stringify({
          barcode: barcode.trim(),
          locationNo: locationNo.trim(),
          groupIds,
          categoryId: categoryId || null,
          priority,
          remark,
          deviceIp: deviceIp || null,
        }),
      });
      onCreated(created.barcodeId, barcode.trim());
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      title="录入问题"
      description="录入条码后，系统会按每个参与责任组的当前排班解析处理人并发送通知。"
      size="lg"
      onClose={() => (pending ? null : onClose())}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>取消</button>
          <button type="submit" form="entry-form" className="btn btn-primary" disabled={pending || groups.length === 0}>
            {pending ? <LoaderCircle size={14} className="spin" /> : null}
            {pending ? "录入中…" : "确认录入并分配"}
          </button>
        </>
      }
    >
      <form id="entry-form" onSubmit={submit} className="form-grid">
        <div className="field full">
          <label>库位号 <span className="required">*</span></label>
          <div className="inline-form">
            <input className="input" value={locationNo} onChange={(event) => setLocationNo(event.target.value)} placeholder="例如 A-01" required maxLength={50} />
            <button type="button" className="btn btn-soft" onClick={() => void readCurrentDevice()} disabled={stubLoading}>
              {stubLoading ? <LoaderCircle size={14} className="spin" /> : <WandSparkles size={14} />}
              从设备接口读取
            </button>
          </div>
          <div className="field-hint" style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <MapPin size={11} /> 当前库位关联：
            {host ? <><Server size={11} /> {host.hostIp}{host.hostAccount ? ` / ${host.hostAccount}` : ""}</> : "未维护云主机映射，录入后仍可手动补录基础信息"}
          </div>
          {stubNote ? <div className="hint" style={{ color: "var(--primary)" }}>{stubNote}</div> : null}
        </div>
        <div className="field">
          <label htmlFor="barcode">条码 <span className="required">*</span></label>
          <input id="barcode" className="input" value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="扫描或输入设备条码" required maxLength={100} />
        </div>
        <div className="field">
          <label>设备在云主机中的 IP</label>
          <input className="input" value={deviceIp} onChange={(event) => setDeviceIp(event.target.value)} placeholder="可通过设备接口自动获取" maxLength={100} />
        </div>
        <div className="field full">
          <label>参与责任组 <span className="required">*</span></label>
          <div className="choice-grid">
            {enabledGroups.map((group) => (
              <label className={`choice ${groupIds.includes(group.id) ? "selected" : ""}`} key={group.id}>
                <input type="checkbox" checked={groupIds.includes(group.id)} onChange={() => toggleGroup(group.id)} />
                <span>
                  <strong>{group.name}</strong>
                  <small>{group.members.filter((member) => member.isLeader).map((member) => member.name).join("、") || "暂无负责人"}</small>
                </span>
              </label>
            ))}
          </div>
          {enabledGroups.length === 0 ? <div className="alert alert-warning">项目尚未启用任何责任组，请联系项目 PM 先配置责任组。</div> : null}
          <div className="field-hint">可多选；未选择时若项目配置了默认责任组则自动使用默认责任组。所有责任组共同参与问题定位。</div>
        </div>
        <div className="field">
          <label>问题分类</label>
          <select className="select" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">不分类</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>优先级</label>
          <select className="select" value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="HIGH">高</option>
            <option value="MEDIUM">中</option>
            <option value="LOW">低</option>
          </select>
        </div>
        <div className="field full">
          <label>备注</label>
          <textarea className="textarea" value={remark} onChange={(event) => setRemark(event.target.value)} maxLength={1000} placeholder="补充现场现象、测试阶段、初步观察等" />
        </div>
        {error ? <div className="alert alert-error full">{error}</div> : null}
        <div className="callout-strip full">
          <RadioTower size={14} /> 录入后系统按「参与责任组 + 当前星期 + 当前时间段」解析处理人；多人被解析时全部接收通知，其中待处理数少者为主处理人。
        </div>
      </form>
    </Modal>
  );
}
