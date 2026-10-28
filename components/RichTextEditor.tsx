"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Link2,
  ImagePlus,
  LoaderCircle,
} from "lucide-react";
import { apiFetch, errorMessage } from "@/lib/client-api";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: number;
}

interface UploadResponse {
  url: string;
  name: string;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "填写定位结论、转移原因或补充说明…",
  disabled = false,
  minHeight = 120,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const initialValue = useRef(value);

  useEffect(() => {
    if (editorRef.current && initialValue.current) {
      editorRef.current.innerHTML = initialValue.current;
    }
    // ContentEditable is intentionally uncontrolled after mount so the caret does not jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function emit() {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }

  function saveSelection() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (editorRef.current?.contains(range.commonAncestorContainer)) {
        savedRange.current = range.cloneRange();
      }
    }
  }

  function exec(command: string, argument?: string) {
    if (disabled) return;
    editorRef.current?.focus();
    if (savedRange.current) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(savedRange.current);
    }
    document.execCommand(command, false, argument);
    emit();
    saveSelection();
  }

  function insertImage(url: string, alt: string) {
    editorRef.current?.focus();
    const selection = window.getSelection();
    if (savedRange.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
    const safeAlt = alt.replace(/"/g, "&quot;");
    document.execCommand("insertHTML", false, `<img src="${url}" alt="${safeAlt}" />`);
    emit();
  }

  async function uploadAndInsert(files: File[]) {
    if (disabled) return;
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    setError("");
    setUploading(true);
    saveSelection();
    try {
      for (const file of images) {
        if (file.size > 5 * 1024 * 1024) throw new Error("单张图片不能超过 5MB");
        const form = new FormData();
        form.append("file", file);
        const result = await apiFetch<UploadResponse>("/api/uploads", { method: "POST", body: form });
        insertImage(result.url, result.name || "图片");
      }
    } catch (uploadError) {
      setError(errorMessage(uploadError));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        <button type="button" className="rich-tool" title="加粗" onClick={() => exec("bold")} disabled={disabled}><Bold size={14} /></button>
        <button type="button" className="rich-tool" title="斜体" onClick={() => exec("italic")} disabled={disabled}><Italic size={14} /></button>
        <button type="button" className="rich-tool" title="下划线" onClick={() => exec("underline")} disabled={disabled}><Underline size={14} /></button>
        <span className="rich-sep" />
        <button type="button" className="rich-tool" title="无序列表" onClick={() => exec("insertUnorderedList")} disabled={disabled}><List size={15} /></button>
        <button type="button" className="rich-tool" title="有序列表" onClick={() => exec("insertOrderedList")} disabled={disabled}><ListOrdered size={15} /></button>
        <span className="rich-sep" />
        <button
          type="button"
          className="rich-tool"
          title="插入链接"
          disabled={disabled}
          onClick={() => {
            saveSelection();
            const url = window.prompt("请输入链接地址（含 https://）");
            if (url) exec("createLink", url);
          }}
        >
          <Link2 size={14} />
        </button>
        <button type="button" className="rich-upload" onClick={() => fileRef.current?.click()} disabled={disabled || uploading}>
          {uploading ? <LoaderCircle size={13} className="spin" /> : <ImagePlus size={13} />}
          <span style={{ marginLeft: 3 }}>添加图片</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(event) => void uploadAndInsert(Array.from(event.target.files || []))}
        />
        <span style={{ flex: 1 }} />
        <span className="hint" style={{ paddingRight: 4 }}>支持粘贴图片</span>
      </div>
      <div
        ref={editorRef}
        className="rich-area"
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        style={{ minHeight }}
        onInput={emit}
        onBlur={() => { emit(); saveSelection(); }}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files || []);
          if (files.some((file) => file.type.startsWith("image/"))) {
            event.preventDefault();
            void uploadAndInsert(files);
          }
        }}
        onDrop={(event) => {
          const files = Array.from(event.dataTransfer.files || []);
          if (files.some((file) => file.type.startsWith("image/"))) {
            event.preventDefault();
            void uploadAndInsert(files);
          }
        }}
      />
      {error ? <div className="rich-error">{error}</div> : null}
    </div>
  );
}