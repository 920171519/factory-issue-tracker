"use client";

import { useRef, useState } from "react";
import { Download, FileSpreadsheet, LoaderCircle, UploadCloud } from "lucide-react";
import { Modal } from "@/components/Modal";
import { apiFetch, errorMessage } from "@/lib/client-api";

interface ImportResult {
  imported: number;
  failed: number;
  errors: { row: number; message: string }[];
  barcodeIds: string[];
  notifiedRecipients: number;
}

export function ImportModal({ projectId, onClose, onImported }: { projectId: string; onClose: () => void; onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  function chooseFile(next: File | null) {
    setError("");
    setResult(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!/\.(xlsx|xls)$/i.test(next.name)) {
      setError("请选择 .xlsx 或 .xls 文件");
      return;
    }
    if (next.size > 10 * 1024 * 1024) {
      setError("文件不能超过 10MB");
      return;
    }
    setFile(next);
  }

  async function submit() {
    if (!file) {
      setError("请选择要导入的 Excel 文件");
      return;
    }
    setError("");
    setPending(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await apiFetch<ImportResult>(`/api/projects/${projectId}/issues/import`, { method: "POST", body: form });
      setResult(data);
      if (data.imported > 0) onImported();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      title="批量导入问题"
      description="每行代表一个条码。系统会按每个条码的参与责任组与当前排班解析处理人，并按责任人合并通知。"
      size="lg"
      onClose={() => (pending ? null : onClose())}
      footer={
        <>
          <a className="btn btn-secondary" href={`/api/projects/${projectId}/issues/template`} target="_blank" rel="noreferrer">
            <Download size={14} /> 下载 Excel 模板
          </a>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>{result ? "关闭" : "取消"}</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={pending || !file}>
            {pending ? <LoaderCircle size={14} className="spin" /> : <UploadCloud size={14} />}
            {pending ? "导入中…" : "开始导入"}
          </button>
        </>
      }
    >
      <div
        className={`import-drop ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          chooseFile(event.dataTransfer.files[0] || null);
        }}
      >
        <FileSpreadsheet size={27} color="var(--primary)" />
        <h4>{file ? file.name : "拖入 Excel 文件，或点击选择"}</h4>
        <p>支持 .xlsx / .xls，单次最多 500 行，文件不超过 10MB</p>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={(event) => chooseFile(event.target.files?.[0] || null)} />
        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => inputRef.current?.click()}>
          选择文件
        </button>
      </div>
      <div className="field-hint" style={{ marginTop: 10 }}>
        模板中的参与责任组留空时使用项目默认责任组。Excel 内前 500 行有效；格式不正确的行会逐行列出错误。
      </div>
      {error ? <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div> : null}
      {result ? (
        <div style={{ marginTop: 14 }}>
          <div className={`alert ${result.imported > 0 ? "alert-success" : "alert-warning"}`}>
            导入完成：成功 {result.imported} 条，失败 {result.failed} 条；已向 {result.notifiedRecipients} 位处理人合并发送通知。
          </div>
          {result.errors.length > 0 ? (
            <div className="import-errors import-result">
              {result.errors.map((item, index) => <span key={`${item.row}-${index}`}>第 {item.row} 行：{item.message}</span>)}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
