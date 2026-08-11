// Files & Deliverables module (PSP-12): version labels, description, date,
// uploader, access policy. Download href is expected to be a short-lived
// signed URL (SEC-06) generated server-side, never a direct storage path.
export default function FileRow({
  name,
  version,
  description,
  uploadedAt,
  uploadedBy,
  downloadHref,
  visibility,
}: {
  name: string;
  version?: string;
  description?: string;
  uploadedAt: string;
  uploadedBy: string;
  downloadHref?: string;
  visibility: "Client-visible" | "Internal-only";
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-border p-4">
      <div>
        <p className="font-semibold text-brand-dark">
          {name} {version && <span className="text-ink-muted">· {version}</span>}
        </p>
        {description && <p className="text-sm text-ink-muted">{description}</p>}
        <p className="mt-1 text-xs text-ink-muted">
          Uploaded {uploadedAt} by {uploadedBy} · {visibility}
        </p>
      </div>
      {downloadHref && (
        <a
          href={downloadHref}
          className="text-sm font-semibold text-brand-blue hover:underline"
        >
          Download
        </a>
      )}
    </div>
  );
}
