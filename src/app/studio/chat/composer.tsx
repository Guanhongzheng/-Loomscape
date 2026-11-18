'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
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
  attachments = [],
  onPickFiles,
  onRemoveAttachment,
  visionReady = false,
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
  /** Compressed data URLs waiting to be sent with the next message. */
  attachments?: Array<{ name: string; url: string }>;
  onPickFiles?: (files: FileList | null) => void;
  onRemoveAttachment?: (index: number) => void;
  /** Cloud path is usable and a vision model is available. */
  visionReady?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="shrink-0 border-t border-white/40 bg-white/30 px-4 py-3 backdrop-blur-2xl md:px-6">
      <div className="mx-auto w-full max-w-[880px]">
        {attachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2" data-attachments="">
            {attachments.map((item, index) => (
              <span
                key={`${item.name}-${index}`}
                className="relative h-16 w-16 overflow-hidden rounded-xl border border-white/70 bg-white/50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => onRemoveAttachment?.(index)}
                  aria-label={`移除 ${item.name}`}
                  className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-[rgb(var(--ink))]/70 text-white transition-colors hover:bg-[rgb(var(--ink))]"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          {!localMode ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                data-vision-input=""
                onChange={(event) => {
                  onPickFiles?.(event.target.files);
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={!visionReady}
                title={visionReady ? '添加参考图（最多 4 张）' : '先去设置里填写视觉模型'}
                aria-label="添加图片"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/60 bg-white/45 text-muted transition-colors hover:bg-white/70 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Paperclip size={16} strokeWidth={1.8} />
              </button>
            </>
          ) : null}
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
            端侧模型不支持图像输入与工具调用。
          </p>
        ) : null}
      </div>
    </div>
  );
}
