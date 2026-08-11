// Project-scoped message thread (PSP-13). Backed by Supabase Realtime once
// task #6 wires it up — this is presentational only.
export type Message = {
  id: string;
  author: string;
  isSelf?: boolean;
  body: string;
  sentAt: string;
};

export default function MessageThread({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-muted">No messages yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
            message.isSelf
              ? "ml-auto bg-brand-blue text-white"
              : "bg-surface-light text-ink"
          }`}
        >
          {!message.isSelf && (
            <p className="mb-0.5 text-xs font-semibold text-brand-blue">
              {message.author}
            </p>
          )}
          <p>{message.body}</p>
          <p
            className={`mt-1 text-[11px] ${
              message.isSelf ? "text-white/70" : "text-ink-muted"
            }`}
          >
            {message.sentAt}
          </p>
        </div>
      ))}
    </div>
  );
}
