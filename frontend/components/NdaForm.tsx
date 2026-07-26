import { Field, fieldId, Group } from "./FormField";
import type { CoverPageData, Party } from "@/lib/nda/types";
import type { FieldErrors } from "@/lib/nda/validate";

type PartySlot = "partyOne" | "partyTwo";

interface NdaFormProps {
  data: CoverPageData;
  /** Already gated — empty until the user has tried to download. */
  errors: FieldErrors;
  onChange: (patch: Partial<CoverPageData>) => void;
  onPartyChange: (slot: PartySlot, patch: Partial<Party>) => void;
  onActivate: (clauses: number[]) => void;
}

export function NdaForm({
  data,
  errors,
  onChange,
  onPartyChange,
  onActivate,
}: NdaFormProps) {
  return (
    <form className="panel-form" onSubmit={(event) => event.preventDefault()}>
      <Group
        title="Purpose"
        affects={[1, 2]}
        note="What the parties may use each other's confidential information for. Anything outside this is off limits."
        onActivate={onActivate}
      >
        <Field
          name="purpose"
          label="Purpose"
          value={data.purpose}
          onChange={(purpose) => onChange({ purpose })}
          error={errors.purpose}
          multiline
        />
      </Group>

      <Group
        title="Dates and duration"
        affects={[5]}
        note="When the agreement starts, how long it runs, and how long secrets stay secret after it ends."
        onActivate={onActivate}
      >
        <Field
          name="effectiveDate"
          label="Effective date"
          type="date"
          value={data.effectiveDate}
          onChange={(effectiveDate) => onChange({ effectiveDate })}
          error={errors.effectiveDate}
        />

        <fieldset className="field">
          <legend className="field-label">Length of this NDA</legend>
          <label className="choice">
            <input
              type="radio"
              name="mnda-term"
              checked={data.mndaTerm.kind === "expires"}
              onChange={() => onChange({ mndaTerm: { kind: "expires", years: 1 } })}
            />
            <span>Expires</span>
            <input
              id={fieldId("mndaTerm.years")}
              className="choice-years"
              type="number"
              min={1}
              step={1}
              aria-label="Years until the NDA expires"
              disabled={data.mndaTerm.kind !== "expires"}
              value={
                data.mndaTerm.kind === "expires" && data.mndaTerm.years
                  ? data.mndaTerm.years
                  : ""
              }
              onChange={(event) =>
                onChange({
                  mndaTerm: {
                    kind: "expires",
                    years: Number(event.target.value),
                  },
                })
              }
            />
            <span>years after the effective date</span>
          </label>
          <label className="choice">
            <input
              type="radio"
              name="mnda-term"
              checked={data.mndaTerm.kind === "untilTerminated"}
              onChange={() => onChange({ mndaTerm: { kind: "untilTerminated" } })}
            />
            <span>Runs until either party terminates it</span>
          </label>
          {errors["mndaTerm.years"] ? (
            <span className="field-error">{errors["mndaTerm.years"]}</span>
          ) : null}
        </fieldset>

        <fieldset className="field">
          <legend className="field-label">How long information stays protected</legend>
          <label className="choice">
            <input
              type="radio"
              name="confidentiality-term"
              checked={data.confidentialityTerm.kind === "years"}
              onChange={() =>
                onChange({ confidentialityTerm: { kind: "years", years: 1 } })
              }
            />
            <input
              id={fieldId("confidentialityTerm.years")}
              className="choice-years"
              type="number"
              min={1}
              step={1}
              aria-label="Years information stays protected"
              disabled={data.confidentialityTerm.kind !== "years"}
              value={
                data.confidentialityTerm.kind === "years" &&
                data.confidentialityTerm.years
                  ? data.confidentialityTerm.years
                  : ""
              }
              onChange={(event) =>
                onChange({
                  confidentialityTerm: {
                    kind: "years",
                    years: Number(event.target.value),
                  },
                })
              }
            />
            <span>years after the effective date</span>
          </label>
          <label className="choice">
            <input
              type="radio"
              name="confidentiality-term"
              checked={data.confidentialityTerm.kind === "perpetuity"}
              onChange={() =>
                onChange({ confidentialityTerm: { kind: "perpetuity" } })
              }
            />
            <span>Forever</span>
          </label>
          {errors["confidentialityTerm.years"] ? (
            <span className="field-error">
              {errors["confidentialityTerm.years"]}
            </span>
          ) : null}
        </fieldset>
      </Group>

      <Group
        title="Governing law"
        affects={[9]}
        note="Whose law applies, and where a dispute would be heard."
        onActivate={onActivate}
      >
        <div className="field-row">
          <Field
            name="governingLaw"
            label="State"
            value={data.governingLaw}
            onChange={(governingLaw) => onChange({ governingLaw })}
            error={errors.governingLaw}
            placeholder="Delaware"
          />
          <Field
            name="jurisdiction"
            label="Courts located in"
            value={data.jurisdiction}
            onChange={(jurisdiction) => onChange({ jurisdiction })}
            error={errors.jurisdiction}
            placeholder="New Castle, DE"
          />
        </div>
      </Group>

      <Group
        title="Parties"
        affects={[11]}
        note="Who is signing, and where each party receives notices under the agreement."
        onActivate={onActivate}
      >
        <PartyFields
          slot="partyOne"
          heading="Party 1"
          party={data.partyOne}
          errors={errors}
          onChange={onPartyChange}
        />
        <PartyFields
          slot="partyTwo"
          heading="Party 2"
          party={data.partyTwo}
          errors={errors}
          onChange={onPartyChange}
        />
      </Group>

      <Group
        title="Modifications"
        affects={[]}
        affectsLabel="Controls over the standard terms"
        note="Changes to the standard terms go here. Leave it empty to use them unchanged."
        onActivate={onActivate}
      >
        <Field
          name="modifications"
          label="Modifications (optional)"
          value={data.modifications}
          onChange={(modifications) => onChange({ modifications })}
          multiline
          placeholder="None"
        />
      </Group>
    </form>
  );
}

interface PartyFieldsProps {
  slot: PartySlot;
  heading: string;
  party: Party;
  errors: FieldErrors;
  onChange: (slot: PartySlot, patch: Partial<Party>) => void;
}

function PartyFields({
  slot,
  heading,
  party,
  errors,
  onChange,
}: PartyFieldsProps) {
  return (
    <div className="party">
      <p className="party-name">{heading}</p>
      <Field
        name={`${slot}.companyName`}
        label="Company"
        value={party.companyName}
        onChange={(companyName) => onChange(slot, { companyName })}
        error={errors[`${slot}.companyName`]}
      />
      <div className="field-row">
        <Field
          name={`${slot}.signatoryName`}
          label="Signed by"
          value={party.signatoryName}
          onChange={(signatoryName) => onChange(slot, { signatoryName })}
          error={errors[`${slot}.signatoryName`]}
        />
        <Field
          name={`${slot}.signatoryTitle`}
          label="Title"
          value={party.signatoryTitle}
          onChange={(signatoryTitle) => onChange(slot, { signatoryTitle })}
          error={errors[`${slot}.signatoryTitle`]}
        />
      </div>
      <Field
        name={`${slot}.noticeAddress`}
        label="Notice address"
        value={party.noticeAddress}
        onChange={(noticeAddress) => onChange(slot, { noticeAddress })}
        error={errors[`${slot}.noticeAddress`]}
        placeholder="Email or postal address"
      />
    </div>
  );
}
