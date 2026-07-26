"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DownloadButton } from "./DownloadButton";
import { fieldId } from "./FormField";
import { NdaDocument } from "./NdaDocument";
import { NdaForm } from "./NdaForm";
import { documentTitle } from "@/lib/nda/render";
import {
  createEmptyCoverPage,
  type CoverPageData,
  type Party,
} from "@/lib/nda/types";
import {
  countErrors,
  validateCoverPage,
  type FieldErrors,
  type FieldKey,
} from "@/lib/nda/validate";

const NO_ERRORS: FieldErrors = {};

export function NdaWorkspace() {
  const [data, setData] = useState<CoverPageData>(createEmptyCoverPage);
  const [activeClauses, setActiveClauses] = useState<number[]>([]);
  /** Errors stay quiet until the first download attempt. */
  const [showErrors, setShowErrors] = useState(false);

  const errors = useMemo(() => validateCoverPage(data), [data]);

  /* Browsers use the document title as the default "Save as PDF" filename. */
  useEffect(() => {
    document.title = documentTitle(data);
  }, [data]);

  const update = useCallback((patch: Partial<CoverPageData>) => {
    setData((current) => ({ ...current, ...patch }));
  }, []);

  const updateParty = useCallback(
    (slot: "partyOne" | "partyTwo", patch: Partial<Party>) => {
      setData((current) => ({
        ...current,
        [slot]: { ...current[slot], ...patch },
      }));
    },
    [],
  );

  const handleDownload = useCallback(() => {
    const missing = Object.keys(errors) as FieldKey[];

    if (missing.length > 0) {
      setShowErrors(true);
      document.getElementById(fieldId(missing[0]))?.focus();
      return;
    }

    window.print();
  }, [errors]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            §
          </span>
          <span className="brand-name">Prelegal</span>
        </div>
        <p className="topbar-doc">
          Mutual NDA · Common Paper Standard Terms v1.0
        </p>
        <DownloadButton
          remaining={countErrors(errors)}
          onDownload={handleDownload}
        />
      </header>

      <main className="workspace">
        <div className="panel">
          <p className="panel-intro">
            Answer these and the agreement fills itself in beside you. Everything
            you type appears in the document in blue, so you can see exactly what
            you chose and what comes straight from the Common Paper standard.
          </p>
          <NdaForm
            data={data}
            errors={showErrors ? errors : NO_ERRORS}
            onChange={update}
            onPartyChange={updateParty}
            onActivate={setActiveClauses}
          />
        </div>

        <div className="desk">
          <NdaDocument data={data} activeClauses={activeClauses} />
        </div>
      </main>
    </div>
  );
}
