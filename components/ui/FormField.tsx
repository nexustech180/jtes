import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

type BaseProps = {
  label: string;
  name: string;
  error?: string;
  hint?: string;
};

const fieldClasses =
  "w-full rounded-lg border border-surface-border px-3.5 py-2.5 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20";

function FieldWrapper({
  label,
  name,
  error,
  hint,
  children,
}: BaseProps & { children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-semibold text-brand-dark">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-ink-muted">{hint}</p>}
      {error && (
        <p className="mt-1.5 text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label,
  name,
  error,
  hint,
  ...props
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldWrapper label={label} name={name} error={error} hint={hint}>
      <input
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        className={fieldClasses}
        {...props}
      />
    </FieldWrapper>
  );
}

export function TextAreaField({
  label,
  name,
  error,
  hint,
  ...props
}: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldWrapper label={label} name={name} error={error} hint={hint}>
      <textarea
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        rows={4}
        className={fieldClasses}
        {...props}
      />
    </FieldWrapper>
  );
}

export function SelectField({
  label,
  name,
  error,
  hint,
  children,
  ...props
}: BaseProps &
  React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return (
    <FieldWrapper label={label} name={name} error={error} hint={hint}>
      <select id={name} name={name} className={fieldClasses} {...props}>
        {children}
      </select>
    </FieldWrapper>
  );
}
