'use client';

import Link from 'next/link';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';

/**
 * The composer plus the status line under it. Enter sends, Shift+Enter breaks
 * the line, and an IME composition is never treated as a send — the check on
 * `isComposing` is the reason a Chinese input method can pick a candidate with
 * Enter without submitting.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  engineLabel,
  ragLabel,
  localMode,
  vaultLocked = false,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  engineLabel: string;
  ragLabel: string;
  localMode: boolean;
  /** The stored key exists but the vault is locked; the cloud path is unusable. */
  vaultLocked?: boolean;
}) {
  return (
    <div className="shrink-0 border-t border-white/40 bg-white/30 px-4 py-3 backdrop-blur-2xl md:px-6">
      <div className="mx-auto w-full max-w-[880px]">
        <div className="flex items-end gap-2">
          <Textarea
            rows={1}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder="回车发送，Shift + 回车换行"
            className="min-h-[46px] resize-none text-[13.5px]"
          />
          {busy ? (
            <Button variant="inset" size="sm" onClick={onStop} className="h-11 w-11 shrink-0 p-0">
              <Square size={14} />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={onSend}
              disabled={!value.trim()}
              className="h-11 w-11 shrink-0 p-0"
              aria-label="发送"
            >
              <ArrowUp size={16} strokeWidth={2} />
            </Button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted/85">
          <span className="font-mono uppercase tracking-[0.14em] text-muted/65">引擎</span>
          <span>{engineLabel}</span>
          <Link
            href={vaultLocked ? '/studio/settings#vault' : '/studio/settings'}
            className="font-medium text-[rgb(var(--copper))] hover:underline"
          >
            {vaultLocked ? '去解锁' : '去设置'}
          </Link>
          <span className="text-muted/40">·</span>
          <span>检索 {ragLabel}</span>
        </div>
        {vaultLocked ? (
          <p
            data-vault-locked="true"
            className="mt-1.5 text-[11px] leading-relaxed text-[#8c3b32]/85"
          >
            密钥保险箱已锁定，云端对话暂不可用；解锁后恢复。
          </p>
        ) : null}
        {localMode ? (
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted/75">
            端侧模型：短问答与摘要可用，纯算式交给本地计算器；长文改写、多步推理建议换云端。
          </p>
        ) : null}
      </div>
    </div>
  );
}
