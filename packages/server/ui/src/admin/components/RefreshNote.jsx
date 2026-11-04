import { AlertTriangle } from 'lucide-react';
import { refreshProblemText } from '../lib/query-refresh.js';

/**
 * A quiet note beside data a refresh could not replace — the data stays on
 * screen, the failure (the panel's rate limit, an unreachable panel) is
 * said once. Nothing while the last refresh succeeded, or when there is no
 * data: then the error is the section's to show.
 */
export default function RefreshNote({ query, className = '' }) {
  const text = refreshProblemText(query);
  if (!text) return null;
  return (
    <p className={`flex items-start gap-1.5 text-xs text-yellow-500/80 ${className}`}>
      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
      {text}
    </p>
  );
}
