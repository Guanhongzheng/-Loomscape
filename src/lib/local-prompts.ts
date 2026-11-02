/*
 * Prompt construction and stream filters. Pure string work, kept out of
 * local-runtime so the session machinery stays readable and these stay
 * testable without a wasm runtime.
 */

/**
 * Prompt construction for models that ship their own chat template. Qwen speaks
 * ChatML, so the hand-written string below is correct for it; Llama and Gemma
 * use their own special tokens, and pairing them with ChatML makes the model
 * answer and then keep going into the next turn instead of stopping at EOS.
 * The template comes from the repo's tokenizer, so a new model needs no code.
 */
export function promptFor(
  tokenizer: { apply_chat_template?: (messages: unknown, options?: unknown) => unknown } | undefined,
  system: string,
  turns: Array<{ role: string; content: string }>,
  prefill = '',
  useTemplate = false,
): string {
  if (useTemplate && typeof tokenizer?.apply_chat_template === 'function') {
    try {
      const text = tokenizer.apply_chat_template([{ role: 'system', content: system }, ...turns], {
        tokenize: false,
        add_generation_prompt: true,
      });
      if (typeof text === 'string' && text.length > 0) return text + prefill;
    } catch {
      // A repo without a usable template falls back to the ChatML string.
    }
  }
  return chatPrompt(system, turns, prefill);
}

export function chatPrompt(
  system: string,
  turns: Array<{ role: string; content: string }>,
  prefill = '',
): string {
  const blocks = [`<|im_start|>system\n${system}<|im_end|>`];
  for (const turn of turns) {
    blocks.push(`<|im_start|>${turn.role}\n${turn.content}<|im_end|>`);
  }
  blocks.push(`<|im_start|>assistant\n${prefill}`);
  return blocks.join('\n');
}

/**
 * Only the plain-text tag is listed. Qwen3's ` thinking` / `<｜end▁of▁thinking｜>` are
 * special tokens, so the streamer already drops them with skip_special_tokens;
 * matching the bare word "think" on top of that would swallow English answers
 * that happen to open with it.
 */
const OPENERS = ['<think>'];
const CLOSERS = ['</think>', '<｜end▁of▁thinking｜>'];

/**
 * Qwen3 is a hybrid-reasoning model: even with a closed think block in the
 * prompt it can open another one. Reasoning is model-internal and should not
 * reach the transcript, but the answer streams token by token, so the block
 * has to be dropped while it arrives rather than filtered from the result.
 */
export function createReasoningFilter(emit: (text: string) => void) {
  let held = '';
  let state: 'start' | 'inside' | 'answer' = 'start';
  const longestCloser = Math.max(...CLOSERS.map((closer) => closer.length));

  const drain = () => {
    for (;;) {
      if (state === 'answer') {
        if (held) {
          emit(held);
          held = '';
        }
        return;
      }

      if (state === 'start') {
        const head = held.replace(/^\s+/, '');
        if (!head) {
          held = '';
          return;
        }
        // Still short enough to become a tag: wait for more tokens.
        if ([...OPENERS, ...CLOSERS].some((tag) => tag.startsWith(head))) return;
        // A closer with no opener is the tail of the prompt's own closed block.
        const stray = CLOSERS.find((tag) => head.startsWith(tag));
        if (stray) {
          state = 'answer';
          held = head.slice(stray.length).replace(/^\s+/, '');
          continue;
        }
        const opener = OPENERS.find((item) => head.startsWith(item));
        if (!opener) {
          state = 'answer';
          continue;
        }
        state = 'inside';
        held = head.slice(opener.length);
        continue;
      }

      let cut = -1;
      let closer = '';
      for (const candidate of CLOSERS) {
        const at = held.indexOf(candidate);
        if (at !== -1 && (cut === -1 || at < cut)) {
          cut = at;
          closer = candidate;
        }
      }
      if (cut === -1) {
        // Hold back only a tail that could be the start of a closer, so a tag
        // split across tokens never leaks into the answer.
        if (held.length > longestCloser) held = held.slice(-longestCloser);
        return;
      }
      held = held.slice(cut + closer.length).replace(/^\s+/, '');
      state = 'answer';
    }
  };

  return {
    push(chunk: string) {
      held += chunk;
      drain();
    },
    /** Called once the stream ends; an unclosed block is reasoning, not answer. */
    flush() {
      if (state === 'answer' && held) emit(held);
      else if (state === 'start' && held.trim()) emit(held.replace(/^\s+/, ''));
      held = '';
    },
  };
}

/**
 * Turn markers that a decoder can emit as plain text when it is fed a prompt
 * built for another family, or when it starts a second turn of its own. They
 * are kept out of the transcript by cutting the stream at the first one.
 */
const TURN_MARKERS = [
  '<|eot_id|>',
  '<|eom_id|>',
  '<|end_of_text|>',
  '<|im_end|>',
  '<|fim_end|>',
  '<|endoftext|>',
  '<end_of_turn>',
  '</s>',
];

export function createStopFilter(emit: (text: string) => void) {
  let held = '';
  let done = false;
  // A marker split across tokens must not leak, so a tail that could still
  // become one is held back until the next chunk decides it.
  return {
    push(chunk: string) {
      if (done) return;
      held += chunk;
      let cut = -1;
      for (const marker of TURN_MARKERS) {
        const at = held.indexOf(marker);
        if (at !== -1 && (cut === -1 || at < cut)) cut = at;
      }
      if (cut !== -1) {
        if (cut > 0) emit(held.slice(0, cut));
        done = true;
        held = '';
        return;
      }
      let hold = 0;
      for (const marker of TURN_MARKERS) {
        for (let size = Math.min(marker.length - 1, held.length); size > 0; size -= 1) {
          if (held.endsWith(marker.slice(0, size))) hold = Math.max(hold, size);
        }
      }
      const ready = held.length - hold;
      if (ready > 0) {
        emit(held.slice(0, ready));
        held = held.slice(ready);
      }
    },
    flush() {
      if (!done && held) emit(held);
      held = '';
      done = true;
    },
  };
}

