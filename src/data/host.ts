/**
 * Everything MnemoCRM asks of the host, in one place.
 *
 * Rule 9: every bridge call carries its own deadline. The SDK's default is
 * human-paced (minutes) because the FIRST gated call opens a permission
 * dialog; file calls after that answer in milliseconds, so they get 15 s.
 * The permission-opening calls (choosing a folder, the agenda) keep the long
 * default: a person reading a dialog must not be timed out.
 */
import { MnemoCartridgeSDK } from '../sdk/mnemo-sdk';
import type { DirEntry, FolderIO } from './folderStore';

/** Must match "name" in mnemo-plugin.json. */
export const PLUGIN_ID = '@mnemosyne-plugins/mnemo-crm';

export const sdk = new MnemoCartridgeSDK(PLUGIN_ID);

const IO_TIMEOUT_MS = 15_000;

export const hostIO: FolderIO = {
  mkdir: (dirPath) => sdk.invoke('dialog.mkdir', { dirPath }, IO_TIMEOUT_MS),
  readDir: (dirPath) =>
    sdk.invoke<{ success: boolean; files?: DirEntry[]; error?: string }>('dialog.readDir', { dirPath }, IO_TIMEOUT_MS),
  readFile: (filePath) => sdk.invoke('dialog.readFile', { filePath }, IO_TIMEOUT_MS),
  writeFile: (filePath, content) => sdk.invoke('dialog.writeFile', { filePath, content }, IO_TIMEOUT_MS),
};

/** Opens the host's folder picker. Resolves null when the person cancels. */
export function pickFolder(): Promise<string | null> {
  return sdk.selectFolder();
}

// ── Where the book lives ──────────────────────────────────────────────────
// localStorage is primary and synchronous; the host mirror (doc 73) is what
// survives the iframe's origin changing under it (dev port vs packaged).

const FOLDER_KEY = 'mnemo_crm_folder';

export function readRememberedFolder(): string | null {
  try {
    return localStorage.getItem(FOLDER_KEY);
  } catch (err) {
    console.warn('[mnemo-crm] localStorage unreadable:', err);
    return null;
  }
}

export async function readMirroredFolder(): Promise<string | null> {
  const res = await sdk.invoke<{ state: { folder?: unknown } | null }>('state.get', undefined, IO_TIMEOUT_MS);
  const folder = res?.state?.folder;
  return typeof folder === 'string' && folder.trim() ? folder : null;
}

export async function rememberFolder(folder: string): Promise<void> {
  try {
    localStorage.setItem(FOLDER_KEY, folder);
  } catch (err) {
    console.warn('[mnemo-crm] localStorage write refused:', err);
  }
  await sdk.invoke('state.set', { state: { folder } }, IO_TIMEOUT_MS);
}

// ── The host agenda ───────────────────────────────────────────────────────

export interface AgendaOutcome {
  added: number;
  /** Refused by the host as unreadable. Absent when the host did not say. */
  skipped?: number;
}

/**
 * Put a follow-up in the host calendar so it rings on the canvas even with
 * this cartridge closed. `title` comes already translated.
 */
export async function addFollowUpToAgenda(day: string, title: string, note?: string): Promise<AgendaOutcome> {
  const res = await sdk.invoke<{ added?: number; skipped?: number }>('agenda.add', {
    events: [
      {
        title,
        start: `${day}T09:00:00`,
        end: `${day}T09:15:00`,
        ...(note ? { description: note } : {}),
        alarmMinutesBefore: 0,
      },
    ],
  });
  const outcome: AgendaOutcome = { added: typeof res?.added === 'number' ? res.added : 0 };
  if (typeof res?.skipped === 'number') outcome.skipped = res.skipped;
  return outcome;
}

// ── Product photos ────────────────────────────────────────────────────────
// A photo is referenced by its path, never copied: the person's picture stays
// where they keep it. Read through the host as a data URL, cached per path.

export async function pickImage(filterName: string): Promise<string | null> {
  const path = await sdk.selectFile([{ name: filterName, extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]);
  return typeof path === 'string' && path ? path : null;
}

const imageCache = new Map<string, Promise<string>>();

/** Resolves a data URL, or rejects with the host's reason. A failure is not cached: a retry can succeed. */
export function readImage(path: string): Promise<string> {
  const hit = imageCache.get(path);
  if (hit) return hit;
  const pending = sdk
    .invoke<{ success: boolean; content?: string; isBinary?: boolean; error?: string }>('dialog.readFile', { filePath: path }, IO_TIMEOUT_MS)
    .then((res) => {
      if (res?.success && res.isBinary && typeof res.content === 'string' && res.content.startsWith('data:image/')) return res.content;
      throw new Error(res?.error ?? 'NOT_AN_IMAGE');
    });
  imageCache.set(path, pending);
  pending.catch(() => imageCache.delete(path));
  return pending;
}

// ── Memory (lot 3) ────────────────────────────────────────────────────────
// Everything here is DEMAND-driven: an inference can spend cloud credits, so
// nothing below runs on its own when a panel opens.

/** The spine every MnemoCRM chronicle carries. Host rule: ^[A-Z0-9_]{1,32}$ */
export const CRM_SPINE = 'CRM_NOTE';

let sandbox: Promise<{ vault: string; unlocked: boolean }> | null = null;

/** This cartridge's own walled vault. Created on first use; a failure is not cached. */
export function ensureSandbox(): Promise<{ vault: string; unlocked: boolean }> {
  if (!sandbox) {
    sandbox = sdk.ensureSandbox().then(async ({ vault, unlocked }) => {
      try {
        await sdk.describeVaultTile({ icon: '📇', metrics: [{ label: 'Notes', spine: CRM_SPINE }] });
      } catch (err) {
        // The tile is decoration; the vault works without it.
        console.warn('[mnemo-crm] vault tile not described:', err);
      }
      return { vault, unlocked };
    });
    sandbox.catch(() => {
      sandbox = null;
    });
  }
  return sandbox;
}

/** One chronicle. The checksum lets the host drop a line it already has. */
export async function rememberLine(content: string, sourceRef: string, checksum: string): Promise<void> {
  const { vault } = await ensureSandbox();
  await sdk.invoke('social.ingest', { vault, content, spineType: CRM_SPINE, sourceRef, checksum }, IO_TIMEOUT_MS);
}

export interface MemorySource {
  vault: string;
  text: string;
  filePath?: string;
}

export interface InferAnswer {
  text: string;
  sources: MemorySource[];
}

/** One inference. `rag: false` keeps the memory out (extraction jobs must not be fed unrelated notes). */
export async function infer(prompt: string, opts: { rag: boolean; ragQuery?: string; maxTokens?: number }): Promise<InferAnswer> {
  const res = await sdk.invoke<{
    success?: boolean;
    text?: string;
    response?: string;
    content?: string;
    answer?: string;
    error?: string;
    ragSources?: MemorySource[];
  }>('model.infer', {
    prompt,
    temperature: 0.2,
    maxTokens: opts.maxTokens ?? 900,
    ...(opts.rag ? (opts.ragQuery ? { ragQuery: opts.ragQuery } : {}) : { disableRAG: true }),
  });
  const text = res?.text ?? res?.response ?? res?.content ?? res?.answer;
  if (res?.success === false || typeof text !== 'string' || !text.trim()) throw new Error(res?.error ?? 'EMPTY_ANSWER');
  const sources = Array.isArray(res.ragSources)
    ? res.ragSources.filter((s) => s && typeof s.text === 'string').slice(0, 12)
    : [];
  return { text: text.trim(), sources };
}

// ── Dictation: the host's microphone, never the frame's ───────────────────

export async function dictationStatus(): Promise<{ available: boolean; busy: boolean }> {
  const res = await sdk.invoke<{ available?: boolean; busy?: boolean }>('speech.status', undefined, IO_TIMEOUT_MS);
  return { available: res?.available === true, busy: res?.busy === true };
}

export const startDictation = () => sdk.invoke('speech.listenStart');
export const cancelDictation = () => sdk.invoke('speech.listenCancel', undefined, IO_TIMEOUT_MS);

/** Transcribing an up-to-120 s clip can take a while on a local engine: 90 s, not the 15 s file budget. */
export async function stopDictation(lang: string): Promise<string> {
  const res = await sdk.invoke<{ text?: string }>('speech.listenStop', { lang }, 90_000);
  const text = typeof res?.text === 'string' ? res.text.trim() : '';
  if (!text) throw new Error('NO_SPEECH');
  return text;
}

/** A transcript exported by the Recorder, or any text file the person picks. */
export async function pickTextFile(filterName: string): Promise<{ path: string; text: string } | null> {
  const path = await sdk.selectFile([{ name: filterName, extensions: ['md', 'txt'] }]);
  if (typeof path !== 'string' || !path) return null;
  const res = await sdk.invoke<{ success: boolean; content?: string; isBinary?: boolean; error?: string }>(
    'dialog.readFile',
    { filePath: path },
    IO_TIMEOUT_MS,
  );
  if (!res?.success || res.isBinary || typeof res.content !== 'string') throw new Error(res?.error ?? 'UNREADABLE_FILE');
  return { path, text: res.content };
}

// ── The book to come back to after a demo ─────────────────────────────────

const PREVIOUS_KEY = 'mnemo_crm_previous_folder';

export function readPreviousFolder(): string | null {
  try {
    return localStorage.getItem(PREVIOUS_KEY);
  } catch (err) {
    console.warn('[mnemo-crm] localStorage unreadable:', err);
    return null;
  }
}

export function rememberPreviousFolder(folder: string | null): void {
  try {
    if (folder) localStorage.setItem(PREVIOUS_KEY, folder);
    else localStorage.removeItem(PREVIOUS_KEY);
  } catch (err) {
    console.warn('[mnemo-crm] previous folder not remembered:', err);
  }
}

export function openFolderInOS(folder: string): Promise<{ success: boolean; error?: string }> {
  return sdk.openInOS(folder);
}

// ── License (doc 124 §14) ─────────────────────────────────────────────────
// One word from the host. A bridge that fails or an old host without the
// action is `unknown`, and unknown never refuses anything.

export type LicenseWord = 'active' | 'inactive' | 'unknown';

export async function readLicense(): Promise<LicenseWord> {
  try {
    const res = await sdk.invoke<{ verdict?: unknown }>('license.status', undefined, IO_TIMEOUT_MS);
    return res?.verdict === 'active' || res?.verdict === 'inactive' ? res.verdict : 'unknown';
  } catch (err) {
    console.warn('[mnemo-crm] license status unreadable → unknown:', err);
    return 'unknown';
  }
}

export function offerLicense(): Promise<unknown> {
  return sdk.invoke('license.offer', undefined, IO_TIMEOUT_MS);
}

// ── Import files ──────────────────────────────────────────────────────────

export async function pickFile(filterName: string, extensions: string[]): Promise<string | null> {
  const path = await sdk.selectFile([{ name: filterName, extensions }]);
  return typeof path === 'string' && path ? path : null;
}

export interface ReadFileAnswer {
  content: string;
  isBinary: boolean;
}

/** A spreadsheet can be large: 30 s, not the 15 s budget. */
export async function readAnyFile(path: string): Promise<ReadFileAnswer> {
  const res = await sdk.invoke<{ success: boolean; content?: string; isBinary?: boolean; error?: string }>('dialog.readFile', { filePath: path }, 30_000);
  if (!res?.success || typeof res.content !== 'string') throw new Error(res?.error ?? 'UNREADABLE_FILE');
  return { content: res.content, isBinary: res.isBinary === true };
}

// ── The PDF engines (reader.* — the same doors MnemoReader uses) ──────────

export interface RenderedPage {
  /** JPEG, base64 without a data: prefix. */
  image: string;
  pages: number;
  w: number;
  h: number;
}

/** `page` is 0-based, as the host counts. Rendering a page is quick; 60 s covers a cold renderer. */
export async function renderPdfPage(path: string, page: number): Promise<RenderedPage> {
  const res = await sdk.invoke<{ success?: boolean; data?: Partial<RenderedPage>; error?: string }>('reader.renderPage', { filePath: path, page }, 60_000);
  const d = res?.data;
  if (!res?.success || !d || typeof d.image !== 'string' || typeof d.pages !== 'number') throw new Error(res?.error ?? 'RENDER_FAILED');
  return { image: d.image.replace(/^data:[^,]*,/, ''), pages: d.pages, w: Number(d.w) || 0, h: Number(d.h) || 0 };
}

/** The whole text of the PDF (OCR when the page is a scan). A long scan takes minutes: 5 min. */
export async function extractPdfText(path: string): Promise<string> {
  const res = await sdk.invoke<{ success?: boolean; data?: { text?: string }; error?: string }>('reader.extractDocument', { filePath: path }, 300_000);
  const text = res?.data?.text;
  if (res?.success === false || typeof text !== 'string') throw new Error(res?.error ?? 'EXTRACT_FAILED');
  return text;
}

export class NoVisionError extends Error {
  constructor() {
    super('NO_VISION');
  }
}

/** One look at one image. A model that cannot see REFUSES (doc 74): that becomes NoVisionError, never a blind answer. */
export async function inferOnImage(prompt: string, jpegBase64: string): Promise<string> {
  const res = await sdk.invoke<{ success?: boolean; text?: string; response?: string; content?: string; error?: string; errorCode?: string }>(
    'model.infer',
    { prompt, temperature: 0.1, maxTokens: 2000, disableRAG: true, disableImageRecall: true, images: [{ mimeType: 'image/jpeg', data: jpegBase64 }] },
    180_000,
  );
  if (res?.errorCode === 'NO_VISION' || res?.error === 'NO_VISION') throw new NoVisionError();
  const text = res?.text ?? res?.response ?? res?.content;
  if (res?.success === false || typeof text !== 'string' || !text.trim()) throw new Error(res?.error ?? 'EMPTY_ANSWER');
  return text;
}

/** A cut-out picture into MnemoCRM's own vault, where the image memory finds it. Resolves the path the host wrote. */
export async function saveProductPhoto(name: string, jpegBase64: string): Promise<string> {
  await ensureSandbox();
  const res = await sdk.invoke<{ success?: boolean; data?: { path?: string }; error?: string }>('vault.sandbox.saveImage', { name, base64: jpegBase64 }, 30_000);
  const path = res?.data?.path;
  if (!res?.success || typeof path !== 'string') throw new Error(res?.error ?? 'PHOTO_NOT_SAVED');
  return path;
}
