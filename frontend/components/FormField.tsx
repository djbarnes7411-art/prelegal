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

/** Id of the element holding a field's error message, for `aria-describedby`. */
function errorId(key: FieldKey): string {
  return `${fieldId(key)}-error`;
}

/**
 * The attributes that tie a control to its error message.
 *
 * Every control that can be reported by `validateCoverPage` spreads this, so a
 * screen reader announces the reason alongside the field rather than leaving the
 * user at a field that is merely marked wrong.
 */
function errorAttributes(name: FieldKey, error?: string) {
  return {
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": error ? errorId(name) : undefined,
  };
}

export function FieldError({
  name,
  error,
}: {
  name: FieldKey;
  error?: string;
}) {
  if (!error) return null;
  return (
    <span className="field-error" id={errorId(name)}>
      {error}
    </span>
  );
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

  const shared = {
    id,
    value,
    placeholder,
    ...errorAttributes(name, error),
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
      <FieldError name={name} error={error} />
    </div>
  );
}

interface YearsInputProps {
  name: Extract<FieldKey, `${string}.years`>;
  /** Accessible name — the surrounding prose is not a usable label on its own. */
  label: string;
  /** False when the sibling radio option is chosen, which disables this input. */
  active: boolean;
  years: number;
  error?: string;
  onChange: (years: number) => void;
}

/** The year count that sits inside a term's "Expires N years" radio option. */
export function YearsInput({
  name,
  label,
  active,
  years,
  error,
  onChange,
}: YearsInputProps) {
  return (
    <input
      id={fieldId(name)}
      className="choice-years"
      type="number"
      min={1}
      step={1}
      aria-label={label}
      {...errorAttributes(name, error)}
      disabled={!active}
      // A cleared field holds 0; showing it as empty keeps editing natural.
      value={active && years ? years : ""}
      onChange={(event) => onChange(Number(event.target.value))}
    />
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
