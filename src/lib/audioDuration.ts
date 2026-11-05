/**
 * Real audio duration from the bytes (no decoder, no dependencies).
 * Supports MP3 (frame walk, handles VBR) and WAV (PCM header). Returns null if
 * the format is not recognised, so callers can fall back to an estimate.
 */

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export function mp3DurationSeconds(bytes: Uint8Array): number | null {
  let pos = 0;
  // Skip ID3v2 tag.
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
    pos = 10 + size;
  }
  let seconds = 0;
  let frames = 0;
  while (pos + 4 <= bytes.length) {
    const b1 = bytes[pos]!;
    const b2 = bytes[pos + 1]!;
    if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) {
      pos += 1; // resync
      continue;
    }
    const version = (b2 >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (b2 >> 1) & 0x03; // 1 = Layer III
    const b3 = bytes[pos + 2]!;
    const bitrateIndex = (b3 >> 4) & 0x0f;
    const sampleIndex = (b3 >> 2) & 0x03;
    const padding = (b3 >> 1) & 0x01;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) {
      pos += 1;
      continue;
    }
    const bitrate = (version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIndex]! * 1000;
    const sampleRate = SAMPLE_RATES[version]?.[sampleIndex];
    if (!sampleRate) {
      pos += 1;
      continue;
    }
    const samplesPerFrame = version === 3 ? 1152 : 576;
    const frameLength = Math.floor((samplesPerFrame / 8) * bitrate / sampleRate) + padding;
    if (frameLength < 4) {
      pos += 1;
      continue;
    }
    seconds += samplesPerFrame / sampleRate;
    frames += 1;
    pos += frameLength;
  }
  return frames > 3 ? seconds : null;
}

export function wavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") byteRate = view.getUint32(offset + 16, true);
    if (id === "data") {
      dataSize = Math.min(size, bytes.length - offset - 8);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : null;
}

export function audioDurationSeconds(bytes: Uint8Array, contentType: string): number | null {
  if (contentType.includes("wav")) return wavDurationSeconds(bytes);
  return mp3DurationSeconds(bytes) ?? wavDurationSeconds(bytes);
}

/** Estimate only used when the real duration cannot be read (~150 wpm). */
export function estimateSecondsFromText(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / 150) * 60));
}
