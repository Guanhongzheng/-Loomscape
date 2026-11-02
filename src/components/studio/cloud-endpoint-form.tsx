'use client';

import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { PRESETS, type Endpoint } from '@/lib/providers';

const fieldLabel = 'mb-1.5 block text-[10.5px] text-muted';

/**
 * The cloud text endpoint form. State stays in the panel because the status
 * line above it ("云端 · 还没填密钥") is derived from the same draft; only the
 * four fields and their two buttons live here.
 */
export function CloudEndpointForm({
  draft,
  onChange,
  onSave,
  onTest,
  testing,
  ready,
}: {
  draft: Endpoint;
  onChange: (next: Endpoint) => void;
  onSave: () => void;
  onTest: () => void;
  testing: boolean;
  ready: boolean;
}) {
  const preset = PRESETS.text.find((item) => item.id === draft.preset);

  const patch = (next: Partial<Endpoint>) => onChange({ ...draft, ...next });

  return (
    <div className="rounded-xl px-4 py-4 shadow-[var(--shadow-inset-sm)]">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label className={fieldLabel}>服务商</label>
          <Select
            value={draft.preset}
            onChange={(event) => {
              const next = PRESETS.text.find((item) => item.id === event.target.value);
              if (!next) return;
              patch({
                preset: next.id,
                label: next.label,
                baseUrl: next.baseUrl,
                shape: next.shape,
                model: next.models[0] ?? draft.model,
              });
            }}
            className="h-9 text-[12px]"
          >
            {PRESETS.text.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className={fieldLabel}>模型</label>
          {preset && preset.models.length > 0 ? (
            <Select
              value={preset.models.includes(draft.model) ? draft.model : preset.models[0]}
              onChange={(event) => patch({ model: event.target.value })}
              className="h-9 text-[12px]"
            >
              {preset.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              value={draft.model}
              onChange={(event) => patch({ model: event.target.value })}
              placeholder="model-id"
              className="h-9 font-mono text-[11.5px]"
              spellCheck={false}
            />
          )}
        </div>

        <div>
          <label className={fieldLabel}>API Key</label>
          <Input
            type="password"
            value={draft.apiKey}
            onChange={(event) => patch({ apiKey: event.target.value })}
            placeholder={draft.shape === 'anthropic-chat' ? 'sk-ant-...' : 'sk-...'}
            className="h-9 font-mono text-[11.5px]"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div>
          <label className={fieldLabel}>Base URL</label>
          <Input
            value={draft.baseUrl}
            onChange={(event) => patch({ baseUrl: event.target.value })}
            placeholder="https://api.example.com/v1"
            className="h-9 font-mono text-[11.5px]"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={onSave}>
          <Check size={12} />
          保存并使用
        </Button>
        <Button variant="ghost" size="sm" onClick={onTest} disabled={testing || !ready}>
          {testing ? <Loader2 size={11} className="animate-spin" /> : null}
          测试连接
        </Button>
        <span className="text-[10.5px] text-muted/60">
          密钥只写进本机 IndexedDB，请求经 /api/chat 转发，不落盘。
        </span>
      </div>
    </div>
  );
}
