/**
 * A document rendered from its parsed template.
 *
 * Two halves, mirroring how Common Paper agreements are actually put together:
 * a Key Terms page holding the fill-in values and a signature block, then the
 * standard terms themselves with each defined term resolved against those
 * values.
 *
 * The Key Terms page is ours. Common Paper publishes the standard terms for
 * these documents but not the fill-in page that accompanies them, so this is a
 * faithful presentation of the values the contract actually references rather
 * than a reproduction of a published form. The Mutual NDA, whose cover page
 * *was* published, keeps its own hand-built page in `NdaDocument`.
 */

import { DocumentDisclaimer } from "./Disclaimer";
import { renderClauses, type RenderedSegment } from "@/lib/documents/render";
import type {
  Clause,
  DocumentDef,
  DocumentState,
  FieldDef,
  PartyValue,
} from "@/lib/documents/types";
import { isParty } from "@/lib/documents/types";
import { displayValue, isAnswered } from "@/lib/documents/values";

const CC_BY_URL = "https://creativecommons.org/licenses/by/4.0/";

interface GenericDocumentProps {
  document: DocumentDef;
  clauses: Clause[];
  state: DocumentState;
  /** Clause numbers to mark, briefly, after a change lands in the fields they quote. */
  activeClauses: string[];
}

export function GenericDocument({
  document,
  clauses,
  state,
  activeClauses,
}: GenericDocumentProps) {
  const parties = document.fields.filter((field) => field.type === "party");
  const terms = document.fields.filter((field) => field.type !== "party");
  const rendered = renderClauses(document, clauses, state);

  return (
    <article className="doc">
      <p className="doc-eyebrow">Key Terms</p>
      <h1 className="doc-title">{document.title}</h1>

      <DocumentDisclaimer />

      <p className="doc-preamble">
        This {document.name} consists of: (1) these Key Terms and (2) the Common
        Paper {document.title} Standard Terms
        {document.version ? ` Version ${document.version}` : ""}
        {document.sourceUrl ? (
          <>
            {" "}
            identical to those posted at <a href={document.sourceUrl}>
              {document.sourceUrl.replace(/^https:\/\//, "")}
            </a>
          </>
        ) : null}
        . Any modifications should be made on these Key Terms, which will
        control over conflicts with the Standard Terms.
      </p>

      {document.attachment ? (
        <p className="doc-attachment-note">{document.attachment}</p>
      ) : null}

      {terms.map((field) => (
        <section className="doc-section" key={field.key}>
          <h2 className="doc-heading">{field.name}</h2>
          <p className="doc-caption">{field.label}</p>
          <p className="doc-body">
            <FieldValueText field={field} state={state} />
          </p>
        </section>
      ))}

      {parties.length > 0 ? (
        <section className="doc-section">
          <p className="doc-body">
            By signing these Key Terms, each party agrees to enter into this{" "}
            {document.name}.
          </p>
          <SignatureBlock parties={parties} state={state} />
        </section>
      ) : null}

      <section className="doc-section doc-standard-terms">
        <p className="doc-eyebrow">
          Common Paper {document.title}
          {document.version ? ` · Version ${document.version}` : ""}
        </p>
        <h2 className="doc-title">Standard Terms</h2>
        <ol className="doc-clauses doc-clauses-nested">
          {rendered.map((clause) => (
            <li
              key={clause.number}
              className="clause"
              data-depth={clause.depth}
              data-linked={activeClauses.includes(clause.number)}
            >
              <span className="clause-number">{clause.number}</span>
              {/*
                A top-level clause is a section of the agreement and carries a
                real heading, so the document can be navigated by heading rather
                than read start to finish. The headings below it are run-in —
                "Access and Use." opens the sentence it belongs to — and stay
                inline, where turning them into blocks would break the prose.
              */}
              {clause.depth === 0 && clause.heading ? (
                <h3 className="clause-body clause-section">{clause.heading}</h3>
              ) : (
                <p className="clause-body">
                  {clause.heading ? <strong>{clause.heading}.</strong> : null}{" "}
                  <ClauseText segments={clause.segments} />
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      <p className="doc-attribution">
        Common Paper {document.title}
        {document.version ? ` (Version ${document.version})` : ""} free to use
        under <a href={CC_BY_URL}>CC BY 4.0</a>.
      </p>
    </article>
  );
}

/**
 * One Key Terms value.
 *
 * An unanswered optional field prints "None." rather than a blank: that is what
 * the standard terms read an omitted value as, so saying so is more accurate
 * than leaving a gap that looks unfinished.
 */
function FieldValueText({
  field,
  state,
}: {
  field: FieldDef;
  state: DocumentState;
}) {
  const answered = isAnswered(field, state[field.key]);

  if (!answered) {
    return field.required ? (
      <span className="blank">not yet specified</span>
    ) : (
      <span className="ink-none">None.</span>
    );
  }

  if (field.type === "term") {
    const value = displayValue(field, state[field.key]);
    return <span className="ink-field">{value || field.openEnded}</span>;
  }

  return (
    <span className="ink-field">{displayValue(field, state[field.key])}</span>
  );
}

function ClauseText({ segments }: { segments: RenderedSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          return segment.strong ? (
            <strong key={index}>{segment.text}</strong>
          ) : (
            <span key={index}>{segment.text}</span>
          );
        }

        const value = (
          <span className={segment.filled ? "ink" : "blank"}>
            {segment.value}
          </span>
        );
        const body = (
          <>
            {segment.term}
            {segment.showValue ? <> ({value})</> : null}
          </>
        );

        return segment.strong ? (
          <strong key={index}>{body}</strong>
        ) : (
          <span key={index}>{body}</span>
        );
      })}
    </>
  );
}

function SignatureBlock({
  parties,
  state,
}: {
  parties: FieldDef[];
  state: DocumentState;
}) {
  const rows: Array<{ label: string; read: (party: PartyValue) => string }> = [
    { label: "Print name", read: (party) => party.signatoryName },
    { label: "Title", read: (party) => party.signatoryTitle },
    { label: "Company", read: (party) => party.companyName },
    { label: "Notice address", read: (party) => party.noticeAddress },
  ];

  const values = parties.map((field) => {
    const value = state[field.key];
    return isParty(value)
      ? value
      : {
          companyName: "",
          signatoryName: "",
          signatoryTitle: "",
          noticeAddress: "",
        };
  });

  return (
    <table className="signatures">
      <thead>
        <tr>
          <th scope="col">
            <span className="visually-hidden">Field</span>
          </th>
          {parties.map((field) => (
            <th scope="col" key={field.key}>
              {field.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Signature</th>
          {parties.map((field) => (
            <td className="sign-here" key={field.key} />
          ))}
        </tr>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            {values.map((party, index) => {
              const text = row.read(party).trim();
              return (
                <td key={parties[index].key}>
                  {text ? (
                    <span className="ink">{text}</span>
                  ) : (
                    <span className="blank">—</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
        <tr>
          <th scope="row">Date</th>
          {parties.map((field) => (
            <td className="sign-here" key={field.key} />
          ))}
        </tr>
      </tbody>
    </table>
  );
}
