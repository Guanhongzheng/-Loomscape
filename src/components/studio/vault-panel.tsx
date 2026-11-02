'use client';

import { useEffect, useState } from 'react';
import { Lock, LockOpen, ShieldCheck } from 'lucide-react';
import { Panel } from '@/components/studio/workbench';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { toast } from '@/components/ui/toast';
import { useEndpoints } from '@/lib/endpoint-store';
import {
  enableVault,
  lockVault,
  removeVault,
  unlockVault,
  vaultStatus,
  type VaultStatus,
} from '@/lib/vault';

/**
 * Passphrase gate for the provider keys. Turning it on re-seals whatever is
 * already stored, because a vault that only encrypts future saves would keep
 * the old plaintext row around and give a false sense of safety.
 *
 * The passphrase is never stored; losing it means re-entering the keys, which
 * the card says before the user commits.
 */
export function VaultPanel() {
  const [status, setStatus] = useState<VaultStatus>('off');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);

  const endpoints = useEndpoints((state) => state.endpoints);
  const reload = useEndpoints((state) => state.load);
  const store = useEndpoints((state) => state.store);

  useEffect(() => {
    setStatus(vaultStatus());
  }, []);

  const resealStored = async () => {
    for (const endpoint of Object.values(endpoints)) {
      if (!endpoint.apiKey) continue;
      await store(endpoint);
    }
  };

  const enable = async () => {
    setBusy(true);
    try {
      await enableVault(passphrase);
      // Seal what is on disk right now; leaving it plaintext would defeat it.
      await resealStored();
      await reload();
      setStatus('unlocked');
      setPassphrase('');
      toast('已启用密钥保险箱，现有密钥已加密', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '启用失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    setBusy(true);
    try {
      await unlockVault(passphrase);
      await reload();
      setStatus('unlocked');
      setPassphrase('');
      toast('保险箱已解锁', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '解锁失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const lock = () => {
    lockVault();
    setStatus('locked');
    toast('已锁定：保存的密钥暂时不可用', 'info');
  };

  const remove = async () => {
    const confirmed =
      typeof window !== 'undefined' &&
      window.confirm('移除保险箱后，已加密的密钥将无法恢复，需要重新填写。继续？');
    if (!confirmed) return;
    removeVault();
    await reload();
    setStatus('off');
    toast('已移除保险箱，请重新填写密钥', 'info');
  };

  const field = (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="password"
        value={passphrase}
        onChange={(event) => setPassphrase(event.target.value)}
        placeholder="口令，至少 8 位"
        className="h-9 w-full font-mono text-[11.5px] sm:w-[240px]"
        spellCheck={false}
        autoComplete="off"
        aria-label="保险箱口令"
      />
      {status === 'locked' ? (
        <Button variant="soft" size="sm" onClick={() => void unlock()} disabled={busy || !passphrase}>
          <LockOpen size={12} />
          解锁
        </Button>
      ) : (
        <Button variant="soft" size="sm" onClick={() => void enable()} disabled={busy || passphrase.length < 8}>
          <ShieldCheck size={12} />
          启用
        </Button>
      )}
    </div>
  );

  return (
    <Panel
      id="vault"
      title="密钥保险箱"
      hint="可选；口令不落盘，忘记只能重填密钥"
      className="scroll-mt-24"
    >
      <div className="space-y-3">
        {status === 'off' ? (
          <>
            <p className="text-[11px] leading-relaxed text-muted/75">
              端点密钥目前以明文存在本机 IndexedDB。设置一个口令后，密钥会用
              AES-GCM 加密再写入；口令只留在内存里，刷新后需要重新解锁。
            </p>
            {field}
          </>
        ) : null}

        {status === 'locked' ? (
          <>
            <p className="text-[11px] leading-relaxed text-muted/75">
              保险箱已锁定，已保存的密钥暂不可用。解锁后聊天、图像与语音的云端通道才会恢复。
            </p>
            {field}
            <button
              type="button"
              onClick={() => void remove()}
              className="text-[11px] text-muted underline-offset-2 transition-colors hover:text-[#a24a3f] hover:underline"
            >
              移除保险箱（密钥需重填）
            </button>
          </>
        ) : null}

        {status === 'unlocked' ? (
          <>
            <p className="flex items-center gap-1.5 text-[11px] text-[#3f6b4f]">
              <ShieldCheck size={12} />
              已解锁：保存的密钥在写入时会自动加密
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={lock}>
                <Lock size={12} />
                锁定
              </Button>
              <button
                type="button"
                onClick={() => void remove()}
                className="text-[11px] text-muted underline-offset-2 transition-colors hover:text-[#a24a3f] hover:underline"
              >
                移除保险箱
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  );
}
