/** Makes the document safety boundary visible without claiming that browser upload is available. */
export function DocumentActions() {
  return (
    <p className="muted">
      Document registration accepts storage metadata only; object upload, malware scanning, and byte
      delivery are handled by the protected storage and scanner services. Quarantined documents stay
      unavailable until a clean result.
    </p>
  );
}
