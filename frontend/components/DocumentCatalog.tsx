/**
 * What fills the document panel before a document is chosen.
 *
 * Shown rather than read aloud: the assistant asks one question, and the answer
 * to "what can you draft?" is right there beside it without costing a turn.
 * Nothing here is clickable — choosing happens in the conversation, which is
 * also where a request we cannot meet gets a real answer instead of silence.
 */

import { DOCUMENTS } from "@/lib/documents/catalog";

export function DocumentCatalog() {
  return (
    <article className="doc doc-catalog">
      <p className="doc-eyebrow">Available documents</p>
      <h1 className="doc-title">What would you like to draft?</h1>
      <p className="doc-preamble">
        Describe what you need in the conversation and I&rsquo;ll start the right
        one. These are the agreements I can draft, all based on{" "}
        <a href="https://commonpaper.com">Common Paper</a> standard terms.
      </p>

      <ul className="catalog-list">
        {DOCUMENTS.map((document) => (
          <li key={document.slug} className="catalog-item">
            <h2 className="catalog-name">{document.name}</h2>
            <p className="catalog-summary">{document.summary}</p>
            {document.attachment ? (
              <p className="catalog-note">{document.attachment}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </article>
  );
}
