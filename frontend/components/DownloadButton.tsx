interface DownloadButtonProps {
  /** Fields still needing an answer. Shown live, so the button is never a surprise. */
  remaining: number;
  onDownload: () => void;
}

export function DownloadButton({ remaining, onDownload }: DownloadButtonProps) {
  const blocked = remaining > 0;

  return (
    <div className="download">
      <p className="download-hint" data-state={blocked ? "blocked" : "ready"}>
        {blocked
          ? `${remaining} ${blocked && remaining === 1 ? "field" : "fields"} left to fill in`
          : "Opens your print dialog — choose “Save as PDF”"}
      </p>
      <button className="download-button" type="button" onClick={onDownload}>
        Download PDF
      </button>
    </div>
  );
}
