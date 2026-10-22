import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { shortId } from '../lib/identity.js';

/**
 * A directory id (a user's, a directory's), shortened in monospace — the
 * full id on hover and to copy. `null` shows a dash with `missing` as its
 * explanation.
 */
export default function CopyableId({ id, missing = 'not in the directory yet', full = false }) {
  const [copied, setCopied] = useState(false);
  if (!id) {
    return (
      <span className="text-zinc-600" title={missing}>
        —
      </span>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard here: the full id stays in the tooltip.
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-xs text-zinc-400" title={id}>
        {full ? id : shortId(id)}
      </span>
      <button
        type="button"
        onClick={copy}
        title="Copy the full id"
        aria-label="Copy the full id"
        className="text-zinc-500 hover:text-zinc-300"
      >
        {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
      </button>
    </span>
  );
}
