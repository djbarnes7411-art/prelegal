import {
  CC_BY_URL,
  STANDARD_TERMS_URL,
  STANDARD_TERMS_VERSION,
} from "@/lib/nda/standard-terms";
import {
  countWithNumeral,
  renderDocument,
  type Segment,
} from "@/lib/nda/render";
import type { CoverPageData, Party } from "@/lib/nda/types";

interface NdaDocumentProps {
  data: CoverPageData;
  /** Clauses to mark while the form group that feeds them has focus. */
  activeClauses: number[];
}

export function NdaDocument({ data, activeClauses }: NdaDocumentProps) {
  const model = renderDocument(data);
  const expires = data.mndaTerm.kind === "expires";
  const yearsOfConfidentiality = data.confidentialityTerm.kind === "years";

  return (
    <article className="doc">
      <p className="doc-eyebrow">Cover Page</p>
      <h1 className="doc-title">Mutual Non-Disclosure Agreement</h1>

      {/* Reproduces the "USING THIS MUTUAL NON-DISCLOSURE AGREEMENT" paragraph
          from templates/mutual-nda-coverpage.md, including the parentheticals
          that define "Cover Page" and "Standard Terms". */}
      <p className="doc-preamble">
        This Mutual Non-Disclosure Agreement (the “MNDA”) consists of: (1) this
        Cover Page (“<strong>Cover Page</strong>”) and (2) the Common Paper Mutual
        NDA Standard Terms Version {STANDARD_TERMS_VERSION} (“
        <strong>Standard Terms</strong>”) identical to those posted at{" "}
        <a href={STANDARD_TERMS_URL}>
          commonpaper.com/standards/mutual-nda/{STANDARD_TERMS_VERSION}
        </a>
        . Any modifications of the Standard Terms should be made on the Cover
        Page, which will control over conflicts with the Standard Terms.
      </p>

      <section className="doc-section">
        <h2 className="doc-heading">Purpose</h2>
        <p className="doc-caption">How confidential information may be used</p>
        <p className="doc-body">
          <Value text={data.purpose} placeholder="not yet specified" underline />
        </p>
      </section>

      <section className="doc-section">
        <h2 className="doc-heading">Effective Date</h2>
        <p className="doc-body">
          <Value
            text={model.effectiveDate}
            placeholder="not yet specified"
            underline
          />
        </p>
      </section>

      <section className="doc-section">
        <h2 className="doc-heading">MNDA Term</h2>
        <p className="doc-caption">The length of this MNDA</p>
        <Choice selected={expires}>
          Expires{" "}
          {data.mndaTerm.kind === "expires" && data.mndaTerm.years ? (
            <span className="ink">
              {countWithNumeral(data.mndaTerm.years, "year")}
            </span>
          ) : (
            "a set number of years"
          )}{" "}
          from Effective Date.
        </Choice>
        <Choice selected={!expires}>
          Continues until terminated in accordance with the terms of the MNDA.
        </Choice>
      </section>

      <section className="doc-section">
        <h2 className="doc-heading">Term of Confidentiality</h2>
        <p className="doc-caption">How long confidential information is protected</p>
        <Choice selected={yearsOfConfidentiality}>
          {data.confidentialityTerm.kind === "years" &&
          data.confidentialityTerm.years ? (
            <span className="ink">
              {countWithNumeral(data.confidentialityTerm.years, "year")}
            </span>
          ) : (
            "A set number of years"
          )}{" "}
          from Effective Date, but in the case of trade secrets until
          Confidential Information is no longer considered a trade secret under
          applicable laws.
        </Choice>
        <Choice selected={!yearsOfConfidentiality}>In perpetuity.</Choice>
      </section>

      <section className="doc-section">
        <h2 className="doc-heading">Governing Law &amp; Jurisdiction</h2>
        <p className="doc-body">
          Governing law:{" "}
          <Value text={data.governingLaw} placeholder="state" underline />
        </p>
        {/* The source Cover Page prints the bare value here; "courts located in"
            belongs to clause 9, which supplies it around the same value. */}
        <p className="doc-body">
          Jurisdiction:{" "}
          <Value
            text={data.jurisdiction}
            placeholder="city or county and state"
            underline
          />
        </p>
      </section>

      <section className="doc-section">
        <h2 className="doc-heading">MNDA Modifications</h2>
        <p className="doc-body">
          {data.modifications.trim() ? (
            <span className="ink">{data.modifications.trim()}</span>
          ) : (
            "None."
          )}
        </p>
      </section>

      <section className="doc-section">
        <p className="doc-body">
          By signing this Cover Page, each party agrees to enter into this MNDA
          as of the Effective Date.
        </p>
        <SignatureBlock partyOne={data.partyOne} partyTwo={data.partyTwo} />
      </section>

      <section className="doc-section doc-standard-terms">
        <p className="doc-eyebrow">
          Common Paper Mutual NDA · Version {STANDARD_TERMS_VERSION}
        </p>
        <h2 className="doc-title">Standard Terms</h2>
        <ol className="doc-clauses">
          {model.clauses.map((clause) => (
            <li
              key={clause.number}
              className="clause"
              data-linked={activeClauses.includes(clause.number)}
            >
              <span className="clause-number">§{clause.number}</span>
              <p className="clause-body">
                <strong>{clause.heading}.</strong>{" "}
                <ClauseText segments={clause.segments} />
              </p>
            </li>
          ))}
        </ol>
      </section>

      <p className="doc-attribution">
        Common Paper Mutual Non-Disclosure Agreement (Version{" "}
        {STANDARD_TERMS_VERSION}) free to use under{" "}
        <a href={CC_BY_URL}>CC BY 4.0</a>.
      </p>
    </article>
  );
}

/**
 * A value the user supplied, or a ruled blank where one is still missing.
 *
 * `underline` draws the rule that belongs on a Cover Page form. Inside the
 * Standard Terms the ink alone marks the value, so the prose stays readable.
 */
function Value({
  text,
  placeholder,
  underline = false,
}: {
  text: string;
  placeholder: string;
  underline?: boolean;
}) {
  const trimmed = text.trim();
  if (!trimmed) return <span className="blank">{placeholder}</span>;
  return <span className={underline ? "ink-field" : "ink"}>{trimmed}</span>;
}

function Choice({
  selected,
  children,
}: {
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <p className="choice-line" data-selected={selected}>
      <span className="choice-box" aria-hidden="true" />
      <span>
        <span className="visually-hidden">
          {selected ? "Selected: " : "Not selected: "}
        </span>
        {children}
      </span>
    </p>
  );
}

function ClauseText({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "text") return segment.text;
        if (segment.kind === "strong")
          return <strong key={index}>{segment.text}</strong>;

        const value = (
          <span key="value" className={segment.filled ? "ink" : "blank"}>
            {segment.value}
          </span>
        );

        if (segment.term === null) {
          return <span key={index}>{value}</span>;
        }

        return (
          <span key={index}>
            {segment.term}
            {segment.showValue ? <> ({value})</> : null}
          </span>
        );
      })}
    </>
  );
}

function SignatureBlock({
  partyOne,
  partyTwo,
}: {
  partyOne: Party;
  partyTwo: Party;
}) {
  const rows: Array<{ label: string; read: (party: Party) => string }> = [
    { label: "Print name", read: (party) => party.signatoryName },
    { label: "Title", read: (party) => party.signatoryTitle },
    { label: "Company", read: (party) => party.companyName },
    { label: "Notice address", read: (party) => party.noticeAddress },
  ];

  return (
    <table className="signatures">
      <thead>
        <tr>
          <th scope="col">
            <span className="visually-hidden">Field</span>
          </th>
          <th scope="col">Party 1</th>
          <th scope="col">Party 2</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Signature</th>
          <td className="sign-here" />
          <td className="sign-here" />
        </tr>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td>
              <Value text={row.read(partyOne)} placeholder="—" />
            </td>
            <td>
              <Value text={row.read(partyTwo)} placeholder="—" />
            </td>
          </tr>
        ))}
        <tr>
          <th scope="row">Date</th>
          <td className="sign-here" />
          <td className="sign-here" />
        </tr>
      </tbody>
    </table>
  );
}
