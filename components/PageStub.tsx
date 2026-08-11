export default function PageStub({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-3xl font-bold text-brand-dark">{title}</h1>
      <p className="mt-4 text-ink-muted">
        {note ?? "This destination is scaffolded and routable but not yet built out."}
      </p>
    </div>
  );
}
