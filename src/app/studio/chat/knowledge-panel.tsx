'use client';

import { BookPlus, FileText, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/field';
import { Switch } from '@/components/ui/controls';
import { Panel } from '@/components/studio/workbench';
import type { DocumentSummary } from '@/lib/memory';

/**
 * Import form plus the list of what is already retrievable. State stays on the
 * page: importing also refreshes the embedder badge and can switch the chat
 * into retrieval mode, so the panel only reports intent.
 */
export function KnowledgePanel({
  title,
  onTitle,
  note,
  onNote,
  importing,
  onImport,
  rag,
  onRag,
  docs,
  onDrop,
}: {
  title: string;
  onTitle: (next: string) => void;
  note: string;
  onNote: (next: string) => void;
  importing: boolean;
  onImport: () => void;
  rag: boolean;
  onRag: (next: boolean) => void;
  docs: DocumentSummary[];
  onDrop: (docId: string) => void;
}) {
  return (
    <Panel title="知识库" hint="入库后立刻参与检索，不上传服务器">
      <div className="space-y-3">
        <Input
          value={title}
          onChange={(event) => onTitle(event.target.value)}
          placeholder="资料标题，例如：品牌手册"
          className="h-9 text-[12px]"
        />
        <Textarea
          rows={5}
          value={note}
          onChange={(event) => onNote(event.target.value)}
          placeholder="粘贴需要记住的内容。会自动分段并编号，长文也可以。"
          className="text-[12px]"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-muted/60">
            {note.trim() ? `${note.trim().length} 字` : '空闲'}
          </span>
          <Button variant="soft" size="sm" onClick={onImport} disabled={importing}>
            {importing ? <Loader2 size={13} className="animate-spin" /> : <BookPlus size={13} />}
            入库
          </Button>
        </div>
      </div>

      <div className="mt-5 space-y-2.5">
        <Switch
          checked={rag}
          onChange={onRag}
          label="回答前先检索"
          description="关闭后只带对话上下文，不查知识库。"
        />

        {docs.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-muted/70">
            还没有资料。导入后，提问时会先命中这里的内容。
          </p>
        ) : (
          <ul className="space-y-2">
            {docs.map((doc) => (
              <li
                key={doc.docId}
                className="flex items-start gap-2 rounded-xl px-3 py-2 shadow-[var(--shadow-inset-sm)]"
              >
                <FileText size={13} className="mt-0.5 shrink-0 text-muted/70" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] text-ink/85">{doc.title}</div>
                  <div className="font-mono text-[9.5px] text-muted/60">
                    {doc.chunks} 段 · {doc.chars} 字
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDrop(doc.docId)}
                  aria-label={`移除 ${doc.title}`}
                  className="grid h-6 w-6 place-items-center rounded-lg text-muted/60 transition-colors hover:bg-[rgb(var(--sunken))] hover:text-ink"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
