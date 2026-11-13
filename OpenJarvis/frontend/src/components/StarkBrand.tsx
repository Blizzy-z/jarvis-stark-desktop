export function StarkBrand({ compact = false }: { compact?: boolean }) {
  return <div className={`stark-brand ${compact ? 'stark-brand--compact' : ''}`} aria-label="Stark Industries — JARVIS">
    <img src="/jarvis-logo.png" alt="JARVIS arc reactor logo" className="stark-helmet" style={{objectFit:"contain",borderRadius:12}} />
    <div><div className="stark-wordmark">STARK</div><div className="stark-industries">INDUSTRIES</div>
      {!compact && <div className="stark-caption">J.A.R.V.I.S. / PERSONAL ASSISTANT</div>}
    </div>
  </div>;
}
