"use client";

import { Button } from "./Button";

export default function Modal({
  open,
  title,
  children,
  onClose,
  onConfirm,
  confirmLabel = "Confirm",
}: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 id="modal-title" className="text-lg font-bold text-brand-dark">
          {title}
        </h2>
        {children && <div className="mt-3 text-sm text-ink-muted">{children}</div>}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {onConfirm && (
            <Button variant="primary" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
