"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Conclusion, PackageStatus } from "@/lib/packages";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { Modal } from "@/components/Modal";

const STATUS_TONE: Record<PackageStatus, string> = {
  OFFICIAL: "badge-neutral",
  TEST_PENDING: "badge-amber",
  IN_TEST: "badge-blue",
  TEST_PASSED: "badge-teal",
  VERIFY_PENDING: "badge-amber",
  IN_VERIFY: "badge-blue",
  READY: "badge-green",
};

const CONCLUSION_TONE: Record<Conclusion, string> = {
  PENDING: "badge-neutral",
  PASS: "badge-green",
  FAIL: "badge-red",
  CONDITIONAL: "badge-amber",
};

const CONCLUSION_TEXT: Record<Conclusion, string> = {
  PENDING: "待结论",
  PASS: "通过",
  FAIL: "不通过",
  CONDITIONAL: "有条件通过",
};

export function StatusBadge({ status, label }: { status: PackageStatus; label: string }) {
  return <span className={`badge ${STATUS_TONE[status] || "badge-neutral"}`}>{label}</span>;
}

export function ConclusionBadge({ conclusion }: { conclusion: Conclusion }) {
  return <span className={`badge ${CONCLUSION_TONE[conclusion] || "badge-neutral"}`}>{CONCLUSION_TEXT[conclusion]}</span>;
}

export function conclusionText(conclusion: Conclusion): string {
  return CONCLUSION_TEXT[conclusion];
}

/** 配套表专用：相较正式版本 / 相较上一批转测版本是否更新。 */
export function ChangeFlag({ changed, title }: { changed: boolean; title?: string }) {
  return (
    <span className={`change-flag ${changed ? "is-changed" : "is-same"}`} title={title}>
      {changed ? "有更新" : "未变"}
    </span>
  );
}

export function VersionText({ value }: { value: string | null | undefined }) {
  return value ? <span className="mono version-text">{value}</span> : <span className="hint">—</span>;
}

export function BarcodeEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const code = draft.trim();
    if (!code) return;
    if (value.includes(code)) {
      setDraft("");
      return;
    }
    onChange([...value, code]);
    setDraft("");
  }
  return (
    <div className="barcode-editor">
      <div className="chip-list">
        {value.length === 0 ? <span className="hint">尚未绑定条码</span> : value.map((code) => (
          <span key={code} className="chip mono">
            {code}
            {disabled ? null : (
              <button type="button" aria-label={`移除 ${code}`} onClick={() => onChange(value.filter((entry) => entry !== code))}>
                <X size={11} />
              </button>
            )}
          </span>
        ))}
      </div>
      {disabled ? null : (
        <div className="barcode-add">
          <input
            className="input mono"
            value={draft}
            placeholder="输入条码后回车"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={add}><Plus size={12} /> 添加</button>
        </div>
      )}
    </div>
  );
}

export function EmptyHint({ title, description }: { title: string; description?: string }) {
  return (
    <div className="empty-state" style={{ padding: "30px 20px" }}>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

/** 测试 / 验证结论录入弹窗，两个流程共用。 */
export function ConclusionModal({
  kind,
  item,
  submit,
  onClose,
  onSaved,
}: {
  kind: "TEST" | "VERIFY";
  item: { id: string; packageCode: string; version: string | null; officialVersion: string | null; conclusion: Conclusion; conclusionNote: string; changeSummary?: string };
  submit: (conclusion: Conclusion, note: string) => Promise<void>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [conclusion, setConclusion] = useState<Conclusion>(item.conclusion === "PENDING" ? "PASS" : item.conclusion);
  const [note, setNote] = useState(item.conclusionNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = kind === "TEST" ? "测试" : "验证";

  async function handleSubmit() {
    setBusy(true);
    setError("");
    try {
      await submit(conclusion, note);
      await onSaved();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`${label}结论 · ${item.packageCode}`}
      description={`版本 ${item.version || "—"} · 正式版本 ${item.officialVersion || "—"}`}
      size="md"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSubmit()} disabled={busy}>{busy ? "保存中…" : "保存结论"}</button>
        </>
      )}
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="field">
        <label>{label}结论</label>
        <select className="select" value={conclusion} onChange={(event) => setConclusion(event.target.value as Conclusion)}>
          <option value="PASS">通过</option>
          <option value="CONDITIONAL">有条件通过</option>
          <option value="FAIL">不通过</option>
        </select>
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label>结论说明{conclusion === "PASS" ? "（可选）" : "（必填）"}</label>
        <textarea className="input" rows={4} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} placeholder={kind === "TEST" ? "测试范围、遗留问题、复测建议…" : "验证条码表现、问题现象、是否可转正…"} />
      </div>
      {item.changeSummary ? (
        <div className="callout-strip" style={{ marginTop: 12 }}>
          <span><b>修改内容：</b>{item.changeSummary}</span>
        </div>
      ) : null}
    </Modal>
  );
}
