import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import type { ToastItem } from "../hooks/useRadar";

export function Toasts({ items }: { items: ToastItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast ${item.tone === "error" ? "toast--error" : item.tone === "success" ? "toast--success" : ""}`}>
          {item.tone === "error" ? <AlertCircle size={14} /> : item.tone === "success" ? <CheckCircle2 size={14} /> : <Info size={14} />}
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}
