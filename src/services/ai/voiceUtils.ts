/**
 * XOS Personal AI Agent — Production Voice Audio & Playback Utilities
 * Pure, deterministic helpers for audio quality inspection, conditional low-volume
 * normalization, PCM WAV encoding, TTS audio format validation, and contextual errors.
 * Zero browser storage, zero secret handling.
 */
import { AiServiceError, PreferredVoiceLanguage } from './agentService';

export type VoiceInputPhase =
  | 'ready'
  | 'listening'
  | 'recording'
  | 'processing'
  | 'completed'
  | 'failed';

export type AudioPlaybackPhase =
  | 'idle'
  | 'generating'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'blocked'
  | 'failed'
  | 'completed';

export type PlaybackFailureCategory =
  | 'autoplay_blocked'
  | 'network_error'
  | 'invalid_audio'
  | 'tts_failed'
  | 'unsupported_browser';

export interface PcmAnalysisResult {
  status: 'ok' | 'too_short' | 'silent';
  durationMs: number;
  rms: number;
  peak: number;
  clippedRatio: number;
  activeSpeechRatio: number;
  normalized: boolean;
  samples: Float32Array;
}

export interface ValidatedTtsAudio {
  bytes: Uint8Array;
  mimeType: string;
}

export const DEFAULT_VOICE_LANGUAGE: PreferredVoiceLanguage = 'ml-IN';
export const MIN_RECORDING_DURATION_MS = 350;
export const MAX_RECORDING_DURATION_MS = 35000;
export const MAX_RECORDED_BYTES = 2.2 * 1024 * 1024;

export const PLAYBACK_ERROR_MESSAGES: Record<PlaybackFailureCategory, string> = {
  autoplay_blocked: 'Tap Play to hear Jarvis’s response.',
  network_error: 'Audio couldn’t load. Check your connection and try again.',
  invalid_audio: 'The generated audio format couldn’t be played.',
  tts_failed: 'Voice generation failed. Your text response is still available.',
  unsupported_browser: 'Voice playback isn’t supported in this browser.'
};

export function decodeBase64ToBytes(base64: string): Uint8Array | null {
  const clean = base64.replace(/\s+/g, '');
  if (!clean || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) {
    return null;
  }
  try {
    if (typeof atob === 'function') {
      const binary = atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }
    return new Uint8Array(Buffer.from(clean, 'base64'));
  } catch {
    return null;
  }
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

export function parsePcmSampleRateFromMime(mimeType: string, fallback: number = 24000): number {
  const match = /rate=(\d{4,6})/i.exec(mimeType);
  if (!match) return fallback;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 8000 && parsed <= 96000 ? parsed : fallback;
}

export function wrapRawPcmAsWav(pcmBytes: Uint8Array, sampleRate: number = 24000): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcmBytes.byteLength, true);

  const wav = new Uint8Array(44 + pcmBytes.byteLength);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcmBytes, 44);
  return wav;
}

export function hasSupportedAudioMagicHeader(bytes: Uint8Array, mimeType: string): { valid: boolean; normalizedMime: string; isRawPcm: boolean } {
  if (bytes.length < 12) {
    return { valid: false, normalizedMime: mimeType, isRawPcm: false };
  }

  const lowerMime = mimeType.trim().toLowerCase();

  // RIFF....WAVE
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return { valid: true, normalizedMime: 'audio/wav', isRawPcm: false };
  }

  // OggS
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return { valid: true, normalizedMime: 'audio/ogg', isRawPcm: false };
  }

  // ID3 or MPEG ADTS/MP3 frame sync
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    return { valid: true, normalizedMime: 'audio/mpeg', isRawPcm: false };
  }

  // WebM / EBML
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { valid: true, normalizedMime: 'audio/webm', isRawPcm: false };
  }

  // MP4/M4A ftyp box
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return { valid: true, normalizedMime: 'audio/mp4', isRawPcm: false };
  }

  // Explicit raw PCM / L16 payload from Gemini Live/TTS
  if ((lowerMime.includes('l16') || lowerMime.includes('pcm')) && bytes.length >= 64 && bytes.length % 2 === 0) {
    return { valid: true, normalizedMime: 'audio/wav', isRawPcm: true };
  }

  return { valid: false, normalizedMime: lowerMime, isRawPcm: false };
}

export function validateAndPrepareTtsAudio(base64: string, mimeType: string = 'audio/wav'): ValidatedTtsAudio | null {
  const bytes = decodeBase64ToBytes(base64);
  if (!bytes || bytes.length < 64) {
    return null;
  }

  const magic = hasSupportedAudioMagicHeader(bytes, mimeType);
  if (!magic.valid) {
    return null;
  }

  if (magic.isRawPcm) {
    const rate = parsePcmSampleRateFromMime(mimeType, 24000);
    const wavBytes = wrapRawPcmAsWav(bytes, rate);
    return { bytes: wavBytes, mimeType: 'audio/wav' };
  }

  return { bytes, mimeType: magic.normalizedMime };
}

/**
 * Inspects decoded mono/interleaved PCM samples for duration, silence, clipping,
 * and safe conditional gain normalization.
 * - Never amplifies already clipped or clean well-leveled audio.
 * - Gently brings quiet, unclipped mobile speech toward -5 dBFS peak (max 4x gain).
 */
export function analyzeAndOptimizePcm(samples: Float32Array, sampleRate: number): PcmAnalysisResult {
  const safeRate = sampleRate > 0 ? sampleRate : 16000;
  const durationMs = Math.round((samples.length / safeRate) * 1000);

  if (samples.length === 0 || durationMs < MIN_RECORDING_DURATION_MS) {
    return {
      status: 'too_short',
      durationMs,
      rms: 0,
      peak: 0,
      clippedRatio: 0,
      activeSpeechRatio: 0,
      normalized: false,
      samples
    };
  }

  let sumSq = 0;
  let peak = 0;
  let clippedCount = 0;

  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
    if (v >= 0.98) clippedCount += 1;
    sumSq += samples[i] * samples[i];
  }

  const rms = Math.sqrt(sumSq / samples.length);
  const clippedRatio = clippedCount / samples.length;

  const frameSize = Math.max(160, Math.round(safeRate * 0.02));
  let totalFrames = 0;
  let activeFrames = 0;
  for (let start = 0; start < samples.length; start += frameSize) {
    const end = Math.min(samples.length, start + frameSize);
    let fSum = 0;
    for (let j = start; j < end; j++) {
      fSum += samples[j] * samples[j];
    }
    const fRms = Math.sqrt(fSum / (end - start));
    totalFrames += 1;
    if (fRms > 0.012) {
      activeFrames += 1;
    }
  }
  const activeSpeechRatio = totalFrames > 0 ? activeFrames / totalFrames : 0;

  if (peak < 0.008 || rms < 0.0025 || (activeSpeechRatio === 0 && peak < 0.02)) {
    return {
      status: 'silent',
      durationMs,
      rms,
      peak,
      clippedRatio,
      activeSpeechRatio,
      normalized: false,
      samples
    };
  }

  // Never process clipped audio or already clean audio
  if (clippedRatio > 0.005 || peak >= 0.92 || (peak >= 0.25 && rms >= 0.035)) {
    return {
      status: 'ok',
      durationMs,
      rms,
      peak,
      clippedRatio,
      activeSpeechRatio,
      normalized: false,
      samples
    };
  }

  // Safely lift low-volume unclipped mobile speech toward -5 dBFS (0.55 peak), capped at 4x
  const gain = Math.min(4.0, 0.55 / Math.max(peak, 0.01));
  if (gain <= 1.15) {
    return {
      status: 'ok',
      durationMs,
      rms,
      peak,
      clippedRatio,
      activeSpeechRatio,
      normalized: false,
      samples
    };
  }

  const boosted = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const scaled = samples[i] * gain;
    boosted[i] = Math.max(-0.98, Math.min(0.98, scaled));
  }

  return {
    status: 'ok',
    durationMs,
    rms: Math.min(1, rms * gain),
    peak: Math.min(0.98, peak * gain),
    clippedRatio,
    activeSpeechRatio,
    normalized: true,
    samples: boosted
  };
}

export function encodeMonoPcm16Wav(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number = 16000
): Uint8Array {
  let monoSamples = samples;
  let outputRate = sourceSampleRate;

  if (sourceSampleRate > targetSampleRate && sourceSampleRate > 0) {
    const ratio = sourceSampleRate / targetSampleRate;
    const newLength = Math.max(1, Math.floor(samples.length / ratio));
    const resampled = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIdx = i * ratio;
      const lower = Math.floor(srcIdx);
      const upper = Math.min(samples.length - 1, lower + 1);
      const frac = srcIdx - lower;
      resampled[i] = samples[lower] * (1 - frac) + samples[upper] * frac;
    }
    monoSamples = resampled;
    outputRate = targetSampleRate;
  }

  const pcmBytes = new Uint8Array(monoSamples.length * 2);
  const view = new DataView(pcmBytes.buffer);
  for (let i = 0; i < monoSamples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, monoSamples[i]));
    const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    view.setInt16(i * 2, int16, true);
  }
  return wrapRawPcmAsWav(pcmBytes, outputRate);
}

export function classifyPlaybackException(err: unknown): PlaybackFailureCategory {
  const errObj = (err && typeof err === 'object' ? err : {}) as { name?: string; message?: string; code?: unknown };
  const name = (errObj.name || '').toLowerCase();
  const msg = (errObj.message || String(err || '')).toLowerCase();

  if (name === 'notallowederror' || msg.includes('notallowederror') || msg.includes('user didn\'t interact') || msg.includes('play() failed because')) {
    return 'autoplay_blocked';
  }
  if (name === 'notsupportederror' || name === 'encodingerror' || msg.includes('not supported') || msg.includes('no supported source') || msg.includes('decode')) {
    return 'invalid_audio';
  }
  if (err instanceof AiServiceError) {
    if (err.code === 'network_error') return 'network_error';
    if (err.code === 'invalid_response') return 'invalid_audio';
    return 'tts_failed';
  }
  if (msg.includes('network') || msg.includes('failed to fetch')) {
    return 'network_error';
  }
  return 'tts_failed';
}

export function resolveSpeechSynthesisLocale(
  preferredLanguage: PreferredVoiceLanguage,
  messageLangHint?: 'ml' | 'en' | 'mixed'
): 'ml-IN' | 'en-IN' {
  if (preferredLanguage === 'ml-IN') return 'ml-IN';
  if (preferredLanguage === 'en-IN') return 'en-IN';
  if (messageLangHint === 'ml' || messageLangHint === 'mixed') return 'ml-IN';
  return 'en-IN';
}

export function shouldFallbackToBrowserSpeechRecognition(err: unknown): boolean {
  if (!(err instanceof AiServiceError)) return false;
  return (
    err.code === 'network_error' ||
    err.code === 'server_error' ||
    err.code === 'invalid_api_key' ||
    err.code === 'model_unavailable' ||
    err.code === 'quota_exceeded'
  );
}

export function formatRecordingDuration(durationMs: number): string {
  const totalSec = Math.max(0, Math.floor(durationMs / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function getMobileAudioConstraints(): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1
  };
}

export function pickSupportedRecorderMimeType(
  mediaRecorderClass: { isTypeSupported?: (mime: string) => boolean } | undefined =
    typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined
): string | undefined {
  if (!mediaRecorderClass || typeof mediaRecorderClass.isTypeSupported !== 'function') {
    return undefined;
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg'
  ];
  for (const mime of candidates) {
    try {
      if (mediaRecorderClass.isTypeSupported(mime)) {
        return mime;
      }
    } catch {
      // Ignore probe errors
    }
  }
  return undefined;
}
