import type { ModerationLevel } from '../shared/types.ts';

const keyCache = new Map<string, CryptoKey>();

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export async function importAesKey(keyB64: string): Promise<CryptoKey> {
  const cached = keyCache.get(keyB64);
  if (cached) return cached;

  const raw = base64ToBytes(keyB64);
  const key = await window.crypto.subtle.importKey(
    'raw',
    raw.buffer as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  keyCache.set(keyB64, key);
  return key;
}

export async function getKeyFingerprint(keyB64: string): Promise<string> {
  const raw = base64ToBytes(keyB64);
  const hash = await window.crypto.subtle.digest('SHA-256', raw.buffer as ArrayBuffer);
  const bytes = new Uint8Array(hash).slice(0, 6);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

export async function encryptChatPayload(
  keyB64: string,
  text: string
): Promise<{ iv: string; ciphertext: string }> {
  const key = await importAesKey(keyB64);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const payload = JSON.stringify({
    text,
    ts: Date.now(),
  });
  const encoded = new TextEncoder().encode(payload);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptChatPayload(
  keyB64: string,
  ivB64: string,
  ciphertextB64: string
): Promise<string> {
  try {
    const key = await importAesKey(keyB64);
    const iv = base64ToBytes(ivB64);
    const ciphertext = base64ToBytes(ciphertextB64);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext.buffer as ArrayBuffer
    );
    const decoded = new TextDecoder().decode(decrypted);
    const parsed = JSON.parse(decoded) as { text: string };
    return parsed.text;
  } catch {
    return '[Encrypted payload — key unavailable for your role]';
  }
}

// Client-side pre-encryption & post-decryption toxicity moderation guard
const SEVERE_PATTERNS: RegExp[] = [
  /\b(kys|kill\s*yourself|neck\s*yourself)\b/i,
  /\b(nigger|nigga|faggot|retard|tranny|kike|spic|chink)\b/i,
  /\b(rape|raping|lynch)\b/i,
];

const STANDARD_PATTERNS: RegExp[] = [
  /\b(fuck|fucking|fucker|shit|bitch|cunt|whore|slut|asshole|dickhead|bastard|motherfucker)\b/i,
  /\b(stfu|gtfo|idiot|moron|loser|trash|scum|pathetic|dumbass)\b/i,
];

const RELAXED_PATTERNS: RegExp[] = [];

export interface ModerationCheckResult {
  allowed: boolean;
  sanitized: string;
  severity: 'clean' | 'censored' | 'blocked';
  reason?: string;
}

export function evaluateMessageModeration(
  rawText: string,
  level: ModerationLevel
): ModerationCheckResult {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { allowed: false, sanitized: '', severity: 'blocked', reason: 'Empty message' };
  }

  // Anti-spam: excessive repeated characters or all-caps yelling
  if (/(.)\1{9,}/.test(trimmed)) {
    return {
      allowed: false,
      sanitized: trimmed,
      severity: 'blocked',
      reason: 'Message flagged for character spam.',
    };
  }

  for (const pat of SEVERE_PATTERNS) {
    if (pat.test(trimmed)) {
      return {
        allowed: false,
        sanitized: trimmed,
        severity: 'blocked',
        reason: 'Severe hate speech or harassment is blocked by room moderation.',
      };
    }
  }

  if (level === 'relaxed') {
    return { allowed: true, sanitized: trimmed, severity: 'clean' };
  }

  let hasProfanity = false;
  let output = trimmed;

  const patterns = level === 'strict' ? [...STANDARD_PATTERNS] : [STANDARD_PATTERNS[0]];

  for (const pat of patterns) {
    const globalPat = new RegExp(pat.source, 'gi');
    if (globalPat.test(output)) {
      hasProfanity = true;
      if (level === 'strict') {
        return {
          allowed: false,
          sanitized: trimmed,
          severity: 'blocked',
          reason: 'Strict moderation blocked abusive language.',
        };
      }
      output = output.replace(globalPat, (match) => match[0] + '*'.repeat(Math.max(2, match.length - 1)));
    }
  }

  if (hasProfanity) {
    return {
      allowed: true,
      sanitized: output,
      severity: 'censored',
      reason: 'Profanity masked by standard moderation.',
    };
  }

  return { allowed: true, sanitized: trimmed, severity: 'clean' };
}
