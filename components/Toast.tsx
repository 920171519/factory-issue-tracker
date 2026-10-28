"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, Info, X, CircleAlert } from "lucide-react";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((message: string, kind: ToastKind) => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-3), { id, message, kind }]);
    window.setTimeout(() => remove(id), kind === "error" ? 5600 : 3600);
  }, [remove]);

  const api = useMemo<ToastApi>(() => ({
    success: (message) => push(message, "success"),
    error: (message) => push(message, "error"),
    info: (message) => push(message, "info"),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast ${item.kind === "info" ? "" : item.kind}`}>
            {item.kind === "success" ? <CheckCircle2 size={16} /> : item.kind === "error" ? <CircleAlert size={16} /> : <Info size={16} />}
            <span style={{ flex: 1 }}>{item.message}</span>
            <button
              type="button"
              onClick={() => remove(item.id)}
              aria-label="关闭提示"
              style={{ border: 0, background: "none", color: "rgba(255,255,255,.6)", padding: 0, display: "grid", placeItems: "center" }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast 必须在 ToastProvider 内使用");
  return context;
}
