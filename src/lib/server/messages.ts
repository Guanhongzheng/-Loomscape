/**
 * Normalises the transcript a browser sends before it reaches a model.
 *
 * Three shapes arrive here: classic `content` strings, v5 `parts` arrays, and
 * tool plumbing the model should never see. Getting this wrong is not cosmetic
 * — dropping an assistant turn makes the model contradict itself, and letting a
 * duplicated user turn through makes it answer its own echo.
 */

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

const MAX_TURNS = 24;
const MAX_CHARS = 24_000;

export function sanitiseMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];

  const rows = input
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as {
        role?: string;
        content?: unknown;
        parts?: Array<{ type?: string; text?: string }>;
      };

      // Unknown roles (tool results, data parts) used to be coerced to `user`,
      // which handed the model JSON blobs phrased as questions.
      if (row.role !== 'user' && row.role !== 'assistant' && row.role !== 'system') return null;

      const fromParts = (row.parts ?? [])
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');
      // A v5-style message carries text in `parts` and an empty `content`
      // string; `content ?? parts` kept the empty string and dropped the turn.
      const direct = typeof row.content === 'string' ? row.content : '';
      const content = (fromParts || direct).trim();
      if (!content) return null;

      return { role: row.role, content: content.slice(0, MAX_CHARS) } as ChatMessage;
    })
    .filter((row): row is ChatMessage => row !== null);

  // A double submit or a retry can repeat the same turn back to back.
  const deduped: ChatMessage[] = [];
  for (const row of rows) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.role === row.role && previous.content === row.content) continue;
    deduped.push(row);
  }

  return deduped.slice(-MAX_TURNS);
}
