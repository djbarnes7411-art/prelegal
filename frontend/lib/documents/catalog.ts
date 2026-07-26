/**
 * The documents this product can draft.
 *
 * Imported straight from the generated catalog rather than fetched: it is a
 * build artifact, it cannot change while the tab is open, and the workspace can
 * show the list before any request has been made. The clause text is *not* here
 * — that is a separate file per document, loaded when one is chosen.
 */

import bundle from "./generated/catalog.json";
import { CLAUSE_LOADERS } from "./generated/clauses";
import type { Catalog, ClauseFile, DocumentDef } from "./types";

const catalog = bundle as unknown as Catalog;

export const DOCUMENTS: readonly DocumentDef[] = catalog.documents;

export function findDocument(slug: string | null | undefined): DocumentDef | null {
  if (!slug) return null;
  return DOCUMENTS.find((document) => document.slug === slug) ?? null;
}

export function findField(document: DocumentDef, key: string) {
  return document.fields.find((field) => field.key === key) ?? null;
}

/**
 * Fetches one document's contract text.
 *
 * A separate chunk per document, so opening the workspace does not download
 * eleven agreements to show one. The Mutual NDA has no entry: its text is the
 * verbatim transcription in `lib/nda/standard-terms.ts`.
 */
export async function loadClauses(slug: string): Promise<ClauseFile | null> {
  const loader = CLAUSE_LOADERS[slug];
  if (!loader) return null;

  const loaded = await loader();
  /* The one place a generated JSON module is narrowed to its declared shape.
     It is generated from the same definitions this type describes, so the
     assertion cannot drift without the build failing first. */
  return loaded.default as ClauseFile;
}
