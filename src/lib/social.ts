'use client';

import { STORES, all, byIndex, put } from './db';
import { opaqueId } from './id';

export type Contact = { uid: string; handle: string; addedAt: number };

export type Announcement = {
  text: string;
  updatedAt: number;
  by: string;
};

export type Conversation = {
  id: string;
  kind: 'direct' | 'group';
  name: string;
  members: string[];
  code?: string;
  /** Groups only: one pinned notice, versioned by `updatedAt`. */
  announcement?: Announcement;
  createdAt: number;
  updatedAt: number;
};

export type Message = {
  id: string;
  conversationId: string;
  authorUid: string;
  authorHandle: string;
  text: string;
  createdAt: number;
};

export const CHANNEL_NAME = 'loomscape.channel';

export async function listContacts(): Promise<Contact[]> {
  try {
    const rows = await all<Contact>(STORES.contacts);
    return rows.sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

export async function addContact(uid: string, handle: string): Promise<Contact> {
  const clean = uid.trim().toUpperCase();
  const contact: Contact = {
    uid: clean,
    handle: handle.trim() || `织者 ${clean.slice(0, 4)}`,
    addedAt: Date.now(),
  };
  await put(STORES.contacts, contact);
  return contact;
}

export async function listConversations(): Promise<Conversation[]> {
  try {
    const rows = await all<Conversation>(STORES.conversations);
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

async function saveConversation(conversation: Conversation): Promise<Conversation> {
  await put(STORES.conversations, conversation);
  return conversation;
}

export async function ensureDirect(self: { uid: string; handle: string }, contact: Contact) {
  const existing = (await listConversations()).find(
    (row) => row.kind === 'direct' && row.members.includes(contact.uid),
  );
  if (existing) return existing;

  return saveConversation({
    id: opaqueId('dm'),
    kind: 'direct',
    name: contact.handle,
    members: [self.uid, contact.uid],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function createGroup(
  self: { uid: string; handle: string },
  name: string,
  members: string[],
) {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  return saveConversation({
    id: opaqueId('grp'),
    kind: 'group',
    name: name.trim() || '新群组',
    members: [self.uid, ...members],
    code,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  try {
    const rows = await byIndex<Message>(STORES.messages, 'conversationId', conversationId);
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function setAnnouncement(
  conversation: Conversation,
  text: string,
  by: string,
): Promise<Conversation> {
  return saveConversation({
    ...conversation,
    announcement: { text: text.trim().slice(0, 400), updatedAt: Date.now(), by },
    updatedAt: Date.now(),
  });
}

/**
 * Counts what arrived after the reader's watermark. Deriving the number from
 * the stored messages keeps the badge correct across reloads and tabs, which an
 * in-memory counter cannot do.
 */
export async function countUnread(
  conversationId: string,
  since: number,
  selfUid: string,
): Promise<number> {
  const rows = await listMessages(conversationId);
  return rows.filter((row) => row.createdAt > since && row.authorUid !== selfUid).length;
}

export async function sendMessage(input: {
  conversationId: string;
  authorUid: string;
  authorHandle: string;
  text: string;
}): Promise<Message> {
  const message: Message = {
    id: opaqueId('msg'),
    conversationId: input.conversationId,
    authorUid: input.authorUid,
    authorHandle: input.authorHandle,
    text: input.text.slice(0, 2000),
    createdAt: Date.now(),
  };
  await put(STORES.messages, message);

  const conversations = await listConversations();
  const target = conversations.find((row) => row.id === input.conversationId);
  if (target) await saveConversation({ ...target, updatedAt: message.createdAt });

  return message;
}
