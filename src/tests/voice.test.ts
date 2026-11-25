/**
 * XOS Jarvis — Comprehensive Voice Recognition & Audio Playback Automated Test Suite
 * Tests production VoiceUtils, VoiceController, Groq Whisper integration,
 * browser fallback locks, mobile lifecycle, and security invariants using mocked adapters.
 * NOTE: Mocked adapters verify software logic & state transitions only;
 * real hardware microphone/speaker acoustics require manual device verification.
 */

import fs from 'node:fs';
import path from 'node:path';
import { callGroqTranscription } from '../../api/_lib/groq';
import { handleTranscribeRequest } from '../../api/_lib/aiHandler';
import { AiServiceError, SpeakResult, TranscribeResult } from '../services/ai/agentService';
import { detectQueryIntent } from '../services/ai/contextBuilder';
import {
  AudioElementLike,
  SpeechRecognitionLike,
  VoiceController,
  VoiceStateSnapshot
} from '../services/ai/voiceController';
import {
  analyzeAndOptimizePcm,
  encodeBytesToBase64,
  encodeMonoPcm16Wav,
  hasSupportedAudioMagicHeader,
  PLAYBACK_ERROR_MESSAGES,
  validateAndPrepareTtsAudio,
  wrapRawPcmAsWav
} from '../services/ai/voiceUtils';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Voice test assertion failed: ${message}`);
  }
}

function makeFakeValidWavBase64(pcmLengthBytes: number = 128): string {
  const pcm = new Uint8Array(pcmLengthBytes);
  for (let i = 0; i < pcm.length; i++) pcm[i] = i % 255;
  return encodeBytesToBase64(wrapRawPcmAsWav(pcm, 24000));
}

function makeMockAudioElement(options: {
  playImpl?: () => Promise<void>;
} = {}): AudioElementLike & { triggerEnded: () => void; triggerPause: () => void; pauseCount: number; playCount: number } {
  const el = {
    src: '',
    currentTime: 0,
    paused: true,
    ended: false,
    preload: 'auto',
    onended: null as (() => void) | null,
    onpause: null as (() => void) | null,
    onplaying: null as (() => void) | null,
    onerror: null as (() => void) | null,
    loadCalled: false,
    pauseCount: 0,
    playCount: 0,
    load() {
      this.loadCalled = true;
    },
    async play() {
      this.playCount += 1;
      if (options.playImpl) {
        await options.playImpl();
      }
      this.paused = false;
      this.ended = false;
      this.onplaying?.();
    },
    pause() {
      this.pauseCount += 1;
      this.paused = true;
      this.onpause?.();
    },
    triggerEnded() {
      this.paused = true;
      this.ended = true;
      this.onended?.();
    },
    triggerPause() {
      this.paused = true;
      this.ended = false;
      this.onpause?.();
    }
  };
  return el;
}

interface MockMediaStreamControl {
  stream: MediaStream;
  stoppedTracks: number[];
  triggerTrackEnded: () => void;
}

function makeMockMediaStream(): MockMediaStreamControl {
  const stoppedTracks: number[] = [];
  const track = {
    stop() {
      stoppedTracks.push(1);
    },
    onended: null as (() => void) | null
  };
  return {
    stream: {
      getTracks: () => [track as unknown as MediaStreamTrack]
    } as unknown as MediaStream,
    stoppedTracks,
    triggerTrackEnded: () => {
      track.onended?.();
    }
  };
}

function makeMockMediaRecorderFactory(options: {
  mimeType?: string;
  chunkSize?: number;
  advanceMs?: number;
  onStopEmitEmpty?: boolean;
}) {
  let clock = 1000;
  let activeRecorder: {
    state: string;
    mimeType: string;
    ondataavailable: ((e: BlobEvent) => void) | null;
    onstop: (() => void) | null;
    onerror: (() => void) | null;
    start: () => void;
    stop: () => void;
  } | null = null;

  return {
    now: () => clock,
    advanceClock: (ms: number) => {
      clock += ms;
    },
    createMediaRecorder: () => {
      const rec = {
        state: 'inactive',
        mimeType: options.mimeType ?? 'audio/webm;codecs=opus',
        ondataavailable: null as ((e: BlobEvent) => void) | null,
        onstop: null as (() => void) | null,
        onerror: null as (() => void) | null,
        start() {
          this.state = 'recording';
          if (!options.onStopEmitEmpty) {
            const bytes = new Uint8Array(options.chunkSize ?? 1024);
            bytes.fill(7);
            const blob = new Blob([bytes], { type: this.mimeType });
            this.ondataavailable?.({ data: blob } as unknown as BlobEvent);
          }
        },
        stop() {
          if (this.state !== 'recording') return;
          this.state = 'inactive';
          clock += options.advanceMs ?? 1200;
          void this.onstop?.();
        }
      };
      activeRecorder = rec;
      return rec as unknown as MediaRecorder;
    },
    getActiveRecorder: () => activeRecorder
  };
}

async function runVoiceTests() {
  console.log('--- Running XOS Jarvis Voice Recognition & Audio Playback Test Suite ---');
  const rootDir = path.resolve(import.meta.dirname, '..', '..');

  // ==========================================
  // PART A: PCM Audio Inspection & Conditional Normalization
  // ==========================================
  console.log('Part A: Verifying PCM silence, short audio, low-volume normalization, clipping protection & WAV encoding...');

  // Too-short detection (<350ms)
  const shortPcm = new Float32Array(1600); // 100ms @ 16kHz
  shortPcm.fill(0.2);
  assert(analyzeAndOptimizePcm(shortPcm, 16000).status === 'too_short', 'Detects recording shorter than 350ms');

  // Silence detection
  const silentPcm = new Float32Array(16000); // 1s silence
  assert(analyzeAndOptimizePcm(silentPcm, 16000).status === 'silent', 'Detects silent microphone audio');

  // Low-volume unclipped audio gets safely boosted (without clipping)
  const lowVolPcm = new Float32Array(16000);
  for (let i = 0; i < lowVolPcm.length; i++) {
    lowVolPcm[i] = 0.04 * Math.sin(i * 0.1);
  }
  const lowAnalyzed = analyzeAndOptimizePcm(lowVolPcm, 16000);
  assert(lowAnalyzed.status === 'ok' && lowAnalyzed.normalized === true, 'Normalizes low-volume unclipped mobile speech');
  assert(lowAnalyzed.peak > 0.14 && lowAnalyzed.peak <= 0.98, 'Normalized speech maintains safe peak headroom');

  // Clean well-leveled audio stays untouched
  const cleanPcm = new Float32Array(16000);
  for (let i = 0; i < cleanPcm.length; i++) {
    cleanPcm[i] = 0.45 * Math.sin(i * 0.1);
  }
  const cleanAnalyzed = analyzeAndOptimizePcm(cleanPcm, 16000);
  assert(cleanAnalyzed.status === 'ok' && cleanAnalyzed.normalized === false, 'Leaves clean audio untouched without unnecessary processing');

  // Clipped audio is NEVER amplified
  const clippedPcm = new Float32Array(16000);
  clippedPcm.fill(0.995);
  const clippedAnalyzed = analyzeAndOptimizePcm(clippedPcm, 16000);
  assert(clippedAnalyzed.status === 'ok' && clippedAnalyzed.normalized === false, 'Never amplifies already clipped audio');

  // Mono 16kHz WAV encoding produces valid RIFF/WAVE header
  const wavOut = encodeMonoPcm16Wav(cleanPcm, 48000, 16000);
  assert(
    hasSupportedAudioMagicHeader(wavOut, 'audio/wav').valid === true && wavOut.length > 44,
    'Downsamples and encodes valid RIFF/WAVE audio'
  );

  // ==========================================
  // PART B: Groq Whisper Optimization, Manglish & Anti-Spanish Guard
  // ==========================================
  console.log('Part B: Verifying Groq Whisper ml-IN/en-IN/auto params, Manglish preservation, silence filter & Spanish guard...');
  const validWavB64 = makeFakeValidWavBase64(256);

  // Malayalam/Manglish explicit mode sends language='ml', verbose_json, finance prompt
  let capturedFormMl: FormData | null = null;
  const mlRes = await callGroqTranscription({
    apiKey: 'test-groq',
    audioBase64: validWavB64,
    mimeType: 'audio/webm;codecs=opus',
    preferredLanguage: 'ml-IN',
    abortSignal: new AbortController().signal,
    fetchImpl: async (_url, init) => {
      capturedFormMl = init?.body as FormData;
      return new Response(
        JSON.stringify({
          text: 'Ente ee month expense ethra aanu?',
          language: 'malayalam',
          segments: [{ no_speech_prob: 0.05 }]
        }),
        { status: 200 }
      );
    }
  });
  const formMl = capturedFormMl as unknown as FormData | null;
  assert(formMl !== null, 'Captured FormData for ml-IN request');
  assert(formMl!.get('language') === 'ml', 'Explicit ml language passed for Malayalam/Manglish');
  assert(formMl!.get('response_format') === 'verbose_json', 'Requests verbose_json diagnostics');
  assert(String(formMl!.get('prompt')).includes('Manglish'), 'Includes Manglish/finance domain prompt');
  assert(mlRes.transcript === 'Ente ee month expense ethra aanu?', 'Preserves Manglish transcript verbatim without translating');

  // Verify Manglish financial queries route accurately in contextBuilder
  for (const manglish of [
    { q: 'Ente ee month expense ethra aanu?', mod: 'expenses' },
    { q: 'Njan innu ethra paisa spend cheythu?', mod: 'expenses' },
    { q: 'Enikku kodukkan ulla debt ethra und?', mod: 'debt' },
    { q: 'Enikku kittan ulla paisa ethra aanu?', mod: 'debt' },
    { q: 'Ente savings ethra und?', mod: 'savings' }
  ]) {
    const intent = detectQueryIntent(manglish.q);
    assert(intent.modules.includes(manglish.mod as never), `Manglish query "${manglish.q}" maps to ${manglish.mod}`);
  }

  // Indian English explicit mode sends language='en'
  let capturedFormEn: FormData | null = null;
  const enRes = await callGroqTranscription({
    apiKey: 'test-groq',
    audioBase64: validWavB64,
    mimeType: 'audio/mp4',
    preferredLanguage: 'en-IN',
    abortSignal: new AbortController().signal,
    fetchImpl: async (_url, init) => {
      capturedFormEn = init?.body as FormData;
      return new Response(JSON.stringify({ text: 'How much did I spend this month?', language: 'english' }), { status: 200 });
    }
  });
  assert((capturedFormEn as unknown as FormData).get('language') === 'en', 'Explicit en language passed for English');
  assert(enRes.transcript === 'How much did I spend this month?', 'Preserves Indian English query cleanly');

  // Whisper silent hallucination rejection
  const silentWhisperRes = await callGroqTranscription({
    apiKey: 'test-groq',
    audioBase64: validWavB64,
    mimeType: 'audio/webm',
    preferredLanguage: 'ml-IN',
    abortSignal: new AbortController().signal,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          text: 'Thank you for watching.',
          language: 'english',
          segments: [{ no_speech_prob: 0.94 }]
        }),
        { status: 200 }
      )
  });
  assert(
    silentWhisperRes.transcript === '' && silentWhisperRes.rejectionReason === 'no_speech',
    'Rejects high no_speech_prob Whisper hallucination cleanly'
  );

  // Unrelated foreign language (Spanish) rejection in Auto mode + fail-closed auth verification
  const prevGroq = process.env.GROQ_API_KEY;
  const prevSupaUrl = process.env.SUPABASE_URL;
  const prevSupaAnon = process.env.SUPABASE_ANON_KEY;
  const prevViteSupaUrl = process.env.VITE_SUPABASE_URL;
  const prevViteSupaAnon = process.env.VITE_SUPABASE_ANON_KEY;
  process.env.GROQ_API_KEY = 'test-groq';
  try {
    // Without Supabase server config, fail-closed guard MUST return 503
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;
    const unconfiguredResp = await handleTranscribeRequest(
      { audioBase64: validWavB64, mimeType: 'audio/mp4', preferredLanguage: 'auto' },
      undefined
    );
    assert(
      unconfiguredResp.status === 503,
      'Fail-closed guard returns 503 when GROQ_API_KEY is set without Supabase config'
    );

    // With Supabase server config, missing Bearer token MUST return 401
    process.env.SUPABASE_URL = 'https://test-project.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';
    const unauthResp = await handleTranscribeRequest(
      { audioBase64: validWavB64, mimeType: 'audio/mp4', preferredLanguage: 'auto' },
      undefined
    );
    assert(unauthResp.status === 401, 'Rejects unauthenticated transcribe request with 401');

    const mockAuthFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ id: 'voice-test-user-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });

    const spanishBlockedResp = await handleTranscribeRequest(
      { audioBase64: validWavB64, mimeType: 'audio/mp4', preferredLanguage: 'auto' },
      'Bearer valid-test-jwt',
      {
        fetchImpl: mockAuthFetch,
        groqFetchImpl: async () =>
          new Response(
            JSON.stringify({
              text: 'Gracias por ver este video.',
              language: 'spanish',
              segments: [{ no_speech_prob: 0.1 }]
            }),
            { status: 200 }
          )
      }
    );
    assert(
      spanishBlockedResp.status === 422 &&
        spanishBlockedResp.body.category === 'invalid_request' &&
        String(spanishBlockedResp.body.error).includes('Malayalam or English'),
      'Rejects unintended Spanish detection in auto mode with clear language-guidance message'
    );

    // Invalid short/corrupt base64 rejected cleanly on server
    const invalidAudioResp = await handleTranscribeRequest(
      { audioBase64: 'YWJj', mimeType: 'audio/webm' },
      'Bearer valid-test-jwt',
      { fetchImpl: mockAuthFetch }
    );
    assert(invalidAudioResp.status === 400, 'Rejects invalid tiny audio payload with 400');
  } finally {
    if (prevGroq !== undefined) process.env.GROQ_API_KEY = prevGroq;
    else delete process.env.GROQ_API_KEY;
    if (prevSupaUrl !== undefined) process.env.SUPABASE_URL = prevSupaUrl;
    else delete process.env.SUPABASE_URL;
    if (prevSupaAnon !== undefined) process.env.SUPABASE_ANON_KEY = prevSupaAnon;
    else delete process.env.SUPABASE_ANON_KEY;
    if (prevViteSupaUrl !== undefined) process.env.VITE_SUPABASE_URL = prevViteSupaUrl;
    else delete process.env.VITE_SUPABASE_URL;
    if (prevViteSupaAnon !== undefined) process.env.VITE_SUPABASE_ANON_KEY = prevViteSupaAnon;
    else delete process.env.VITE_SUPABASE_ANON_KEY;
  }

  // ==========================================
  // PART C: VoiceController Recognition Lifecycle, Fallback, Cancellation, Concurrency
  // ==========================================
  console.log('Part C: Verifying VoiceController recording UX states, edit-before-send, fallback & cancellation...');

  // Default language is Malayalam (ml-IN), state-only (no localStorage)
  const completedTranscripts: Array<{ text: string; provider: string }> = [];
  let latestSnap!: VoiceStateSnapshot;
  const mockRecFactory = makeMockMediaRecorderFactory({ mimeType: 'audio/webm;codecs=opus', advanceMs: 1400 });
  const mockStreamCtrl = makeMockMediaStream();
  let getUserMediaCalls = 0;

  const voiceCtrl = new VoiceController({
    onStateChange: (s) => {
      latestSnap = s;
    },
    onTranscriptCompleted: (text, meta) => {
      completedTranscripts.push({ text, provider: meta.provider });
    },
    adapters: {
      now: mockRecFactory.now,
      getUserMedia: async () => {
        getUserMediaCalls += 1;
        return mockStreamCtrl.stream;
      },
      createMediaRecorder: mockRecFactory.createMediaRecorder,
      blobToBase64: async () => validWavB64,
      createAudioContext: () => null,
      createAudioElement: () => makeMockAudioElement(),
      createObjectUrl: (b) => `blob:test/${b.size}`,
      revokeObjectUrl: () => undefined,
      getSpeechSynthesis: () => null,
      transcribeAudio: async () => ({
        transcript: 'ഈ മാസം എത്ര ചെലവായി?',
        provider: 'groq',
        model: 'whisper-large-v3-turbo'
      })
    }
  });

  assert(voiceCtrl.getSnapshot().voiceLanguage === 'ml-IN', 'Default language preference is Malayalam (ml-IN)');
  assert(voiceCtrl.getSnapshot().inputPhase === 'ready', 'Initial voice input phase is ready');

  // Concurrency prevention: double startRecording triggers only 1 getUserMedia
  await Promise.all([voiceCtrl.startRecording(), voiceCtrl.startRecording()]);
  assert(getUserMediaCalls === 1, 'Prevents concurrent duplicate recording sessions');
  assert(latestSnap.inputPhase === 'recording', 'Transitions to recording state');
  // Language cannot silently change while recording
  voiceCtrl.setVoiceLanguage('en-IN');
  assert(latestSnap.voiceLanguage === 'ml-IN', 'Blocks language changes during active recording');

  voiceCtrl.stopRecording();
  await new Promise(r => setTimeout(r, 20));
  assert(latestSnap.inputPhase === 'completed', 'Transitions to completed after Groq transcription');
  assert(completedTranscripts.length === 1 && completedTranscripts[0].text === 'ഈ മാസം എത്ര ചെലവായി?', 'Delivers editable transcript once');
  assert(mockStreamCtrl.stoppedTracks.length >= 1, 'Cleans up MediaStream tracks after recording');

  // Language switching works cleanly when ready/completed
  voiceCtrl.setVoiceLanguage('en-IN');
  assert(voiceCtrl.getSnapshot().voiceLanguage === 'en-IN', 'Switches language explicitly to English (en-IN)');

  // Permission denial test
  const permDeniedCtrl = new VoiceController({
    onStateChange: (s) => {
      latestSnap = s;
    },
    onTranscriptCompleted: () => undefined,
    adapters: {
      getUserMedia: async () => {
        const err = new Error('Permission denied');
        err.name = 'NotAllowedError';
        throw err;
      },
      createMediaRecorder: mockRecFactory.createMediaRecorder,
      createAudioContext: () => null
    }
  });
  await permDeniedCtrl.startRecording();
  assert(
    latestSnap.micPermission === 'denied' &&
      latestSnap.inputPhase === 'failed' &&
      Boolean(latestSnap.voiceError?.includes('blocked')),
    'Handles microphone permission denial clearly'
  );

  // Cancellation aborts active capture cleanly and emits zero transcripts
  let cancelledEmitted = 0;
  const cancelRecFactory = makeMockMediaRecorderFactory({ advanceMs: 1000 });
  const cancelStream = makeMockMediaStream();
  const cancelCtrl = new VoiceController({
    onStateChange: (s) => {
      latestSnap = s;
    },
    onTranscriptCompleted: () => {
      cancelledEmitted += 1;
    },
    adapters: {
      now: cancelRecFactory.now,
      getUserMedia: async () => cancelStream.stream,
      createMediaRecorder: cancelRecFactory.createMediaRecorder,
      createAudioContext: () => null,
      blobToBase64: async () => validWavB64,
      transcribeAudio: async ({ signal }) =>
        new Promise((_res, rej) => {
          signal?.addEventListener('abort', () => rej(new AiServiceError('Request cancelled.', 'cancelled')));
        })
    }
  });
  await cancelCtrl.startRecording();
  cancelCtrl.stopRecording();
  await new Promise(r => setTimeout(r, 15));
  cancelCtrl.cancelRecording();
  assert(latestSnap.inputPhase === 'ready' && cancelledEmitted === 0, 'Cancellation aborts pending transcription cleanly');

  // Groq failure unlocks intentional browser fallback, handles language-not-supported cleanly
  let browserFallbackText = '';
  let mockRecognitionInstance: SpeechRecognitionLike | null = null;
  class MockSpeechRecognition implements SpeechRecognitionLike {
    lang = 'ml-IN';
    continuous = false;
    interimResults = true;
    maxAlternatives = 1;
    onstart: (() => void) | null = null;
    onresult: SpeechRecognitionLike['onresult'] = null;
    onerror: SpeechRecognitionLike['onerror'] = null;
    onend: (() => void) | null = null;
    constructor() {
      mockRecognitionInstance = this;
    }
    start() {
      this.onstart?.();
    }
    stop() {
      this.onend?.();
    }
    abort() {
      this.onerror?.({ error: 'aborted' });
    }
  }

  const fbRecFactory = makeMockMediaRecorderFactory({ advanceMs: 1000 });
  const fbCtrl = new VoiceController({
    onStateChange: (s) => {
      latestSnap = s;
    },
    onTranscriptCompleted: (t) => {
      browserFallbackText = t;
    },
    adapters: {
      now: fbRecFactory.now,
      getUserMedia: async () => makeMockMediaStream().stream,
      createMediaRecorder: fbRecFactory.createMediaRecorder,
      getSpeechRecognitionCtor: () => MockSpeechRecognition as unknown as new () => SpeechRecognitionLike,
      createAudioContext: () => null,
      blobToBase64: async () => validWavB64,
      transcribeAudio: async () => {
        throw new AiServiceError('AI service temporarily unavailable.', 'server_error', { status: 503 });
      }
    }
  });

  await fbCtrl.startRecording();
  fbCtrl.stopRecording();
  await new Promise(r => setTimeout(r, 20));
  assert(
    latestSnap.inputPhase === 'failed' && latestSnap.usingBrowserFallback === true,
    'Groq outage clearly flags intentional browser voice fallback option without auto-switching'
  );

  // Trigger intentional browser fallback & verify language-not-supported error
  await fbCtrl.startRecording({ forceBrowserFallback: true });
  const recMl = mockRecognitionInstance as unknown as SpeechRecognitionLike | null;
  assert(recMl !== null && recMl!.lang === 'ml-IN', 'Respects selected ml-IN in browser fallback');
  recMl!.onerror?.({ error: 'language-not-supported' });
  assert(
    latestSnap.inputPhase === 'failed' && String(latestSnap.voiceError).includes('unsupported'),
    'Handles unsupported browser Malayalam recognition cleanly without switching languages'
  );

  // Retry succeeds via browser fallback when English selected
  fbCtrl.setVoiceLanguage('en-IN');
  await fbCtrl.retryRecording({ forceBrowserFallback: true });
  const recEn = mockRecognitionInstance as unknown as SpeechRecognitionLike | null;
  recEn!.onresult?.({
    resultIndex: 0,
    results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: 'What is my debt balance?' } } }
  });
  recEn!.stop();
  assert(browserFallbackText === 'What is my debt balance?' && latestSnap.inputPhase === 'completed', 'Browser fallback retry succeeds cleanly');

  // Empty transcription from Groq
  const emptyTxRec = makeMockMediaRecorderFactory({ advanceMs: 900 });
  const emptyTxCtrl = new VoiceController({
    onStateChange: (s) => {
      latestSnap = s;
    },
    onTranscriptCompleted: () => {
      throw new Error('Must not emit empty transcript');
    },
    adapters: {
      now: emptyTxRec.now,
      getUserMedia: async () => makeMockMediaStream().stream,
      createMediaRecorder: emptyTxRec.createMediaRecorder,
      createAudioContext: () => null,
      blobToBase64: async () => validWavB64,
      transcribeAudio: async () => ({ transcript: '   ' })
    }
  });
  await emptyTxCtrl.startRecording();
  emptyTxCtrl.stopRecording();
  await new Promise(r => setTimeout(r, 20));
  assert(latestSnap.inputPhase === 'failed' && Boolean(latestSnap.voiceError?.includes('No clear speech')), 'Handles empty transcription cleanly');

  // ==========================================
  // PART D: Audio Playback Architecture (Autoplay Blocked, Play/Pause/Stop/Replay, Errors, Lifecycle)
  // ==========================================
  console.log('Part D: Verifying audio validation, autoplay blocks, Play/Pause/Stop/Replay, TTS fallback & unmount cleanup...');

  // Audio validation rejects corrupt/HTML bytes and wraps L16 PCM
  assert(validateAndPrepareTtsAudio('not-valid-base64!!!', 'audio/wav') === null, 'Rejects invalid base64 TTS response');
  assert(validateAndPrepareTtsAudio(encodeBytesToBase64(new Uint8Array(80)), 'audio/wav') === null, 'Rejects unrecognized non-audio binary');
  const wrappedL16 = validateAndPrepareTtsAudio(encodeBytesToBase64(new Uint8Array(128)), 'audio/L16;rate=24000');
  assert(wrappedL16 !== null && wrappedL16.mimeType === 'audio/wav' && wrappedL16.bytes.byteLength === 128 + 44, 'Wraps L16 PCM as playable RIFF/WAVE');

  // Autoplay block -> blocked state -> explicit user Play succeeds WITHOUT regenerating TTS!
  let blockAutoplay = true;
  let synthCalls = 0;
  const mockAudioEl = makeMockAudioElement({
    playImpl: async () => {
      if (blockAutoplay) {
        const err = new Error("play() failed because the user didn't interact with the document first.");
        err.name = 'NotAllowedError';
        throw err;
      }
    }
  });

  const revokedUrls: string[] = [];
  let pbSnap!: VoiceStateSnapshot;
  const pbCtrl = new VoiceController({
    onStateChange: (s) => {
      pbSnap = s;
    },
    onTranscriptCompleted: () => undefined,
    adapters: {
      getUserMedia: async () => makeMockMediaStream().stream,
      createMediaRecorder: mockRecFactory.createMediaRecorder,
      createAudioContext: () => null,
      createAudioElement: () => mockAudioEl,
      createObjectUrl: () => 'blob:mock-tts-1',
      revokeObjectUrl: (u) => revokedUrls.push(u),
      getSpeechSynthesis: () => null,
      synthesizeSpeech: async () => {
        synthCalls += 1;
        return { audioBase64: validWavB64, mimeType: 'audio/wav' };
      }
    }
  });

  await pbCtrl.speakResponse('Your expenses total ₹6,400 this month.', 'm1', 'en', true);
  assert(synthCalls === 1, 'Generates TTS once');
  assert(pbSnap.playbackPhase === 'blocked', `Classifies NotAllowedError as blocked (got ${pbSnap.playbackPhase})`);
  assert(pbSnap.playbackError === PLAYBACK_ERROR_MESSAGES.autoplay_blocked, 'Shows explicit Tap Play guidance on autoplay block');
  assert(pbSnap.readyMessageId === 'm1', 'Preserves ready cached audio messageId');

  // User taps Play synchronously -> audio unlocks and plays WITHOUT calling synthesizeSpeech again!
  blockAutoplay = false;
  await pbCtrl.playOrResume();
  assert(synthCalls === 1, 'Explicit Play reuses cached audio without regenerating TTS');
  assert(pbSnap.playbackPhase === 'playing' && pbSnap.speakingMessageId === 'm1', 'Plays cached audio on user tap');

  // Pause -> Resume -> Stop -> Replay
  pbCtrl.pausePlayback();
  assert(pbSnap.playbackPhase === 'paused' && mockAudioEl.paused === true, 'Pause stops active audio cleanly');
  await pbCtrl.playOrResume();
  assert(pbSnap.playbackPhase === 'playing' && synthCalls === 1, 'Resume continues paused audio cleanly');

  // OS interruption / visibility hide pauses audio cleanly
  pbCtrl.handleVisibilityChange(true);
  assert(pbSnap.playbackPhase === 'paused', 'Tab hidden / screen lock pauses playback cleanly');

  await pbCtrl.playOrResume();
  mockAudioEl.triggerEnded();
  assert(pbSnap.playbackPhase === 'completed' && pbSnap.speakingMessageId === null, 'Marks completed cleanly when audio ends');

  await pbCtrl.replayLastResponse();
  assert(synthCalls === 1 && pbSnap.playbackPhase === 'playing', 'Replay reuses cached audio without extra TTS API calls');

  pbCtrl.stopPlayback();
  assert(pbSnap.playbackPhase === 'ready' && mockAudioEl.currentTime === 0, 'Stop resets playback position cleanly');

  // Unmount cleanup revokes cached URLs
  pbCtrl.destroy();
  assert(revokedUrls.includes('blob:mock-tts-1'), 'Destroy revokes cached blob URLs on unmount');

  // Duplicate playback prevention & delayed TTS response cancellation
  let firstSpeakResolved = false;
  let secondSpeakPlays = false;
  const dupAudioEl = makeMockAudioElement();
  const dupCtrl = new VoiceController({
    onStateChange: (s) => {
      pbSnap = s;
    },
    onTranscriptCompleted: () => undefined,
    adapters: {
      createAudioContext: () => null,
      createAudioElement: () => dupAudioEl,
      createObjectUrl: () => `blob:dup-${Math.random()}`,
      revokeObjectUrl: () => undefined,
      getSpeechSynthesis: () => null,
      synthesizeSpeech: async ({ text }) => {
        if (text.includes('First')) {
          await new Promise(r => setTimeout(r, 40));
          firstSpeakResolved = true;
        } else {
          secondSpeakPlays = true;
        }
        return { audioBase64: validWavB64, mimeType: 'audio/wav' };
      }
    }
  });
  const p1 = dupCtrl.speakResponse('First delayed message', 'm-first', 'en', true);
  await new Promise(r => setTimeout(r, 10));
  const p2 = dupCtrl.speakResponse('Second newer message', 'm-second', 'en', true);
  await Promise.all([p1, p2]);
  assert(firstSpeakResolved && secondSpeakPlays, 'Ran delayed first and newer second TTS calls');
  assert(pbSnap.speakingMessageId === 'm-second', 'Prevents delayed first TTS response from overwriting active second message playback');

  // Network failure vs Corrupt Audio vs TTS failure + Browser Synthesis Malayalam/English guard
  const errAudioEl = makeMockAudioElement();
  const spokenUtterances: Array<{ text: string; lang: string }> = [];
  let mockVoices: Array<{ lang: string; name: string }> = [];

  const errCtrl = new VoiceController({
    onStateChange: (s) => {
      pbSnap = s;
    },
    onTranscriptCompleted: () => undefined,
    adapters: {
      createAudioContext: () => null,
      createAudioElement: () => errAudioEl,
      createObjectUrl: () => 'blob:err-url',
      revokeObjectUrl: () => undefined,
      getSpeechSynthesis: () =>
        ({
          getVoices: () => mockVoices,
          cancel: () => undefined,
          speak: (u: SpeechSynthesisUtterance) => {
            spokenUtterances.push({ text: u.text, lang: u.lang });
          }
        }) as unknown as SpeechSynthesis,
      synthesizeSpeech: async ({ text }) => {
        if (text === 'NET_FAIL') throw new AiServiceError('Connection drop', 'network_error');
        if (text === 'BAD_AUDIO') return { audioBase64: 'not-audio-at-all', mimeType: 'audio/wav' } as SpeakResult;
        throw new AiServiceError('TTS 503', 'server_error', { status: 503 });
      }
    }
  });

  await errCtrl.speakResponse('NET_FAIL', 'm-net', 'en', true);
  assert(pbSnap.playbackPhase === 'failed' && pbSnap.playbackError === PLAYBACK_ERROR_MESSAGES.network_error, 'Maps network error cleanly');

  await errCtrl.speakResponse('BAD_AUDIO', 'm-bad', 'en', true);
  assert(pbSnap.playbackPhase === 'failed' && pbSnap.playbackError === PLAYBACK_ERROR_MESSAGES.invalid_audio, 'Maps invalid generated audio cleanly');

  // Browser lacks SpeechSynthesisUtterance in Node, so provide global shim temporarily for synthesis fallback verification
  const g = globalThis as unknown as { SpeechSynthesisUtterance?: unknown };
  const prevUtterance = g.SpeechSynthesisUtterance;
  g.SpeechSynthesisUtterance = class {
    text: string;
    lang = 'en-IN';
    voice: unknown = null;
    rate = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  };
  try {
    // Malayalam text when browser lacks ml voice -> DOES NOT fall back to garbled English voice
    mockVoices = [{ lang: 'en-US', name: 'English US' }];
    await errCtrl.speakResponse('ഈ മാസം ചെലവ് ₹6,400 ആണ്', 'm-ml-notsupported', 'ml', true);
    assert(spokenUtterances.length === 0, 'Refuses unrelated voice fallback for Malayalam when browser lacks ml voice');
    assert(pbSnap.playbackError === PLAYBACK_ERROR_MESSAGES.tts_failed, 'Keeps clear TTS failure message with text available');

    // Malayalam text when ml-IN voice IS present -> uses ml-IN voice cleanly
    mockVoices = [{ lang: 'ml-IN', name: 'Malayalam India' }, { lang: 'en-IN', name: 'English India' }];
    await errCtrl.speakResponse('ഈ മാസം ചെലവ് ₹6,400 ആണ്', 'm-ml-ok', 'ml', true);
    assert(spokenUtterances.length === 1 && spokenUtterances[0].lang === 'ml-IN', 'Uses Malayalam browser voice when available');

    // English text uses en-IN voice cleanly
    errCtrl.setVoiceLanguage('en-IN');
    await errCtrl.speakResponse('Your debt is zero.', 'm-en-ok', 'en', true);
    assert(spokenUtterances.length === 2 && spokenUtterances[1].lang === 'en-IN', 'Uses Indian English browser voice when available');
  } finally {
    if (prevUtterance !== undefined) g.SpeechSynthesisUtterance = prevUtterance;
    else delete g.SpeechSynthesisUtterance;
  }

  // ==========================================
  // PART E: Security & Privacy Static Audit
  // ==========================================
  console.log('Part E: Auditing zero client secrets, zero browser audio storage & read-only compliance...');
  for (const rel of [
    'src/services/ai/voiceUtils.ts',
    'src/services/ai/voiceController.ts',
    'src/hooks/useJarvisVoice.ts',
    'src/components/ai/AiAgentView.tsx'
  ]) {
    const code = fs.readFileSync(path.join(rootDir, rel), 'utf8');
    assert(!code.includes('localStorage') && !code.includes('sessionStorage') && !code.includes('indexedDB'), `Zero browser storage in ${rel}`);
    assert(!code.includes('GROQ_API_KEY') && !code.includes('GEMINI_API_KEY'), `Zero API keys in ${rel}`);
    assert(!code.includes('api.groq.com'), `Zero direct Groq endpoints in ${rel}`);
    assert(!/\bconsole\.(log|warn|error)\s*\(/.test(code), `Zero console logs leaking voice data in ${rel}`);
  }

  console.log('ALL XOS JARVIS VOICE & PLAYBACK TESTS PASSED SUCCESSFULLY!');
}

runVoiceTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
