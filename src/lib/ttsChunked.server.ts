/**
 * Long-text TTS. The provider limits input to ~4000 characters; instead of
 * silently truncating, the text is split at sentence boundaries, every part is
 * synthesised (small concurrency), and the audio parts are joined in order.
 * Real duration of every part is measured from its bytes.
 */
import { mapWithConcurrency } from "./concurrency";
import { audioDurationSeconds, estimateSecondsFromText } from "./audioDuration";
import { TTS_MAX_CHARS, splitTextForTts } from "./ttsSplit";

import { TtsUnavailableError } from "./tts.server";
export { TtsUnavailableError };

export { TTS_MAX_CHARS, splitTextForTts };

async function synthesizeOne(text: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const gateway = process.env["TTS_GATEWAY_URL"];
  const key = process.env["TTS_API_KEY"];
  const voice = process.env["TTS_VOICE"] || "alloy";
  const format = process.env["TTS_FORMAT"] || "mp3";
  if (!gateway) throw new TtsUnavailableError("TTS_GATEWAY_URL is not configured");
  if (!key) throw new TtsUnavailableError("TTS_API_KEY is not configured");

  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(gateway, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env["TTS_MODEL"] || "tts-1", voice, input: text, response_format: format }),
    });
    lastStatus = response.status;
    if (response.status === 402) throw new TtsUnavailableError("CREDITS_REQUIRED");
    if (response.ok) {
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") || (format === "wav" ? "audio/wav" : "audio/mpeg"),
      };
    }
    if (response.status !== 429 && response.status < 500) break;
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
  }
  throw new TtsUnavailableError(lastStatus === 429 ? "RATE_LIMIT" : "GATEWAY_ERROR");
}

export type SynthesizedAudio = {
  bytes: Uint8Array;
  contentType: string;
  /** Real duration measured from the audio, or an estimate when undecodable. */
  durationSeconds: number;
  durationIsEstimate: boolean;
  parts: { text: string; durationSeconds: number }[];
};

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Strips a leading ID3v2 tag so joined MP3 parts play as one stream. */
function stripId3(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
    return bytes.subarray(10 + size);
  }
  return bytes;
}

export async function synthesizeLongText(text: string): Promise<SynthesizedAudio> {
  const pieces = splitTextForTts(text);
  if (pieces.length === 0) throw new TtsUnavailableError("EMPTY_TEXT");
  const results = await mapWithConcurrency(pieces, 2, (piece) => synthesizeOne(piece));
  const contentType = results[0]!.contentType;
  if (contentType.includes("wav") && results.length > 1) {
    // Joining WAV needs header rewriting; require mp3 for long text.
    throw new TtsUnavailableError("WAV_CANNOT_BE_JOINED_SET_TTS_FORMAT_MP3");
  }

  let estimated = false;
  const parts = results.map((r, i) => {
    const real = audioDurationSeconds(r.bytes, r.contentType);
    if (real === null) estimated = true;
    return { text: pieces[i]!, durationSeconds: real ?? estimateSecondsFromText(pieces[i]!) };
  });
  const bytes = concat(results.map((r, i) => (i === 0 ? r.bytes : stripId3(r.bytes))));
  const joinedReal = audioDurationSeconds(bytes, contentType);
  const sum = parts.reduce((n, p) => n + p.durationSeconds, 0);
  return {
    bytes,
    contentType,
    durationSeconds: joinedReal ?? sum,
    durationIsEstimate: estimated && joinedReal === null,
    parts,
  };
}
