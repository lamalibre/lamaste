/**
 * A domain's page language: the language its sign-in, invitation and
 * refusal pages speak — Authelia's included (page-language-design.md) — and
 * the state of the rendering that serves it. Keyed by the domain's language
 * where it is used, so a change made elsewhere resets the choice.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Languages } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from './Toast.jsx';
import { warningLines } from '../lib/branding.js';
import {
  explainLanguageRefusal,
  languageChoiceOf,
  languageChoices,
  languageName,
  languageOfChoice,
  renderingStateText,
} from '../lib/language.js';

const TONES = { ok: 'text-zinc-500', pending: 'text-yellow-400', failing: 'text-red-400' };

export function DomainLanguage({ domain }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const current = languageChoiceOf(domain.language);
  const [choice, setChoice] = useState(current);
  const chosen = languageOfChoice(choice);
  const save = useMutation({
    mutationFn: () => client.setDomainLanguage(domain.name, chosen),
    onSuccess: (result) => {
      if (!result.changed) addToast(`${domain.name}: language unchanged`);
      else if (chosen) addToast(`${domain.name}: pages in ${languageName(chosen)}`);
      else
        addToast(`${domain.name}: language cleared — English pages, sign-in following the browser`);
      for (const line of warningLines(result.warnings)) addToast(line, 'warning');
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      queryClient.invalidateQueries({ queryKey: ['domain-branding-preview', domain.name] });
    },
    onError: (err) => addToast(explainLanguageRefusal(err), 'error'),
  });
  const state = renderingStateText(domain);

  return (
    <div className="space-y-2">
      <label className="block text-xs text-zinc-400" htmlFor={`language-${domain.name}`}>
        Page language — the sign-in, invitation and refusal pages of this domain
      </label>
      <div className="flex flex-wrap gap-2">
        <select
          id={`language-${domain.name}`}
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
        >
          {languageChoices().map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-cyan-600 hover:text-white disabled:opacity-50"
          disabled={choice === current || save.isPending}
          onClick={() => save.mutate()}
        >
          <Languages size={14} /> {save.isPending ? 'Applying…' : 'Apply'}
        </button>
      </div>
      <p className="text-xs text-zinc-600">
        A language is every page’s: Authelia’s sign-in shows it whatever the visitor’s browser
        prefers, and its language menu is hidden.
      </p>
      {state && <p className={`text-xs ${TONES[state.tone]}`}>{state.text}</p>}
    </div>
  );
}
