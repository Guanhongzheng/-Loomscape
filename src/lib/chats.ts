'use client';

import { STORES, all, get, put, remove } from './db';
import { opaqueId } from './id';
import type { RecallHit } from './memory';

/** Same set the workbench renders; kept here so stored and live turns agree. */
export type ChatMode = 'cloud' | 'local' | 'retrieval' | 'calc';

export type ChatTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  mode?: ChatMode;
  /** Retrieval hits behind an answer, so a restored transcript still cites. */
  sources?: RecallHit[];
};

export type ChatSession = {
  id: string;
  owner: string;
  title: string;
  turns: ChatTurn[];
  createdAt: number;
  updatedAt: number;
};

export type ChatSummary = {
  id: string;
  title: string;
  updatedAt: number;
  turns: number;
};

/**
 * A transcript is rewritten whole on every save (it is a few hundred KB at
 * most), and only the tail is kept: an unbounded session would eventually make
 * every save slower and every restore heavier than the conversation is worth.
 */
const MAX_TURNS = 60;

export function newChatId(): string {
  return opaqueId('chat');
}

/** First thing the person said, flattened to one line. */
export function deriveTitle(turns: ChatTurn[]): string {
  const first = turns.find((turn) => turn.role === 'user' && turn.text.trim());
  if (!first) return '新会话';
  const flat = first.text.replace(/\s+/g, ' ').trim();
  return flat.length > 22 ? `${flat.slice(0, 22)}…` : flat;
}

export async function listChats(owner: string): Promise<ChatSummary[]> {
  try {
    const rows = await all<ChatSession>(STORES.chats);
    return rows
      .filter((row) => row.owner === owner && row.turns.length > 0)
      .map((row) => ({
        id: row.id,
        title: row.title,
        updatedAt: row.updatedAt,
        turns: row.turns.filter((turn) => turn.role === 'assistant').length,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function loadChat(id: string): Promise<ChatSession | null> {
  try {
    return (await get<ChatSession>(STORES.chats, id)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Upserts a transcript. Returns `null` for an empty one: creating a session
 * before the first message would fill the list with "新会话" rows that hold
 * nothing and can only be deleted.
 */
export async function saveChat(input: {
  id: string;
  owner: string;
  title?: string;
  turns: ChatTurn[];
}): Promise<ChatSession | null> {
  const turns = input.turns
    .filter((turn) => turn.text.trim().length > 0)
    .slice(-MAX_TURNS);
  if (turns.length === 0) return null;

  const previous = await loadChat(input.id);
  const now = Date.now();
  const session: ChatSession = {
    id: input.id,
    owner: input.owner,
    title: input.title?.trim() || deriveTitle(turns),
    turns,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  await put(STORES.chats, session);
  return session;
}

export async function deleteChat(id: string): Promise<void> {
  await remove(STORES.chats, id);
}
