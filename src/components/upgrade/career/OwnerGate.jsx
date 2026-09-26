/**
 * What a Career plan panel shows before its owner content is in hand:
 * loading, "not set up yet" (the SQL has not been run — names the file),
 * or an error with a retry. Children render only once the content loaded.
 */
export default function OwnerGate({ oc, need, children }) {
  if (oc.state === 'loading') {
    return <div className="cp-gate"><span className="cp-eyebrow">// loading</span><div className="cp-skel" /><div className="cp-skel is-short" /></div>;
  }
  if (oc.state === 'setup') {
    return (
      <div className="cp-gate is-setup">
        <span className="cp-eyebrow">// not set up</span>
        <p>{oc.message}</p>
        <button type="button" className="link-open-btn" onClick={oc.reload}>Check again</button>
      </div>
    );
  }
  if (oc.state === 'error') {
    return (
      <div className="cp-gate is-error">
        <span className="cp-eyebrow">// couldn’t load</span>
        <p>{oc.message}</p>
        <button type="button" className="link-open-btn" onClick={oc.reload}>Retry</button>
      </div>
    );
  }
  if (need && oc.data[need] == null) {
    return (
      <div className="cp-gate is-setup">
        <span className="cp-eyebrow">// no data</span>
        <p>Nothing stored under <code>{need}</code> yet — run the seed file in the Supabase SQL editor.</p>
        <button type="button" className="link-open-btn" onClick={oc.reload}>Check again</button>
      </div>
    );
  }
  return children;
}
