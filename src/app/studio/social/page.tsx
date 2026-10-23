'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Hash, Plus, Send, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { Panel, WorkbenchHeader } from '@/components/studio/workbench';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import {
  CHANNEL_NAME,
  addContact,
  createGroup,
  ensureDirect,
  listContacts,
  listConversations,
  listMessages,
  sendMessage,
  type Contact,
  type Conversation,
  type Message,
} from '@/lib/social';
import { cn } from '@/lib/cn';

export default function SocialWorkbench() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [uidInput, setUidInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);

  const active = conversations.find((row) => row.id === activeId) ?? null;

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const refresh = useCallback(async () => {
    const [nextContacts, nextConversations] = await Promise.all([listContacts(), listConversations()]);
    setContacts(nextContacts);
    setConversations(nextConversations);
    setActiveId((current) => current ?? nextConversations[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    void listMessages(activeId).then(setMessages);
  }, [activeId]);

  useEffect(() => {
    if (!user) return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<{ type: string; message?: Message }>) => {
      if (event.data?.type !== 'message' || !event.data.message) return;
      const incoming = event.data.message;
      if (incoming.authorUid === user.uid) return;
      if (incoming.conversationId === activeIdRef.current) {
        setMessages((rows) =>
          rows.some((row) => row.id === incoming.id) ? rows : [...rows, incoming],
        );
      }
      void refresh();
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [user, refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const copyUid = async () => {
    if (!user) return;
    await navigator.clipboard.writeText(user.uid);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const addFriend = async () => {
    if (!user) return;
    const uid = uidInput.trim().toUpperCase();
    if (uid.length < 4) {
      toast('UID 至少 4 位', 'error');
      return;
    }
    if (uid === user.uid) {
      toast('这是你自己的 UID', 'error');
      return;
    }
    const contact = await addContact(uid, nameInput);
    const conversation = await ensureDirect({ uid: user.uid, handle: user.handle }, contact);
    setUidInput('');
    setNameInput('');
    await refresh();
    setActiveId(conversation.id);
    toast('已加入通讯录', 'success');
  };

  const makeGroup = async () => {
    if (!user) return;
    if (!groupName.trim()) {
      toast('给群组起个名字', 'error');
      return;
    }
    const group = await createGroup({ uid: user.uid, handle: user.handle }, groupName, groupMembers);
    setGroupOpen(false);
    setGroupName('');
    setGroupMembers([]);
    await refresh();
    setActiveId(group.id);
    toast(`群组已建立 · 群号 ${group.code}`, 'success');
  };

  const submit = async () => {
    if (!user || !active || !draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    const message = await sendMessage({
      conversationId: active.id,
      authorUid: user.uid,
      authorHandle: user.handle,
      text,
    });
    setMessages((rows) => [...rows, message]);
    channelRef.current?.postMessage({ type: 'message', message });
    await refresh();
  };

  return (
    <div>
      <WorkbenchHeader
        index="06"
        title="协作与社交"
        description="用 UID 建立通讯录，在群组里发消息。当前构建的实时链路走浏览器广播通道，同一设备的多个标签页即可互相收发。"
        actions={
          <Button variant="soft" size="sm" onClick={() => setGroupOpen(true)}>
            <Plus size={13} />
            新建群组
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="我的 UID" hint="把这一串给对方，即可互加">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg px-3 py-2.5 font-mono text-[13px] tracking-[0.18em] text-ink/85 shadow-[var(--shadow-inset-sm)]">
                {user?.uid ?? '——'}
              </code>
              <button
                type="button"
                onClick={copyUid}
                aria-label="复制 UID"
                className="grid h-10 w-10 place-items-center rounded-lg text-muted shadow-[var(--shadow-neu-sm)] transition-colors hover:text-ink"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <Input
                value={uidInput}
                onChange={(event) => setUidInput(event.target.value.toUpperCase())}
                placeholder="对方的 UID"
                className="h-10 font-mono text-[12px] tracking-[0.12em]"
                maxLength={12}
              />
              <div className="flex gap-2">
                <Input
                  value={nameInput}
                  onChange={(event) => setNameInput(event.target.value)}
                  placeholder="备注名（可选）"
                  className="h-10 text-[12px]"
                />
                <Button variant="soft" size="sm" onClick={addFriend} className="shrink-0">
                  添加
                </Button>
              </div>
            </div>
          </Panel>

          <Panel title="会话" hint={`${conversations.length} 个`} bodyClassName="p-2.5">
            {conversations.length === 0 ? (
              <p className="px-2 py-3 text-[11.5px] leading-relaxed text-muted/75">
                还没有会话。添加一个 UID，或建一个群组。
              </p>
            ) : (
              <ul className="space-y-1">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(conversation.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors',
                        conversation.id === activeId
                          ? 'bg-[rgb(var(--surface))] shadow-[var(--shadow-neu-sm)]'
                          : 'hover:bg-[rgb(var(--surface))]/60',
                      )}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[rgb(var(--sunken))] text-muted shadow-[var(--shadow-inset-sm)]">
                        {conversation.kind === 'group' ? (
                          <Users size={13} strokeWidth={1.7} />
                        ) : (
                          <span className="font-mono text-[10px]">
                            {conversation.name.slice(0, 1)}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-ink/85">
                          {conversation.name}
                        </span>
                        <span className="mt-0.5 block font-mono text-[9.5px] text-muted/60">
                          {conversation.kind === 'group'
                            ? `群号 ${conversation.code} · ${conversation.members.length} 人`
                            : '直接会话'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel
          className="flex min-h-[560px] flex-col"
          bodyClassName="flex min-h-0 flex-1 flex-col p-0"
          title={active ? active.name : '会话'}
          hint={
            active
              ? active.kind === 'group'
                ? `${active.members.length} 位成员 · 群号 ${active.code}`
                : '端到端留在本机'
              : '选择左侧会话'
          }
          action={
            active ? (
              <span className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted/55">
                <Hash size={10} />
                {active.kind}
              </span>
            ) : null
          }
        >
          {!active ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <Users size={22} strokeWidth={1.4} className="text-muted/40" />
              <h3 className="mt-4 font-serif text-[16px] text-ink/80">还没有打开的会话</h3>
              <p className="mt-2 max-w-[40ch] text-[11.5px] leading-relaxed text-muted">
                复制你的 UID 发给自己另一台设备的标签页，或新建一个群组，就能开始对话。
              </p>
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <p className="text-[11.5px] text-muted/70">
                      这里还没有消息。第一条发出去，链路就通了。
                    </p>
                  </div>
                ) : (
                  messages.map((message) => {
                    const mine = message.authorUid === user?.uid;
                    return (
                      <div
                        key={message.id}
                        className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}
                      >
                        <div className="mb-1 flex items-center gap-2 px-1 font-mono text-[9px] text-muted/55">
                          <span>{mine ? '我' : message.authorHandle}</span>
                          <span>
                            {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div
                          className={cn(
                            'max-w-[76%] rounded-2xl px-4 py-2.5 text-[12.5px] leading-relaxed',
                            mine
                              ? 'bg-[rgb(var(--accent))] text-[rgb(var(--paper))]'
                              : 'bg-[rgb(var(--surface))] text-ink/85 shadow-[var(--shadow-neu-sm)]',
                          )}
                        >
                          {message.text}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              <div className="border-t border-[rgb(var(--line))]/55 p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void submit();
                      }
                    }}
                    rows={1}
                    placeholder="写点什么，Enter 发送"
                    className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl bg-[rgb(var(--sunken))] px-3.5 py-3 text-[12.5px] text-ink shadow-[var(--shadow-inset-sm)] outline-none placeholder:text-muted/55"
                  />
                  <Button
                    variant="primary"
                    size="icon"
                    onClick={submit}
                    disabled={!draft.trim()}
                    aria-label="发送"
                  >
                    <Send size={14} />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Panel>
      </div>

      <Dialog
        open={groupOpen}
        onClose={() => setGroupOpen(false)}
        title="新建群组"
        description="群号自动生成，成员从这个设备的通讯录里选。"
      >
        <div className="space-y-4">
          <Input
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="群组名称"
          />

          {contacts.length === 0 ? (
            <p className="text-[11.5px] text-muted">通讯录还是空的，先添加一个 UID。</p>
          ) : (
            <div className="space-y-1.5">
              {contacts.map((contact) => {
                const checked = groupMembers.includes(contact.uid);
                return (
                  <button
                    key={contact.uid}
                    type="button"
                    onClick={() =>
                      setGroupMembers((rows) =>
                        checked ? rows.filter((uid) => uid !== contact.uid) : [...rows, contact.uid],
                      )
                    }
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                      checked ? 'bg-[rgb(var(--surface))] shadow-[var(--shadow-neu-sm)]' : 'hover:bg-[rgb(var(--surface))]/60',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-4 w-4 place-items-center rounded border',
                        checked
                          ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent))] text-[rgb(var(--paper))]'
                          : 'border-[rgb(var(--line))]',
                      )}
                    >
                      {checked ? <Check size={10} strokeWidth={3} /> : null}
                    </span>
                    <span className="text-[12.5px] text-ink/85">{contact.handle}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted/60">{contact.uid}</span>
                  </button>
                );
              })}
            </div>
          )}

          <Button variant="primary" size="md" className="w-full" onClick={makeGroup}>
            建立群组
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
