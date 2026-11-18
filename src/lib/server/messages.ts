/**
 * Normalises the transcript a browser sends before it reaches a model.
 *
 * Three shapes arrive here: classic `content` strings, v5 `parts` arrays, and
 * tool plumbing the model should never see. Getting this wrong is not cosmetic
 * — dropping an assistant turn makes the model contradict itself, and letting a
 * duplicated user turn through makes it answer its own echo.
 *
 * Images ride along as data URLs. Only `data:image/...;base64,` is accepted:
 * remote URLs would turn the upstream into an image fetcher and open an SSRF
 * path that the text side already refuses.
 */

export type ChatImagePart = { type: 'image'; image: string };
export type ChatTextPart = { type: 'text'; text: string };
export type ChatContent = string | Array<ChatTextPart | ChatImagePart>;

/**
 * Discriminated per role so the result is assignable to the AI SDK's
 * CoreMessage: only a user turn can carry images.
 */
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: ChatContent }
  | { role: 'assistant'; content: string };

const MAX_TURNS = 24;
const MAX_CHARS = 24_000;
const MAX_IMAGE_CHARS = 2_800_000;
const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_IMAGES_TOTAL = 8;

const IMAGE_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i;

type Row = {
  role?: string;
  content?: unknown;
  parts?: Array<{ type?: string; text?: string; image?: unknown; url?: unknown }>;
  experimental_attachments?: Array<{ url?: unknown; contentType?: unknown }>;
};

function collectImages(row: Row): string[] {
  const found: string[] = [];

  const push = (value: unknown) => {
    if (typeof value === 'string' && value.length <= MAX_IMAGE_CHARS && IMAGE_URL.test(value)) {
      found.push(value);
    }
  };

  for (const part of row.parts ?? []) {
    if (part?.type === 'image') push(part.image ?? part.url);
  }
  for (const attachment of row.experimental_attachments ?? []) {
    push(attachment?.url);
  }

  return Array.from(new Set(found));
}

export function sanitiseMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];

  let imageBudget = MAX_IMAGES_TOTAL;

  const rows = input
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Row;

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
      const text = (fromParts || direct).trim().slice(0, MAX_CHARS);

      // Images are only meaningful on user turns; an assistant "image" is a
      // render artefact, not something to send back upstream.
      const images =
        row.role === 'user' ? collectImages(row).slice(0, Math.max(0, Math.min(MAX_IMAGES_PER_MESSAGE, imageBudget))) : [];
      imageBudget -= images.length;

      if (!text && images.length === 0) return null;

      if (images.length === 0) {
        return { role: row.role, content: text } as ChatMessage;
      }

      const content: ChatContent = [
        ...images.map((image) => ({ type: 'image' as const, image })),
        ...(text ? [{ type: 'text' as const, text }] : []),
      ];
      return { role: row.role, content } as ChatMessage;
    })
    .filter((row): row is ChatMessage => row !== null);

  // A double submit or a retry can repeat the same turn back to back. Compare
  // by text plus image count: comparing base64 in full would block the tab.
  const signature = (message: ChatMessage) => {
    if (typeof message.content === 'string') return `t:${message.content}`;
    const images = message.content.filter((part) => part.type === 'image').length;
    const text = message.content
      .filter((part): part is ChatTextPart => part.type === 'text')
      .map((part) => part.text)
      .join('');
    return `m:${images}:${text}`;
  };

  const deduped: ChatMessage[] = [];
  for (const row of rows) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.role === row.role && signature(previous) === signature(row)) continue;
    deduped.push(row);
  }

  return deduped.slice(-MAX_TURNS);
}

/** True when any turn carries an image; the route swaps to the vision model. */
export function hasImages(messages: ChatMessage[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) && message.content.some((part) => part.type === 'image'),
  );
}
