/**
 * XOS Personal AI Agent — Core Voice Capture & Audio Playback Controller
 * Platform-adapter driven state machine so mobile browser behavior, Groq Whisper STT,
 * intentional Web Speech fallback, Gemini TTS, autoplay blocks, pause/resume/replay,
 * and lifecycle cleanup run consistently and are deterministically testable.
 */
import { agentService, AiServiceError, PreferredVoiceLanguage } from './agentService';
import {
  analyzeAndOptimizePcm,
  AudioPlaybackPhase,
  classifyPlaybackException,
  DEFAULT_VOICE_LANGUAGE,
  encodeBytesToBase64,
  encodeMonoPcm16Wav,
  getMobileAudioConstraints,
  MAX_RECORDED_BYTES,
  MAX_RECORDING_DURATION_MS,
  MIN_RECORDING_DURATION_MS,
  pickSupportedRecorderMimeType,
  PLAYBACK_ERROR_MESSAGES,
  resolveSpeechSynthesisLocale,
  shouldFallbackToBrowserSpeechRecognition,
  validateAndPrepareTtsAudio,
  VoiceInputPhase
} from './voiceUtils';

export interface VoiceStateSnapshot {
  inputPhase: VoiceInputPhase;
  playbackPhase: AudioPlaybackPhase;
  voiceLanguage: PreferredVoiceLanguage;
  isMuted: boolean;
  micPermission: 'prompt' | 'granted' | 'denied' | 'unsupported';
  recordingDurationMs: number;
  audioLevel: number;
  liveTranscript: string;
  voiceError: string | null;
  playbackError: string | null;
  playbackNotice: string | null;
  usingBrowserFallback: boolean;
  speakingMessageId: string | null;
  readyMessageId: string | null;
  lastMessage: { id: string; text: string; langHint: 'ml' | 'en' | 'mixed' } | null;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: {
    resultIndex: number;
    results: { length: number; [index: number]: { isFinal: boolean; length: number; [j: number]: { transcript: string } } };
  }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export interface AudioElementLike {
  src: string;
  currentTime: number;
  paused: boolean;
  ended: boolean;
  preload?: string;
  onended: (() => void) | null;
  onpause: (() => void) | null;
  onplaying: (() => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  load?: () => void;
  play: () => Promise<void>;
  pause: () => void;
}

export interface VoiceControllerAdapters {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createMediaRecorder?: (stream: MediaStream, mimeType?: string) => MediaRecorder;
  getSpeechRecognitionCtor?: () => (new () => SpeechRecognitionLike) | null;
  createAudioElement?: () => AudioElementLike;
  createAudioContext?: () => AudioContext | null;
  getSpeechSynthesis?: () => SpeechSynthesis | null;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  blobToBase64?: (blob: Blob) => Promise<string>;
  transcribeAudio?: typeof agentService.transcribeAudio;
  synthesizeSpeech?: typeof agentService.synthesizeSpeech;
  now?: () => number;
}

export interface VoiceControllerOptions {
  accessToken?: string | null;
  initialLanguage?: PreferredVoiceLanguage;
  onStateChange: (snapshot: VoiceStateSnapshot) => void;
  onTranscriptCompleted: (transcript: string, meta: { provider: 'groq' | 'browser'; detectedLanguage?: string }) => void;
  adapters?: VoiceControllerAdapters;
}

function defaultBlobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

function defaultGetSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export class VoiceController {
  private state: VoiceStateSnapshot;
  private accessToken: string | null | undefined;
  private onStateChange: (snapshot: VoiceStateSnapshot) => void;
  private onTranscriptCompleted: VoiceControllerOptions['onTranscriptCompleted'];
  private adapters: VoiceControllerAdapters;

  private destroyed = false;
  private captureEpoch = 0;
  private transcriptionEpoch = 0;
  private lastGroqCompletedEpoch = 0;
  private playbackEpoch = 0;

  private isCaptureStarting = false;
  private cancelledCaptureEpochs = new Set<number>();
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private captureAudioContext: AudioContext | null = null;
  private durationTimer: ReturnType<typeof setInterval> | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private recordedChunks: Blob[] = [];
  private activeTranscribeAbort: AbortController | null = null;
  private activeSpeechRecognition: SpeechRecognitionLike | null = null;
  private browserRecognitionTranscript = '';

  private persistentAudioEl: AudioElementLike | null = null;
  private playbackAudioContext: AudioContext | null = null;
  private activeSpeakAbort: AbortController | null = null;
  private intentionalAudioPause = false;
  private activeTtsCache = new Map<string, { blobUrl: string; mimeType: string }>();

  constructor(options: VoiceControllerOptions) {
    this.accessToken = options.accessToken;
    this.onStateChange = options.onStateChange;
    this.onTranscriptCompleted = options.onTranscriptCompleted;
    this.adapters = options.adapters || {};

    const hasMedia = this.hasMediaRecorderSupport();
    const hasSpeech = Boolean(this.getSpeechRecognitionCtor());

    this.state = {
      inputPhase: 'ready',
      playbackPhase: 'idle',
      voiceLanguage: options.initialLanguage ?? DEFAULT_VOICE_LANGUAGE,
      isMuted: false,
      micPermission: hasMedia || hasSpeech ? 'prompt' : 'unsupported',
      recordingDurationMs: 0,
      audioLevel: 0,
      liveTranscript: '',
      voiceError: null,
      playbackError: null,
      playbackNotice: null,
      usingBrowserFallback: false,
      speakingMessageId: null,
      readyMessageId: null,
      lastMessage: null
    };
  }

  getSnapshot(): VoiceStateSnapshot {
    return { ...this.state };
  }

  setAccessToken(token: string | null | undefined): void {
    this.accessToken = token;
  }

  setVoiceLanguage(lang: PreferredVoiceLanguage): void {
    if (this.state.inputPhase === 'listening' || this.state.inputPhase === 'recording' || this.state.inputPhase === 'processing') {
      return;
    }
    this.patchState({
      voiceLanguage: lang,
      voiceError: null
    });
  }

  setEditableTranscript(text: string): void {
    this.patchState({
      liveTranscript: text
    });
  }

  toggleMute(): boolean {
    const nextMuted = !this.state.isMuted;
    if (nextMuted) {
      this.stopPlayback();
    }
    this.patchState({ isMuted: nextMuted });
    return nextMuted;
  }

  private now(): number {
    return this.adapters.now ? this.adapters.now() : Date.now();
  }

  private patchState(partial: Partial<VoiceStateSnapshot>): void {
    if (this.destroyed) return;
    this.state = { ...this.state, ...partial };
    this.onStateChange({ ...this.state });
  }

  private hasMediaRecorderSupport(): boolean {
    if (this.adapters.getUserMedia && this.adapters.createMediaRecorder) {
      return true;
    }
    if (typeof navigator === 'undefined') return false;
    return Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
  }

  private getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
    if (this.adapters.getSpeechRecognitionCtor) {
      return this.adapters.getSpeechRecognitionCtor();
    }
    return defaultGetSpeechRecognitionCtor();
  }

  private createObjectUrl(blob: Blob): string {
    if (this.adapters.createObjectUrl) {
      return this.adapters.createObjectUrl(blob);
    }
    return URL.createObjectURL(blob);
  }

  private revokeObjectUrl(url: string): void {
    try {
      if (this.adapters.revokeObjectUrl) {
        this.adapters.revokeObjectUrl(url);
      } else {
        URL.revokeObjectURL(url);
      }
    } catch {
      // Ignore URL revocation errors
    }
  }

  private getSpeechSynthesisApi(): SpeechSynthesis | null {
    if (this.adapters.getSpeechSynthesis !== undefined) {
      return this.adapters.getSpeechSynthesis();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      return window.speechSynthesis;
    }
    return null;
  }

  private createNewAudioContext(): AudioContext | null {
    if (this.adapters.createAudioContext !== undefined) {
      return this.adapters.createAudioContext();
    }
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      return new AudioCtx();
    } catch {
      return null;
    }
  }

  private ensurePersistentAudioElement(): AudioElementLike | null {
    if (this.persistentAudioEl) return this.persistentAudioEl;
    if (this.adapters.createAudioElement) {
      this.persistentAudioEl = this.adapters.createAudioElement();
      return this.persistentAudioEl;
    }
    if (typeof Audio !== 'undefined') {
      const el = new Audio() as unknown as AudioElementLike;
      el.preload = 'auto';
      this.persistentAudioEl = el;
      return el;
    }
    return null;
  }

  /**
   * Synchronously primes AudioContext / AudioElement during a user tap
   * (e.g., Send button, Play button, Orb tap) to satisfy mobile browser gesture policies.
   */
  unlockAudioFromUserGesture(): void {
    this.ensurePersistentAudioElement();
    try {
      if (!this.playbackAudioContext) {
        this.playbackAudioContext = this.createNewAudioContext();
      }
      if (this.playbackAudioContext && this.playbackAudioContext.state === 'suspended') {
        void this.playbackAudioContext.resume().catch(() => undefined);
      }
    } catch {
      // Ignore AudioContext unlock errors on unsupported environments
    }
  }

  private cleanupCaptureResources(): void {
    if (this.durationTimer !== null) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
    if (this.maxDurationTimer !== null) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    if (this.meterTimer !== null) {
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
    if (this.captureAudioContext) {
      try {
        void this.captureAudioContext.close().catch(() => undefined);
      } catch {
        // Ignore close errors
      }
      this.captureAudioContext = null;
    }
    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach(track => {
          track.onended = null;
          track.stop();
        });
      } catch {
        // Ignore track stop errors
      }
      this.mediaStream = null;
    }
    this.mediaRecorder = null;
    this.patchState({ audioLevel: 0 });
  }

  async startRecording(options: { forceBrowserFallback?: boolean } = {}): Promise<void> {
    if (
      this.destroyed ||
      this.isCaptureStarting ||
      this.state.inputPhase === 'listening' ||
      this.state.inputPhase === 'recording' ||
      this.state.inputPhase === 'processing'
    ) {
      return;
    }

    this.unlockAudioFromUserGesture();
    this.stopPlayback();

    const useBrowserFallback = Boolean(options.forceBrowserFallback) || !this.hasMediaRecorderSupport();
    if (useBrowserFallback) {
      this.startBrowserSpeechRecognition();
      return;
    }

    const epoch = ++this.captureEpoch;
    this.isCaptureStarting = true;
    this.patchState({
      inputPhase: 'listening',
      recordingDurationMs: 0,
      liveTranscript: '',
      voiceError: null,
      usingBrowserFallback: false
    });

    try {
      const getUserMediaFn =
        this.adapters.getUserMedia ??
        ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));

      const stream = await getUserMediaFn({
        audio: getMobileAudioConstraints()
      });

      if (this.destroyed || epoch !== this.captureEpoch || this.cancelledCaptureEpochs.has(epoch)) {
        stream.getTracks().forEach(t => t.stop());
        this.isCaptureStarting = false;
        return;
      }

      this.mediaStream = stream;
      this.isCaptureStarting = false;
      this.patchState({ micPermission: 'granted' });

      const preferredMime = pickSupportedRecorderMimeType();
      let recorder: MediaRecorder;
      if (this.adapters.createMediaRecorder) {
        recorder = this.adapters.createMediaRecorder(stream, preferredMime);
      } else {
        try {
          recorder = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
        } catch {
          recorder = new MediaRecorder(stream);
        }
      }

      const effectiveMimeType = (recorder.mimeType || preferredMime || 'audio/webm').toLowerCase();
      this.recordedChunks = [];
      this.mediaRecorder = recorder;

      const startedAt = this.now();
      let trackInterrupted = false;

      // Monitor hardware/OS track interruption (e.g. phone call or Bluetooth headset disconnect)
      stream.getTracks().forEach(track => {
        track.onended = () => {
          if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            trackInterrupted = true;
            try {
              this.mediaRecorder.stop();
            } catch {
              this.cleanupCaptureResources();
              this.patchState({
                inputPhase: 'failed',
                voiceError: 'Microphone connection was interrupted. Tap Retry to record again.'
              });
            }
          }
        };
      });

      // Lightweight visual amplitude meter only (does not aggressively cut off soft speakers)
      try {
        const audioCtx = this.createNewAudioContext();
        if (audioCtx && typeof audioCtx.createMediaStreamSource === 'function') {
          this.captureAudioContext = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const bins = new Uint8Array(analyser.frequencyBinCount);
          this.meterTimer = setInterval(() => {
            if (this.destroyed || this.mediaRecorder?.state !== 'recording') return;
            analyser.getByteTimeDomainData(bins);
            let sum = 0;
            for (let i = 0; i < bins.length; i++) {
              const v = (bins[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / bins.length);
            this.patchState({ audioLevel: Math.min(1, rms * 4.5) });
          }, 90);
        }
      } catch {
        // Optional visual level meter
      }

      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) {
          this.recordedChunks.push(ev.data);
        }
      };

      recorder.onerror = () => {
        this.cleanupCaptureResources();
        this.recordedChunks = [];
        this.patchState({
          inputPhase: 'failed',
          voiceError: 'Recording failed on this device. Tap Retry to speak again.'
        });
      };

      recorder.onstop = async () => {
        const elapsedMs = this.now() - startedAt;
        const chunks = this.recordedChunks;
        this.recordedChunks = [];
        this.cleanupCaptureResources();

        if (this.destroyed || this.cancelledCaptureEpochs.has(epoch)) {
          this.cancelledCaptureEpochs.delete(epoch);
          this.patchState({
            inputPhase: 'ready',
            recordingDurationMs: 0,
            voiceError: null
          });
          return;
        }

        if (trackInterrupted && chunks.length === 0) {
          this.patchState({
            inputPhase: 'failed',
            voiceError: 'Microphone connection was interrupted. Tap Retry to record again.'
          });
          return;
        }

        if (elapsedMs < MIN_RECORDING_DURATION_MS || chunks.length === 0) {
          this.patchState({
            inputPhase: 'failed',
            voiceError: 'Recording was too short. Speak clearly and try again.'
          });
          return;
        }

        const rawBlob = new Blob(chunks, { type: effectiveMimeType });
        if (rawBlob.size < 256) {
          this.patchState({
            inputPhase: 'failed',
            voiceError: 'No usable audio captured. Tap Retry to speak again.'
          });
          return;
        }

        await this.processAndTranscribeBlob(rawBlob, effectiveMimeType, epoch);
      };

      this.patchState({
        inputPhase: 'recording',
        recordingDurationMs: 0
      });

      this.durationTimer = setInterval(() => {
        if (!this.destroyed && this.state.inputPhase === 'recording') {
          this.patchState({ recordingDurationMs: this.now() - startedAt });
        }
      }, 100);

      this.maxDurationTimer = setTimeout(() => {
        if (this.mediaRecorder?.state === 'recording') {
          this.stopRecording();
        }
      }, MAX_RECORDING_DURATION_MS);

      recorder.start(250);
    } catch (err) {
      this.isCaptureStarting = false;
      this.cleanupCaptureResources();
      if (this.cancelledCaptureEpochs.has(epoch)) {
        this.cancelledCaptureEpochs.delete(epoch);
        this.patchState({ inputPhase: 'ready', voiceError: null });
        return;
      }
      const errName = (err as { name?: string })?.name || '';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        this.patchState({
          micPermission: 'denied',
          inputPhase: 'failed',
          voiceError: 'Microphone access is blocked. Allow microphone permission in browser settings.'
        });
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        this.patchState({
          micPermission: 'unsupported',
          inputPhase: 'failed',
          voiceError: 'No microphone was found on this device.'
        });
      } else {
        this.patchState({
          inputPhase: 'failed',
          voiceError: 'Could not start microphone recording. Check permissions or type below.'
        });
      }
    }
  }

  private async processAndTranscribeBlob(rawBlob: Blob, rawMimeType: string, captureEpoch: number): Promise<void> {
    const txEpoch = ++this.transcriptionEpoch;
    this.patchState({
      inputPhase: 'processing',
      voiceError: null
    });

    let uploadBase64 = '';
    let uploadMime = rawMimeType;

    // Inspect & conditionally optimize audio ONLY if AudioContext decode is available
    try {
      const decodeCtx = this.createNewAudioContext();
      if (decodeCtx && typeof decodeCtx.decodeAudioData === 'function' && typeof rawBlob.arrayBuffer === 'function') {
        try {
          const arrayBuf = await rawBlob.arrayBuffer();
          const audioBuffer = await decodeCtx.decodeAudioData(arrayBuf.slice(0));
          const ch0 = audioBuffer.getChannelData(0);
          const analyzed = analyzeAndOptimizePcm(ch0, audioBuffer.sampleRate);

          if (analyzed.status === 'too_short') {
            this.patchState({
              inputPhase: 'failed',
              voiceError: 'Recording was too short. Speak clearly and try again.'
            });
            return;
          }
          if (analyzed.status === 'silent') {
            this.patchState({
              inputPhase: 'failed',
              voiceError: 'No speech detected. Check your microphone and try again.'
            });
            return;
          }
          // Only re-encode as 16kHz WAV when normalization lifted low-volume unclipped speech
          // OR if the original compressed blob exceeds our upload ceiling
          if (analyzed.normalized || rawBlob.size > MAX_RECORDED_BYTES) {
            const wavBytes = encodeMonoPcm16Wav(analyzed.samples, audioBuffer.sampleRate, 16000);
            uploadBase64 = encodeBytesToBase64(wavBytes);
            uploadMime = 'audio/wav';
          }
        } catch {
          // If browser cannot decode its own compressed container via WebAudio, upload raw blob directly
        } finally {
          try {
            await decodeCtx.close();
          } catch {
            // Ignore close error
          }
        }
      }
    } catch {
      // Optional WebAudio inspection unavailable; upload raw blob
    }

    if (!uploadBase64) {
      if (rawBlob.size > MAX_RECORDED_BYTES) {
        this.patchState({
          inputPhase: 'failed',
          voiceError: 'Voice recording is too long. Please keep questions under 30 seconds.'
        });
        return;
      }
      const convertFn = this.adapters.blobToBase64 ?? defaultBlobToBase64;
      uploadBase64 = await convertFn(rawBlob);
    }

    if (this.destroyed || this.cancelledCaptureEpochs.has(captureEpoch)) {
      this.patchState({ inputPhase: 'ready', voiceError: null });
      return;
    }

    const abortController = new AbortController();
    this.activeTranscribeAbort = abortController;

    const transcribeFn = this.adapters.transcribeAudio ?? agentService.transcribeAudio;

    try {
      const result = await transcribeFn({
        audioBase64: uploadBase64,
        mimeType: uploadMime,
        preferredLanguage: this.state.voiceLanguage,
        accessToken: this.accessToken,
        signal: abortController.signal
      });

      if (this.destroyed || this.cancelledCaptureEpochs.has(captureEpoch) || txEpoch !== this.transcriptionEpoch) {
        return;
      }

      const transcript = (result.transcript || '').trim();
      if (!transcript) {
        this.patchState({
          inputPhase: 'failed',
          voiceError: 'No clear speech detected. Tap Retry to speak again.'
        });
        return;
      }

      this.lastGroqCompletedEpoch = txEpoch;
      this.patchState({
        inputPhase: 'completed',
        liveTranscript: transcript,
        voiceError: null,
        usingBrowserFallback: false
      });
      this.onTranscriptCompleted(transcript, {
        provider: 'groq',
        detectedLanguage: result.detectedLanguage
      });
    } catch (err) {
      if (this.destroyed || this.cancelledCaptureEpochs.has(captureEpoch)) {
        return;
      }
      if (err instanceof AiServiceError && err.code === 'cancelled') {
        this.patchState({ inputPhase: 'ready', voiceError: null });
        return;
      }

      const speechFallbackAvailable = Boolean(this.getSpeechRecognitionCtor()) && shouldFallbackToBrowserSpeechRecognition(err);
      const message = err instanceof Error ? err.message : 'Could not transcribe voice recording.';

      this.patchState({
        inputPhase: 'failed',
        voiceError: speechFallbackAvailable
          ? `${message} You can retry with browser voice fallback or edit below.`
          : message,
        usingBrowserFallback: speechFallbackAvailable
      });
    } finally {
      if (this.activeTranscribeAbort === abortController) {
        this.activeTranscribeAbort = null;
      }
    }
  }

  private startBrowserSpeechRecognition(): void {
    const Ctor = this.getSpeechRecognitionCtor();
    if (!Ctor) {
      this.patchState({
        micPermission: 'unsupported',
        inputPhase: 'failed',
        voiceError: 'Voice capture is unavailable in this browser. Type your message below.'
      });
      return;
    }

    // Refuse silent switch to unrelated languages; Auto safely maps to en-IN with disclosure
    const langCode: 'ml-IN' | 'en-IN' =
      this.state.voiceLanguage === 'ml-IN' ? 'ml-IN' : 'en-IN';
    const captureEpoch = ++this.captureEpoch;
    const txEpoch = ++this.transcriptionEpoch;

    try {
      const recognition = new Ctor();
      recognition.lang = langCode;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      this.browserRecognitionTranscript = '';
      this.activeSpeechRecognition = recognition;

      let settled = false;

      recognition.onstart = () => {
        if (this.destroyed || captureEpoch !== this.captureEpoch) return;
        this.patchState({
          micPermission: 'granted',
          inputPhase: 'recording',
          liveTranscript: '',
          voiceError: null,
          usingBrowserFallback: true
        });
      };

      recognition.onresult = (event) => {
        if (this.destroyed || captureEpoch !== this.captureEpoch) return;
        let full = '';
        for (let i = 0; i < event.results.length; i++) {
          full += event.results[i]?.[0]?.transcript || '';
        }
        const clean = full.trim();
        this.browserRecognitionTranscript = clean;
        this.patchState({ liveTranscript: clean });
      };

      recognition.onerror = (event) => {
        if (this.destroyed || settled) return;
        const code = event.error;
        this.activeSpeechRecognition = null;
        settled = true;

        if (code === 'not-allowed' || code === 'service-not-allowed') {
          this.patchState({
            micPermission: 'denied',
            inputPhase: 'failed',
            voiceError: 'Microphone access is blocked. Allow permission in browser settings.'
          });
          return;
        }
        if (code === 'language-not-supported') {
          this.patchState({
            inputPhase: 'failed',
            voiceError:
              langCode === 'ml-IN'
                ? 'Malayalam browser speech fallback is unsupported here. Switch to English or type your question.'
                : 'Browser speech recognition is unsupported for this language here.'
          });
          return;
        }
        if (code === 'no-speech') {
          this.patchState({
            inputPhase: 'failed',
            voiceError: 'No speech detected. Check your microphone and try again.'
          });
          return;
        }
        if (code === 'aborted' || this.cancelledCaptureEpochs.has(captureEpoch)) {
          this.patchState({ inputPhase: 'ready', voiceError: null });
          return;
        }
        this.patchState({
          inputPhase: 'failed',
          voiceError: 'Browser speech recognition failed. Tap Retry or type below.'
        });
      };

      recognition.onend = () => {
        if (this.destroyed || settled) return;
        settled = true;
        this.activeSpeechRecognition = null;

        if (this.cancelledCaptureEpochs.has(captureEpoch)) {
          this.cancelledCaptureEpochs.delete(captureEpoch);
          this.patchState({ inputPhase: 'ready', voiceError: null });
          return;
        }

        // Prevent stale browser results from overwriting an already successful Groq transcript
        if (this.lastGroqCompletedEpoch > txEpoch) {
          return;
        }

        const finalText = this.browserRecognitionTranscript.trim();
        if (!finalText) {
          this.patchState({
            inputPhase: 'failed',
            voiceError: 'No speech detected. Tap Retry to speak again.'
          });
          return;
        }

        this.patchState({
          inputPhase: 'completed',
          liveTranscript: finalText,
          voiceError: null,
          usingBrowserFallback: true
        });
        this.onTranscriptCompleted(finalText, {
          provider: 'browser',
          detectedLanguage: langCode
        });
      };

      recognition.start();
    } catch {
      this.activeSpeechRecognition = null;
      this.patchState({
        inputPhase: 'failed',
        voiceError: 'Could not start browser speech fallback. Type your message below.'
      });
    }
  }

  stopRecording(): void {
    if (this.activeSpeechRecognition) {
      try {
        this.activeSpeechRecognition.stop();
      } catch {
        this.activeSpeechRecognition = null;
      }
      return;
    }

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try {
        this.patchState({ inputPhase: 'processing' });
        this.mediaRecorder.stop();
      } catch {
        this.cleanupCaptureResources();
        this.patchState({
          inputPhase: 'failed',
          voiceError: 'Could not stop recording cleanly. Tap Retry.'
        });
      }
    }
  }

  cancelRecording(): void {
    const currentEpoch = this.captureEpoch;
    this.cancelledCaptureEpochs.add(currentEpoch);
    this.captureEpoch += 1;
    this.transcriptionEpoch += 1;
    this.isCaptureStarting = false;

    if (this.activeTranscribeAbort) {
      this.activeTranscribeAbort.abort();
      this.activeTranscribeAbort = null;
    }

    if (this.activeSpeechRecognition) {
      try {
        this.activeSpeechRecognition.abort();
      } catch {
        // Ignore abort errors
      }
      this.activeSpeechRecognition = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try {
        this.mediaRecorder.stop();
      } catch {
        this.cleanupCaptureResources();
      }
    } else {
      this.cleanupCaptureResources();
    }

    this.recordedChunks = [];
    this.patchState({
      inputPhase: 'ready',
      recordingDurationMs: 0,
      liveTranscript: '',
      voiceError: null,
      usingBrowserFallback: false
    });
  }

  async retryRecording(options: { forceBrowserFallback?: boolean } = {}): Promise<void> {
    this.cancelRecording();
    await this.startRecording(options);
  }

  clearVoiceReview(): void {
    this.patchState({
      inputPhase: 'ready',
      liveTranscript: '',
      voiceError: null,
      recordingDurationMs: 0,
      usingBrowserFallback: false
    });
  }

  // ==========================================
  // AUDIO PLAYBACK ARCHITECTURE (Phase 8 & 9)
  // ==========================================

  private bindAudioElementHandlers(
    audio: AudioElementLike,
    messageId: string,
    attemptId: number,
    text: string,
    langHint: 'ml' | 'en' | 'mixed'
  ): void {
    audio.onplaying = () => {
      if (this.destroyed || this.playbackEpoch !== attemptId) return;
      this.patchState({
        playbackPhase: 'playing',
        speakingMessageId: messageId,
        readyMessageId: messageId,
        playbackError: null
      });
    };

    audio.onpause = () => {
      if (this.destroyed || this.playbackEpoch !== attemptId) return;
      if (this.intentionalAudioPause || audio.ended) {
        this.intentionalAudioPause = false;
        return;
      }
      // External OS interruption (incoming call / Bluetooth disconnect / tab hidden)
      if (this.state.playbackPhase === 'playing') {
        this.patchState({
          playbackPhase: 'paused',
          speakingMessageId: null
        });
      }
    };

    audio.onended = () => {
      if (this.destroyed || this.playbackEpoch !== attemptId) return;
      this.patchState({
        playbackPhase: 'completed',
        speakingMessageId: null,
        readyMessageId: messageId
      });
    };

    audio.onerror = () => {
      if (this.destroyed || this.playbackEpoch !== attemptId) return;
      this.patchState({
        playbackPhase: 'failed',
        speakingMessageId: null,
        playbackError: PLAYBACK_ERROR_MESSAGES.invalid_audio
      });
      // Attempt browser speech synthesis ONLY as secondary notice if text is valid
      void text;
      void langHint;
    };
  }

  private async playCachedBlobUrl(
    blobUrl: string,
    messageId: string,
    attemptId: number,
    text: string,
    langHint: 'ml' | 'en' | 'mixed',
    restartFromBeginning: boolean = true
  ): Promise<void> {
    const audio = this.ensurePersistentAudioElement();
    if (!audio) {
      const synth = this.getSpeechSynthesisApi();
      if (synth) {
        this.speakWithBrowserSynthesis(text, messageId, langHint, attemptId);
      } else {
        this.patchState({
          playbackPhase: 'failed',
          speakingMessageId: null,
          playbackError: PLAYBACK_ERROR_MESSAGES.unsupported_browser
        });
      }
      return;
    }

    this.bindAudioElementHandlers(audio, messageId, attemptId, text, langHint);
    this.intentionalAudioPause = false;

    if (audio.src !== blobUrl) {
      audio.src = blobUrl;
      audio.load?.();
    } else if (restartFromBeginning) {
      audio.currentTime = 0;
    }

    try {
      await audio.play();
      if (this.destroyed || this.playbackEpoch !== attemptId) {
        this.intentionalAudioPause = true;
        audio.pause();
        return;
      }
      this.patchState({
        playbackPhase: 'playing',
        speakingMessageId: messageId,
        readyMessageId: messageId,
        playbackError: null
      });
    } catch (playErr) {
      if (this.destroyed || this.playbackEpoch !== attemptId) return;
      const category = classifyPlaybackException(playErr);

      if (category === 'autoplay_blocked') {
        // Keep generated audio cached and mark blocked so explicit Play starts immediately!
        this.patchState({
          playbackPhase: 'blocked',
          speakingMessageId: null,
          readyMessageId: messageId,
          playbackError: PLAYBACK_ERROR_MESSAGES.autoplay_blocked
        });
        return;
      }

      this.patchState({
        playbackPhase: 'failed',
        speakingMessageId: null,
        readyMessageId: messageId,
        playbackError: PLAYBACK_ERROR_MESSAGES[category]
      });
    }
  }

  private speakWithBrowserSynthesis(
    text: string,
    messageId: string,
    langHint: 'ml' | 'en' | 'mixed',
    attemptId: number
  ): boolean {
    const synth = this.getSpeechSynthesisApi();
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      return false;
    }

    const targetLocale = resolveSpeechSynthesisLocale(this.state.voiceLanguage, langHint);
    const voices = typeof synth.getVoices === 'function' ? synth.getVoices() || [] : [];

    // Strict Malayalam preservation: never let an unrelated voice garble pure Malayalam text
    if (targetLocale === 'ml-IN') {
      const mlVoice = voices.find(v => v.lang.toLowerCase().startsWith('ml'));
      if (!mlVoice && langHint === 'ml') {
        return false;
      }
    }

    try {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      if (targetLocale === 'ml-IN') {
        const mlVoice = voices.find(v => v.lang.toLowerCase().startsWith('ml'));
        if (mlVoice) {
          utterance.voice = mlVoice;
          utterance.lang = mlVoice.lang;
        } else {
          utterance.lang = 'en-IN';
        }
      } else {
        const enVoice =
          voices.find(v => v.lang.toLowerCase() === 'en-in') ||
          voices.find(v => v.lang.toLowerCase().startsWith('en'));
        if (enVoice) {
          utterance.voice = enVoice;
          utterance.lang = enVoice.lang;
        } else {
          utterance.lang = 'en-IN';
        }
      }

      utterance.rate = 1.0;
      utterance.onstart = () => {
        if (this.destroyed || this.playbackEpoch !== attemptId) return;
        this.patchState({
          playbackPhase: 'playing',
          speakingMessageId: messageId,
          playbackNotice: 'Using browser speech voice for playback.'
        });
      };
      utterance.onend = () => {
        if (this.destroyed || this.playbackEpoch !== attemptId) return;
        this.patchState({
          playbackPhase: 'completed',
          speakingMessageId: null
        });
      };
      utterance.onerror = () => {
        if (this.destroyed || this.playbackEpoch !== attemptId) return;
        this.patchState({
          playbackPhase: 'failed',
          speakingMessageId: null
        });
      };

      synth.speak(utterance);
      this.patchState({
        playbackPhase: 'playing',
        speakingMessageId: messageId,
        playbackNotice: 'Using browser speech voice for playback.'
      });
      return true;
    } catch {
      return false;
    }
  }

  async speakResponse(
    text: string,
    messageId: string,
    langHint: 'ml' | 'en' | 'mixed',
    forcePlay: boolean = false
  ): Promise<void> {
    const clean = text.trim();
    if (!clean) {
      this.patchState({ playbackPhase: 'idle', speakingMessageId: null });
      return;
    }

    this.patchState({
      lastMessage: { id: messageId, text: clean, langHint },
      playbackError: null,
      playbackNotice: null
    });

    if (this.state.isMuted && !forcePlay) {
      this.stopPlayback();
      return;
    }

    // Cancel any existing playback/generation so there are NEVER overlapping voices
    const attemptId = this.haltAudioInternal();

    // Reuse cached validated audio whenever available (never regenerate unnecessarily!)
    const cached = this.activeTtsCache.get(messageId);
    if (cached) {
      this.patchState({ playbackPhase: 'ready', readyMessageId: messageId });
      await this.playCachedBlobUrl(cached.blobUrl, messageId, attemptId, clean, langHint, true);
      return;
    }

    this.patchState({
      playbackPhase: 'generating',
      speakingMessageId: messageId,
      playbackError: null
    });

    const abortController = new AbortController();
    this.activeSpeakAbort = abortController;
    const synthesizeFn = this.adapters.synthesizeSpeech ?? agentService.synthesizeSpeech;

    try {
      const tts = await synthesizeFn({
        text: clean,
        languageHint: langHint,
        accessToken: this.accessToken,
        signal: abortController.signal
      });

      if (this.destroyed || this.playbackEpoch !== attemptId) {
        return;
      }

      const prepared = validateAndPrepareTtsAudio(tts.audioBase64, tts.mimeType || 'audio/wav');
      if (!prepared) {
        this.patchState({
          playbackPhase: 'failed',
          speakingMessageId: null,
          playbackError: PLAYBACK_ERROR_MESSAGES.invalid_audio
        });
        return;
      }

      const audioCopy = new Uint8Array(prepared.bytes.byteLength);
      audioCopy.set(prepared.bytes);
      const blob = new Blob([audioCopy.buffer], { type: prepared.mimeType });
      const blobUrl = this.createObjectUrl(blob);
      this.activeTtsCache.set(messageId, { blobUrl, mimeType: prepared.mimeType });

      this.patchState({
        playbackPhase: 'ready',
        readyMessageId: messageId
      });

      await this.playCachedBlobUrl(blobUrl, messageId, attemptId, clean, langHint, true);
    } catch (err) {
      if (this.destroyed || this.playbackEpoch !== attemptId) return;
      if (err instanceof AiServiceError && err.code === 'cancelled') {
        this.patchState({ playbackPhase: 'idle', speakingMessageId: null });
        return;
      }

      const category = classifyPlaybackException(err);
      const errorMsg = PLAYBACK_ERROR_MESSAGES[category];

      if (category === 'tts_failed') {
        const fallbackStarted = this.speakWithBrowserSynthesis(clean, messageId, langHint, attemptId);
        if (fallbackStarted) {
          this.patchState({
            playbackError: errorMsg,
            playbackNotice: 'Playing via browser speech synthesis fallback.'
          });
          return;
        }
      }

      this.patchState({
        playbackPhase: 'failed',
        speakingMessageId: null,
        playbackError: errorMsg
      });
    } finally {
      if (this.activeSpeakAbort === abortController) {
        this.activeSpeakAbort = null;
      }
    }
  }

  /**
   * Explicit user-initiated Play / Resume / Replay action.
   * Synchronous gesture preserves browser autoplay eligibility and avoids regenerating cached audio.
   */
  async playOrResume(targetMessage?: { id: string; text: string; langHint: 'ml' | 'en' | 'mixed' }): Promise<void> {
    this.unlockAudioFromUserGesture();

    const msg = targetMessage || this.state.lastMessage;
    if (!msg) return;

    const cached = this.activeTtsCache.get(msg.id);
    if (
      this.state.playbackPhase === 'paused' &&
      this.state.readyMessageId === msg.id &&
      this.persistentAudioEl &&
      cached &&
      this.persistentAudioEl.src === cached.blobUrl
    ) {
      const attemptId = ++this.playbackEpoch;
      this.bindAudioElementHandlers(this.persistentAudioEl, msg.id, attemptId, msg.text, msg.langHint);
      this.intentionalAudioPause = false;
      try {
        await this.persistentAudioEl.play();
        if (!this.destroyed && this.playbackEpoch === attemptId) {
          this.patchState({
            playbackPhase: 'playing',
            speakingMessageId: msg.id,
            playbackError: null
          });
        }
      } catch (err) {
        const category = classifyPlaybackException(err);
        this.patchState({
          playbackPhase: category === 'autoplay_blocked' ? 'blocked' : 'failed',
          speakingMessageId: null,
          playbackError: PLAYBACK_ERROR_MESSAGES[category]
        });
      }
      return;
    }

    await this.speakResponse(msg.text, msg.id, msg.langHint, true);
  }

  pausePlayback(): void {
    const audio = this.persistentAudioEl;
    if (audio && !audio.paused && this.state.playbackPhase === 'playing') {
      this.intentionalAudioPause = true;
      audio.pause();
      this.patchState({
        playbackPhase: 'paused',
        speakingMessageId: null
      });
      return;
    }

    const synth = this.getSpeechSynthesisApi();
    if (synth && this.state.playbackPhase === 'playing') {
      try {
        synth.cancel();
      } catch {
        // Ignore cancel errors
      }
      this.patchState({
        playbackPhase: 'paused',
        speakingMessageId: null
      });
    }
  }

  private haltAudioInternal(): number {
    const nextEpoch = ++this.playbackEpoch;
    if (this.activeSpeakAbort) {
      this.activeSpeakAbort.abort();
      this.activeSpeakAbort = null;
    }
    if (this.persistentAudioEl) {
      this.intentionalAudioPause = true;
      try {
        this.persistentAudioEl.pause();
        this.persistentAudioEl.currentTime = 0;
      } catch {
        // Ignore pause/reset errors
      }
    }
    const synth = this.getSpeechSynthesisApi();
    if (synth) {
      try {
        synth.cancel();
      } catch {
        // Ignore synthesis cancel errors
      }
    }
    return nextEpoch;
  }

  stopPlayback(): void {
    this.haltAudioInternal();
    this.patchState({
      playbackPhase: this.state.lastMessage && this.activeTtsCache.has(this.state.lastMessage.id) ? 'ready' : 'idle',
      speakingMessageId: null,
      playbackNotice: null
    });
  }

  async replayLastResponse(): Promise<void> {
    if (!this.state.lastMessage) return;
    await this.playOrResume(this.state.lastMessage);
  }

  clearCachedAudio(): void {
    this.haltAudioInternal();
    this.activeTtsCache.forEach(entry => this.revokeObjectUrl(entry.blobUrl));
    this.activeTtsCache.clear();
    if (this.persistentAudioEl) {
      this.persistentAudioEl.src = '';
    }
    this.patchState({
      playbackPhase: 'idle',
      speakingMessageId: null,
      readyMessageId: null,
      lastMessage: null,
      playbackError: null,
      playbackNotice: null
    });
  }

  /**
   * Handles mobile browser backgrounding, screen lock, incoming interruptions, and tab switching.
   */
  handleVisibilityChange(isHidden: boolean): void {
    if (!isHidden || this.destroyed) return;
    if (this.state.inputPhase === 'listening' || this.state.inputPhase === 'recording') {
      this.cancelRecording();
      this.patchState({
        inputPhase: 'failed',
        voiceError: 'Recording paused when the screen locked or switched away. Tap Retry to speak.'
      });
    }
    if (this.state.playbackPhase === 'playing') {
      this.pausePlayback();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.cancelRecording();
    this.clearCachedAudio();
    if (this.playbackAudioContext) {
      try {
        void this.playbackAudioContext.close().catch(() => undefined);
      } catch {
        // Ignore close errors
      }
      this.playbackAudioContext = null;
    }
    this.destroyed = true;
  }
}
