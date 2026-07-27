/**
 * The "this is a draft" notice, as it appears on a document.
 *
 * Deliberately part of the paper rather than the app around it: it prints, and
 * the printed copy is the one that leaves this product. Both renderers use this
 * same component so the wording cannot drift between them.
 */

import { DRAFT_DISCLAIMER } from "@/lib/documents/chat-copy";

export function DocumentDisclaimer() {
  return (
    <p className="doc-disclaimer" role="note">
      <span className="doc-disclaimer-label">Draft</span>
      {DRAFT_DISCLAIMER}
    </p>
  );
}
