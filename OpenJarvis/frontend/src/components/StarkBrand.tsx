export function StarkBrand({ compact = false }: { compact?: boolean }) {
  return <div className={`stark-brand ${compact ? 'stark-brand--compact' : ''}`} aria-label="Stark Industries — JARVIS">
    <svg viewBox="0 0 80 92" role="img" aria-label="Iron Man helmet" className="stark-helmet">
      <path d="M17 6 40 2 63 6 74 27 69 65 55 85 40 90 25 85 11 65 6 27Z" fill="#9b2735" stroke="#d5a652" strokeWidth="2" />
      <path d="M22 13 34 10 40 24 46 10 58 13 64 30 59 59 53 65 51 77 29 77 27 65 21 59 16 30Z" fill="#ddbc78" />
      <path d="m18 38 18 6-2 7-14-5Zm44 0-18 6 2 7 14-5Z" fill="#a5f3fc" stroke="#24778c" strokeWidth="2" />
      <path d="m30 68 10-4 10 4M30 74h20M40 25v31" fill="none" stroke="#86622e" strokeWidth="2" />
    </svg>
    <div><div className="stark-wordmark">STARK</div><div className="stark-industries">INDUSTRIES</div>
      {!compact && <div className="stark-caption">J.A.R.V.I.S. / PERSONAL ASSISTANT</div>}
    </div>
  </div>;
}
