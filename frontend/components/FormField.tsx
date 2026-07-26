import type { FieldKey } from "@/lib/nda/validate";

/**
 * Stable DOM id for a form control, derived from its `FieldKey`.
 *
 * Deterministic rather than `useId`-generated so the download action can move
 * focus to the first field that still needs an answer.
 */
export function fieldId(key: FieldKey): string {
  return `nda-${key.replace(/\./g, "-")}`;
}

interface FieldProps {
  name: FieldKey;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  type?: "text" | "date";
  multiline?: boolean;
}

export function Field({
  name,
  label,
  value,
  onChange,
  error,
  placeholder,
  type = "text",
  multiline = false,
}: FieldProps) {
  const id = fieldId(name);
  const errorId = `${id}-error`;

  const shared = {
    id,
    value,
    placeholder,
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": error ? errorId : undefined,
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          {...shared}
          className="field-textarea"
          rows={3}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          {...shared}
          className="field-input"
          type={type}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error ? (
        <span className="field-error" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface GroupProps {
  title: string;
  /** Standard Terms clauses this group's answers appear in. Empty for none. */
  affects: number[];
  /** Overrides the generated "Appears in §n" tag. */
  affectsLabel?: string;
  note?: string;
  /** Called with `affects` on focus and `[]` on blur, to mark those clauses. */
  onActivate: (clauses: number[]) => void;
  children: React.ReactNode;
}

export function Group({
  title,
  affects,
  affectsLabel,
  note,
  onActivate,
  children,
}: GroupProps) {
  const label =
    affectsLabel ??
    `Appears in ${affects.map((clause) => `§${clause}`).join(", ")}`;

  return (
    <section
      className="group"
      onFocus={() => onActivate(affects)}
      onBlur={() => onActivate([])}
    >
      <div className="group-head">
        <h2 className="group-title">{title}</h2>
        <span className="group-affects">{label}</span>
      </div>
      {note ? <p className="group-note">{note}</p> : null}
      {children}
    </section>
  );
}
