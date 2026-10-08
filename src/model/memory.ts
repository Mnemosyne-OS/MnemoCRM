/**
 * What a client note looks like once it is a chronicle in the memory.
 *
 * The line names the client and the date inside its own text, so a later
 * question asked anywhere in Mnemosyne ("what did the restaurant order?")
 * finds it without knowing it came from MnemoCRM. The checksum is the text's
 * own fingerprint, so sending the whole book again only adds what is new.
 */
import { sha256Hex } from './sha256';
import type { Client, TimelineEntry } from './types';

export interface MemoryLine {
  content: string;
  sourceRef: string;
  checksum: string;
}

export function memoryLine(client: Client, entry: TimelineEntry, kindLabel: string): MemoryLine {
  const who = client.company ? `${client.name} (${client.company})` : client.name;
  const day = entry.at.slice(0, 10);
  const content = `MnemoCRM · ${who} · ${kindLabel} · ${day}\n${entry.text}`;
  return {
    content,
    sourceRef: `mnemo-crm/client/${client.id}/${entry.id}`,
    checksum: sha256Hex(content),
  };
}

/** Entries present in `next` and not in `prev`: what a save just added. */
export function newEntries(prev: Client | undefined, next: Client): TimelineEntry[] {
  const known = new Set((prev?.timeline ?? []).map((e) => e.id));
  return next.timeline.filter((e) => !known.has(e.id));
}

/** The client book as plain text for the "what we know" prompt: the ground truth, given in full. */
export function bookFacts(client: Client, dealLines: string[], kindLabel: (k: string) => string): string {
  const facts = [
    client.company && `Company: ${client.company}`,
    client.source && `Came from: ${client.source}`,
    client.tags.length > 0 && `Tags: ${client.tags.join(', ')}`,
    client.contactConsent && `Agrees to be contacted again: ${client.contactConsent.value ? 'yes' : 'NO'}`,
    client.followUp && `Next follow-up planned: ${client.followUp.date}${client.followUp.note ? ` (${client.followUp.note})` : ''}`,
    ...dealLines.map((d) => `Deal: ${d}`),
  ].filter(Boolean);
  const history = [...client.timeline]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 40)
    .map((e) => `[${e.at.slice(0, 10)}] ${kindLabel(e.kind)}: ${e.text}`);
  return [...facts, '', 'History (newest first):', ...(history.length ? history : ['(nothing written yet)'])].join('\n');
}
