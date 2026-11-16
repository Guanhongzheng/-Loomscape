'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, LogOut, Pencil, X } from 'lucide-react';
import { useAuth, type Profile } from '@/lib/auth';
import { cn } from '@/lib/cn';

/** 256px is plenty for a 66px avatar and keeps the data URL small. */
const AVATAR_SIZE = 256;
const MAX_SOURCE_MB = 2;

function initialOf(user: Profile | null): string {
  const source = user?.displayName?.trim() || user?.handle || '·';
  return source.slice(0, 1).toUpperCase();
}

async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法读取图片');
  const scale = Math.max(AVATAR_SIZE / bitmap.width, AVATAR_SIZE / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  ctx.drawImage(bitmap, (AVATAR_SIZE - width) / 2, (AVATAR_SIZE - height) / 2, width, height);
  bitmap.close?.();
  const webp = canvas.toDataURL('image/webp', 0.82);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * The rail's profile block. It sits above the workbench links now, so the
 * account lives where a person expects to find it and the five modules keep
 * the lower half of the rail.
 */
export function SidebarProfile({
  user,
  onEdit,
  onLogin,
  onLogout,
}: {
  user: Profile | null;
  onEdit: () => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const name = user?.displayName?.trim() || user?.handle || '未登录';
  const bio = user?.bio?.trim();

  return (
    <div className="mx-4 overflow-hidden rounded-[18px] border border-[rgb(var(--ink))]/10 bg-white/55 backdrop-blur-md">
      <div className="relative h-[78px] overflow-hidden bg-[linear-gradient(150deg,#e7e0f0,#f2eeea_58%,#e3dced)]">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              'linear-gradient(rgba(61,54,72,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(61,54,72,0.055) 1px, transparent 1px)',
            backgroundSize: '14px 14px',
            transform: 'rotate(-8deg) scale(1.35)',
          }}
        />
      </div>

      <div className="relative -mt-[30px] flex justify-center">
        <span className="grid h-[62px] w-[62px] place-items-center overflow-hidden rounded-full border-[3px] border-white/80 bg-[radial-gradient(circle_at_35%_30%,#ffffff,#f2eeea_55%,#e4deeb)] font-serif text-[24px] text-[rgb(var(--accent))] shadow-[0_10px_24px_-14px_rgba(0,0,0,0.8)]">
          {user?.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            initialOf(user)
          )}
        </span>
      </div>

      <div className="px-3.5 pb-3 pt-1.5 text-center">
        <div className="flex items-center justify-center gap-1.5">
          <span className="max-w-[8.5rem] truncate text-[15px] font-semibold">{name}</span>
          {user ? (
            <span className="rounded-full border border-[rgb(var(--accent))]/35 px-1.5 py-[1px] text-[8px] text-[rgb(var(--accent))]">
              本地
            </span>
          ) : null}
        </div>
        <div className="mt-1 font-mono text-[10px] tracking-[0.08em] text-muted/80">
          {user ? `@${user.uid}` : '这台设备上的账号'}
        </div>
        <p className="mt-1.5 min-h-[15px] text-[11px] leading-relaxed text-ink/65">
          {bio ? `「${bio}」` : '还没有个签'}
        </p>

        <div className="mt-2.5 flex gap-1.5">
          {user ? (
            <button
              type="button"
              onClick={onEdit}
              className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-full border border-[rgb(var(--ink))]/10 bg-white/70 text-[10.5px] text-ink/80 transition-colors hover:bg-white"
            >
              <Pencil size={11} strokeWidth={1.8} />
              编辑资料
            </button>
          ) : (
            <button
              type="button"
              onClick={onLogin}
              className="flex h-7 flex-1 items-center justify-center rounded-full border border-[rgb(var(--ink))]/10 bg-white/70 text-[10.5px] text-ink/80 transition-colors hover:bg-white"
            >
              登录 / 注册
            </button>
          )}
          {user ? (
            <button
              type="button"
              onClick={onLogout}
              aria-label="退出登录"
              className="grid h-7 w-8 place-items-center rounded-full border border-[rgb(var(--ink))]/10 text-muted transition-colors hover:bg-[rgb(var(--ink))]/[0.08] hover:text-ink"
            >
              <LogOut size={12} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>

        {user?.guest ? (
          <button
            type="button"
            onClick={onLogin}
            className="mt-1 w-full rounded-full py-1 text-[10px] text-muted/70 transition-colors hover:text-ink/80"
          >
            登录 / 注册（访客数据会留在本机）
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Profile editing: name, signature and one avatar. The avatar is written once
 * and overwritten on the next upload — no history, which matches "存一次即永久".
 */
export function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useAuth((state) => state.user);
  const updateProfile = useAuth((state) => state.updateProfile);

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(user?.displayName ?? '');
    setBio(user?.bio ?? '');
    setAvatar(user?.avatar);
    setError('');
    setBusy(false);
  }, [open, user]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const pickAvatar = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_SOURCE_MB * 1024 * 1024) {
      setError(`图片不能超过 ${MAX_SOURCE_MB}MB`);
      return;
    }
    try {
      setAvatar(await downscale(file));
      setError('');
    } catch {
      setError('这张图片读不出来，换一张试试');
    }
  }, []);

  if (!open) return null;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await updateProfile({ displayName: name, bio, avatar });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[320] grid place-items-center bg-[rgb(var(--ink))]/55 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="编辑资料"
      onClick={onClose}
    >
      <div
        className="w-[min(92vw,380px)] rounded-2xl border border-white/60 bg-[rgb(var(--paper))] p-5 shadow-[0_40px_90px_-40px_rgba(61,54,72,0.7)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">编辑资料</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-black/5 hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-black/5 bg-[radial-gradient(circle_at_35%_30%,#ffffff,#f2eeea_55%,#e4deeb)] font-serif text-[22px] text-[rgb(var(--accent))]">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              initialOf(user)
            )}
          </span>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-[11px] text-ink/80 transition-colors hover:bg-white"
            >
              <Camera size={12} />
              选择图片
            </button>
            {avatar ? (
              <button
                type="button"
                onClick={() => setAvatar(undefined)}
                className="ml-2 text-[10.5px] text-muted transition-colors hover:text-ink"
              >
                恢复默认
              </button>
            ) : null}
            <p className="mt-1.5 text-[9.5px] leading-relaxed text-muted/70">
              ≤2MB，自动压到 256×256；只存一张，不保留历史
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void pickAvatar(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>

        <label className="mt-4 block">
          <span className="text-[10px] tracking-[0.14em] text-muted">名字</span>
          <input
            value={name}
            maxLength={24}
            onChange={(event) => setName(event.target.value)}
            placeholder={user?.handle ?? '你的名字'}
            className="mt-1 h-9 w-full rounded-lg border border-black/10 bg-white/60 px-3 text-[12.5px] text-ink outline-none focus:border-[rgb(var(--copper))]/60 focus-visible:outline-none"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-[10px] tracking-[0.14em] text-muted">个签</span>
          <input
            value={bio}
            maxLength={40}
            onChange={(event) => setBio(event.target.value)}
            placeholder="一句话介绍自己"
            className="mt-1 h-9 w-full rounded-lg border border-black/10 bg-white/60 px-3 text-[12.5px] text-ink outline-none focus:border-[rgb(var(--copper))]/60 focus-visible:outline-none"
          />
        </label>

        {error ? <p className="mt-2 text-[10.5px] text-[#a54a3c]">{error}</p> : null}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 flex-1 rounded-full border border-black/10 text-[12px] text-muted transition-colors hover:text-ink"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className={cn(
              'h-9 flex-1 rounded-full border border-[rgb(var(--accent))]/25 bg-white/65 text-[12px] font-medium text-[rgb(var(--accent))] backdrop-blur-md transition-colors hover:bg-white/85',
              busy ? 'opacity-60' : 'hover:opacity-90',
            )}
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
