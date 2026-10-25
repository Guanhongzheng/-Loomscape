'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Input, Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { useAuth } from '@/lib/auth';
import { toast } from '@/components/ui/toast';

type Mode = 'login' | 'register';

export function AuthDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handle, setHandle] = useState('');
  const [error, setError] = useState('');
  const { login, register, enterAsGuest, busy } = useAuth();

  // The component stays mounted after it closes, so without this a later visit
  // reopened on the previous tab with the previous input — after signing out
  // the form was still in 注册 mode and submitted a duplicate registration.
  useEffect(() => {
    if (!open) return;
    setMode('login');
    setPassword('');
    setHandle('');
    setError('');
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, handle);
      toast(mode === 'login' ? '已登录' : '账号已创建', 'success');
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作未完成');
    }
  };

  const guest = async () => {
    try {
      await enterAsGuest();
      toast('已以访客身份进入', 'success');
      onSuccess?.();
      onClose();
    } catch {
      setError('无法创建访客会话');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === 'login' ? '回到你的工作台' : '建立本地账户'}
      description="账户、密钥与作品都保存在这台设备的浏览器里，不经过服务器。"
    >
      <Segmented
        value={mode}
        onChange={(next) => setMode(next)}
        options={[
          { value: 'login', label: '登录' },
          { value: 'register', label: '注册' },
        ]}
        className="mb-6"
      />

      <form onSubmit={submit} className="space-y-4">
        <Field label="邮箱">
          <Input
            type="email"
            required
            autoComplete="email"
            placeholder="you@studio.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        {mode === 'register' ? (
          <Field label="昵称" hint="留空则使用邮箱前缀。">
            <Input
              placeholder="织者"
              maxLength={24}
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
            />
          </Field>
        ) : null}

        <Field label="密码" hint={mode === 'register' ? '至少 8 位，使用 PBKDF2 加盐后存储。' : undefined}>
          <Input
            type="password"
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        {error ? (
          <p className="rounded-lg bg-[#f3e2df] px-3 py-2 text-[12px] text-[#8c3b32]">{error}</p>
        ) : null}

        <Button type="submit" variant="primary" size="md" className="w-full" disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : null}
          {mode === 'login' ? '登录' : '创建账户'}
          {!busy ? <ArrowRight size={15} /> : null}
        </Button>
      </form>

      <div className="mt-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-[rgb(var(--line))]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted/70">或</span>
        <span className="h-px flex-1 bg-[rgb(var(--line))]" />
      </div>

      <Button variant="ghost" size="md" className="mt-4 w-full" onClick={guest}>
        以访客身份继续
      </Button>
    </Dialog>
  );
}
