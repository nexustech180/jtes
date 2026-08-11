"use client";

import { useState } from "react";

// In-app notifications (INT-07) with email as secondary alert (handled
// server-side, not here). Presentational + open/close state only — the
// notification feed itself comes from the notifications table (DAT-23) once
// wired up.
export type NotificationItem = {
  id: string;
  message: string;
  createdAt: string;
  read: boolean;
};

export default function NotificationDropdown({ items }: { items: NotificationItem[] }) {
  const [open, setOpen] = useState(false);
  const unreadCount = items.filter((item) => !item.read).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        className="relative rounded-full p-2 hover:bg-surface-light"
      >
        <span aria-hidden>🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-blue text-[10px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-surface-border bg-white p-2 shadow-lg">
          {items.length === 0 ? (
            <p className="p-4 text-center text-sm text-ink-muted">No notifications.</p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className={`rounded-lg p-3 text-sm ${item.read ? "" : "bg-surface-light"}`}
              >
                <p>{item.message}</p>
                <p className="mt-1 text-xs text-ink-muted">{item.createdAt}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
