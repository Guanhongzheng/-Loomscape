import { solveArithmetic } from '@/lib/arithmetic';
import type { RecallHit } from '@/lib/memory';
import type { Turn } from './parts';

/**
 * Turn construction, kept out of the send pipeline so the shapes can be tested
 * without a model, a network or a store. The page still owns the awaits; these
 * only decide what a finished exchange looks like.
 */

/**
 * Deterministic input should not be sampled: an on-device model reads "10-3"
 * as 10.3 often enough that arithmetic is answered here instead.
 */
export function calcTurns(text: string, at = Date.now()): Turn[] | null {
  const calc = solveArithmetic(text);
  if (!calc) return null;
  const id = `calc_${at}`;
  return [
    { id, role: 'user', text, at },
    {
      id: `${id}_a`,
      role: 'assistant',
      text: `${calc.expression} = ${calc.result}`,
      at,
      mode: 'calc',
    },
  ];
}

export function exchange(
  id: string,
  text: string,
  answer: string,
  mode: Turn['mode'],
  sources: RecallHit[],
  at = Date.now(),
): Turn[] {
  return [
    { id, role: 'user', text, at },
    { id: `${id}_a`, role: 'assistant', text: answer, at, mode, sources },
  ];
}

/**
 * The last few turns as prompt history. The local path used to send only the
 * newest message, so a follow-up arrived with no conversation behind it; six
 * turns at 800 characters keeps a small context from swallowing the weights.
 */
export function localHistory(turns: Turn[], limit = 6): Array<{ role: string; content: string }> {
  return turns
    .filter((turn) => turn.text.trim())
    .slice(-limit)
    .map((turn) => ({ role: turn.role, content: turn.text.slice(0, 800) }));
}
