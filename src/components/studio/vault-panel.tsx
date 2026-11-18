'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Lock, LockOpen, ShieldCheck } from 'lucide-react';
import { Panel } from '@/components/studio/workbench';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { toast } from '@/components/ui/toast';
import { useEndpoints } from '@/lib/endpoint-store';
import {
  enableVault,
  lockVault,
  unlockVault,
  vaultStatus,
  type VaultStatus,
} from '@/lib/vault';
import { resetVaultAndKeys } from '@/lib/vault-reset';

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
  const [resetOpen, setResetOpen] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);

  const endpoints = useEndpoints((state) => state.endpoints);
  const reload = useEndpoints((state) => state.load);
  const store = useEndpoints((state) => state.store);

  useEffect(() => {
    setStatus(vaultStatus());
  }, []);

  /**
   * `/studio/settings#vault` is the link the chat page offers while locked.
   * The studio scrolls inside `<main>`, and a client-side transition runs before
   * the browser's fragment pass, so the URL changes while the panel stays below
   * the fold. Scroll the panel into the real container once it is mounted (and
   * when the hash changes while this page is already open).
   */
  useEffect(() => {
    const jump = () => {
      if (window.location.hash !== '#vault') return;
      document.getElementById('vault')?.scrollIntoView({ block: 'start', behavior: 'auto' });
    };
    jump();
    const timer = window.setTimeout(jump, 180);
    window.addEventListener('hashchange', jump);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('hashchange', jump);
    };
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

  const lock = async () => {
    lockVault();
    // The store still holds the decrypted keys from the last load. Without this
    // reload they stay usable in memory, and the chat page keeps believing the
    // channel is ready until the tab is refreshed.
    await reload();
    setStatus('locked');
    toast('已锁定：保存的密钥暂时不可用', 'info');
  };

  const openReset = () => {
    setResetArmed(false);
    setResetOpen(true);
  };

  const closeReset = () => {
    setResetOpen(false);
    setResetArmed(false);
  };

  /** Overwrites the ciphertext and every stored key, then reloads the stores. */
  const doReset = async () => {
    setBusy(true);
    try {
      await resetVaultAndKeys();
      await reload();
      setStatus('off');
      setPassphrase('');
      closeReset();
      toast('保险箱已重置，API 已清空，请重新填写', 'info');
    } finally {
      setBusy(false);
    }
  };

  const field = (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="password"
        value={passphrase}
        onChange={(event) => setPassphrase(event.target.value)}
        placeholder="口令，至少 8 位"
        className="h-9 w-full font-mono text-[12px] sm:w-[240px]"
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
      className="scroll-mt-6"
    >
      <div className="space-y-3">
        {status === 'off' ? (
          <>
            <p className="text-[12px] leading-relaxed text-muted">
              端点密钥目前以明文存在本机 IndexedDB。设置一个口令后，密钥会用
              AES-GCM 加密再写入；口令只留在内存里，刷新后需要重新解锁。
            </p>
            {field}
          </>
        ) : null}

        {status === 'locked' ? (
          <>
            <p className="text-[12px] leading-relaxed text-muted">
              保险箱已锁定，已保存的密钥暂不可用。解锁后聊天、图像与语音的云端通道才会恢复。
            </p>
            {field}
            <button
              type="button"
              onClick={openReset}
              className="text-[11.5px] text-muted underline-offset-2 transition-colors hover:text-[#a24a3f] hover:underline"
            >
              忘记口令？重置保险箱
            </button>
          </>
        ) : null}

        {status === 'unlocked' ? (
          <>
            <p className="flex items-center gap-1.5 text-[12px] text-[#3f6b4f]">
              <ShieldCheck size={12} />
              已解锁：保存的密钥在写入时会自动加密
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => void lock()}>
                <Lock size={12} />
                锁定
              </Button>
              <button
                type="button"
                onClick={openReset}
                className="text-[11.5px] text-muted underline-offset-2 transition-colors hover:text-[#a24a3f] hover:underline"
              >
                重置保险箱（清空密钥）
              </button>
            </div>
          </>
        ) : null}
      </div>

      {resetOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="modal-scrim fixed inset-0 z-[340] grid place-items-center bg-[rgb(var(--paper))]/30 px-4 backdrop-blur-md"
              role="dialog"
              aria-modal="true"
              aria-label="重置密钥保险箱"
            >
          <div className="modal-card w-[min(94vw,430px)] rounded-2xl border border-white/70 bg-white/85 p-5 shadow-[0_40px_90px_-40px_rgba(61,54,72,0.7)] backdrop-blur-xl">
            {resetArmed ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-[#B4453A]/12 text-[#B4453A]">
                    <AlertTriangle size={16} />
                  </span>
                  <h2 className="font-serif text-[19px] text-ink">确认销毁</h2>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                  这会永久删除已保存的 API 密钥，并把四个通道（文本 / 图像 / 语音 / 嵌入）的配置清空。
                  <strong className="text-ink">无法恢复</strong>，需要重新填写。
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    autoFocus
                    onClick={() => setResetArmed(false)}
                    className="h-9 rounded-full border border-[rgb(var(--ink))]/12 px-4 text-[12px] text-ink transition-colors hover:bg-white/70"
                  >
                    返回
                  </button>
                  <button
                    type="button"
                    onClick={() => void doReset()}
                    disabled={busy}
                    className="h-9 rounded-full bg-[#B4453A] px-4 text-[12px] font-medium text-white shadow-[0_10px_22px_-14px_rgba(180,69,58,0.8)] transition-colors hover:bg-[#9E3A31] disabled:opacity-60"
                  >
                    {busy ? '销毁中…' : '我确认，销毁并清空'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="font-serif text-[19px] text-ink">重置密钥保险箱</h2>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                  口令不会以任何形式保存，所以忘记后无法解密。重置会做三件事：
                </p>
                <ol className="mt-2 space-y-1.5 text-[12px] text-muted">
                  <li>1. 销毁已加密的密钥记录（先覆写再删除）</li>
                  <li>2. 清空四个通道已保存的 API</li>
                  <li>3. 清掉本页内存中的明文副本</li>
                </ol>
                <p className="mt-2 text-[11.5px] text-muted/75">
                  说明：浏览器与磁盘可能保留旧数据块，覆写只能缩小窗口，不等于取证级擦除。
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    autoFocus
                    onClick={closeReset}
                    className="h-9 rounded-full border border-[rgb(var(--ink))]/12 px-4 text-[12px] text-ink transition-colors hover:bg-white/70"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => setResetArmed(true)}
                    className="h-9 rounded-full border border-[#B4453A]/40 bg-[#B4453A]/8 px-4 text-[12px] font-medium text-[#B4453A] transition-colors hover:bg-[#B4453A]/14"
                  >
                    继续
                  </button>
                </div>
              </>
            )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </Panel>
  );
}
