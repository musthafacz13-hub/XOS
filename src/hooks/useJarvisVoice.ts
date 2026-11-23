import { useCallback, useEffect, useRef, useState } from 'react';
import { agentService, PreferredVoiceLanguage } from '../services/ai/agentService';

export type JarvisVoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';
export type MicPermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

function blobToBase64(blob: Blob): Promise<string> {
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

function wrapRawPcmAsWav(pcmBytes: Uint8Array, sampleRate: number = 24000): Uint8Array {
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
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeStr(36, 'data');
  view.setUint32(40, pcmBytes.byteLength, true);

  const wav = new Uint8Array(44 + pcmBytes.byteLength);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcmBytes, 44);
  return wav;
}

function base64ToWavBlobUrl(base64: string, mimeType: string = 'audio/wav'): string {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const hasRiffHeader =
    bytes.length >= 4 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46;

  const isRawPcm = mimeType.toLowerCase().includes('l16') || mimeType.toLowerCase().includes('pcm');
  if (isRawPcm && !hasRiffHeader) {
    const wavBytes = wrapRawPcmAsWav(bytes);
    const copy = new Uint8Array(wavBytes.byteLength);
    copy.set(wavBytes);
    return URL.createObjectURL(new Blob([copy.buffer], { type: 'audio/wav' }));
  }

  const normalizedMime = mimeType.toLowerCase().includes('wav') || hasRiffHeader ? 'audio/wav' : mimeType;
  const blob = new Blob([bytes.buffer], { type: normalizedMime });
  return URL.createObjectURL(blob);
}

function pickSupportedRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg'
  ];
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    } catch {
      // Ignore probe errors
    }
  }
  return undefined;
}

interface UseJarvisVoiceOptions {
  accessToken?: string | null;
  onTranscriptReady: (transcript: string) => void | Promise<void>;
}

export function useJarvisVoice({ accessToken, onTranscriptReady }: UseJarvisVoiceOptions) {
  const [voiceState, setVoiceState] = useState<JarvisVoiceState>('idle');
  const [voiceLanguage, setVoiceLanguage] = useState<PreferredVoiceLanguage>('auto');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [liveTranscript, setLiveTranscript] = useState<string>('');
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [lastSpokenText, setLastSpokenText] = useState<{
    id: string;
    text: string;
    langHint: 'ml' | 'en' | 'mixed';
  } | null>(null);

  const [micPermission, setMicPermission] = useState<MicPermissionState>(() => {
    if (typeof navigator === 'undefined') return 'unsupported';
    const hasMedia = Boolean(navigator.mediaDevices?.getUserMedia);
    const hasSpeech = Boolean(getSpeechRecognitionCtor());
    return hasMedia || hasSpeech ? 'prompt' : 'unsupported';
  });

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const maxCaptureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlCacheRef = useRef<Map<string, string>>(new Map());
  const isMutedRef = useRef<boolean>(false);
  const voiceStateRef = useRef<JarvisVoiceState>('idle');
  const mountedRef = useRef<boolean>(true);
  const speechAttemptIdRef = useRef<number>(0);
  const onTranscriptReadyRef = useRef(onTranscriptReady);
  const latestTranscriptRef = useRef<string>('');

  useEffect(() => {
    onTranscriptReadyRef.current = onTranscriptReady;
  }, [onTranscriptReady]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  const cleanupCaptureResources = useCallback(() => {
    if (maxCaptureTimerRef.current !== null) {
      clearTimeout(maxCaptureTimerRef.current);
      maxCaptureTimerRef.current = null;
    }
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  const stopSpeaking = useCallback(() => {
    speechAttemptIdRef.current += 1;
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
      activeAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore browser speechSynthesis errors
      }
    }
    if (mountedRef.current) {
      setSpeakingMessageId(null);
      if (voiceStateRef.current === 'speaking') {
        setVoiceState('idle');
      }
    }
  }, []);

  const speakWithBrowserFallback = useCallback(
    (text: string, messageId: string, langHint: 'ml' | 'en' | 'mixed', attemptId: number) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        if (mountedRef.current && voiceStateRef.current === 'speaking') {
          setVoiceState('idle');
          setSpeakingMessageId(null);
        }
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices() || [];
        if (langHint === 'ml' || langHint === 'mixed') {
          const mlVoice = voices.find(v => v.lang.toLowerCase().startsWith('ml'));
          if (!mlVoice && langHint === 'ml') {
            // Browser lacks Malayalam voice; keep text response visible without garbled speech
            if (mountedRef.current && voiceStateRef.current === 'speaking') {
              setVoiceState('idle');
              setSpeakingMessageId(null);
            }
            return;
          }
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
            utterance.lang = 'en-US';
          }
        }
        utterance.rate = 1.0;
        utterance.onstart = () => {
          if (!mountedRef.current || speechAttemptIdRef.current !== attemptId) return;
          setSpeakingMessageId(messageId);
          setVoiceState('speaking');
        };
        utterance.onend = () => {
          if (!mountedRef.current || speechAttemptIdRef.current !== attemptId) return;
          setSpeakingMessageId(null);
          if (voiceStateRef.current === 'speaking') {
            setVoiceState('idle');
          }
        };
        utterance.onerror = () => {
          if (!mountedRef.current || speechAttemptIdRef.current !== attemptId) return;
          setSpeakingMessageId(null);
          if (voiceStateRef.current === 'speaking') {
            setVoiceState('idle');
          }
        };
        window.speechSynthesis.speak(utterance);
      } catch {
        if (mountedRef.current && voiceStateRef.current === 'speaking') {
          setSpeakingMessageId(null);
          setVoiceState('idle');
        }
      }
    },
    []
  );

  const speakResponse = useCallback(
    async (
      text: string,
      messageId: string,
      langHint: 'ml' | 'en' | 'mixed',
      forcePlay: boolean = false
    ) => {
      const clean = text.trim();
      if (!clean) {
        if (mountedRef.current) setVoiceState('idle');
        return;
      }

      setLastSpokenText({ id: messageId, text: clean, langHint });

      if (isMutedRef.current && !forcePlay) {
        if (mountedRef.current) setVoiceState('idle');
        return;
      }

      stopSpeaking();
      const attemptId = ++speechAttemptIdRef.current;

      if (mountedRef.current) {
        setSpeakingMessageId(messageId);
        setVoiceState('speaking');
      }

      try {
        let blobUrl = audioUrlCacheRef.current.get(messageId);
        if (!blobUrl) {
          const tts = await agentService.synthesizeSpeech({
            text: clean,
            languageHint: langHint,
            accessToken
          });
          if (!mountedRef.current || speechAttemptIdRef.current !== attemptId) return;
          blobUrl = base64ToWavBlobUrl(tts.audioBase64, tts.mimeType || 'audio/wav');
          audioUrlCacheRef.current.set(messageId, blobUrl);
        }

        if (!mountedRef.current || speechAttemptIdRef.current !== attemptId) return;

        const audio = new Audio(blobUrl);
        activeAudioRef.current = audio;

        audio.onended = () => {
          if (!mountedRef.current || speechAttemptIdRef.current !== attemptId) return;
          activeAudioRef.current = null;
          setSpeakingMessageId(null);
          if (voiceStateRef.current === 'speaking') {
            setVoiceState('idle');
          }
        };

        audio.onerror = () => {
          if (!mountedRef.current || speechAttemptIdRef.current !== attemptId) return;
          activeAudioRef.current = null;
          speakWithBrowserFallback(clean, messageId, langHint, attemptId);
        };

        try {
          await audio.play();
        } catch (playErr) {
          if (!mountedRef.current || speechAttemptIdRef.current !== attemptId) return;
          activeAudioRef.current = null;
          setSpeakingMessageId(null);
          if ((playErr as { name?: string })?.name === 'NotAllowedError') {
            setVoiceNotice('Audio playback was blocked by your browser. Tap Replay to listen.');
            setVoiceState('idle');
            return;
          }
          speakWithBrowserFallback(clean, messageId, langHint, attemptId);
        }
      } catch {
        if (!mountedRef.current || speechAttemptIdRef.current !== attemptId) return;
        speakWithBrowserFallback(clean, messageId, langHint, attemptId);
      }
    },
    [accessToken, speakWithBrowserFallback, stopSpeaking]
  );

  const replayLastResponse = useCallback(async () => {
    if (!lastSpokenText) return;
    await speakResponse(lastSpokenText.text, lastSpokenText.id, lastSpokenText.langHint, true);
  }, [lastSpokenText, speakResponse]);

  const startMediaRecorderCapture = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMicPermission('unsupported');
      setVoiceNotice('Microphone voice capture is not supported in this browser. You can type your question below.');
      setVoiceState('idle');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      setMicPermission('granted');
      setVoiceNotice(null);
      mediaStreamRef.current = stream;

      const preferredMime = pickSupportedRecorderMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
      } catch {
        recorder = new MediaRecorder(stream);
      }
      const effectiveMimeType = (recorder.mimeType || preferredMime || 'audio/webm').toLowerCase();
      recordedChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      // Setup lightweight analyser for orb amplitude & polite silence detection
      let silenceTimerStart: number | null = null;
      let speechDetected = false;
      const captureStartedAt = Date.now();

      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioContextRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          const tick = () => {
            if (!mountedRef.current || mediaRecorderRef.current?.state !== 'recording') return;
            analyser.getByteTimeDomainData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              const v = (dataArray[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / dataArray.length);
            const normalizedLevel = Math.min(1, rms * 4.5);
            setAudioLevel(normalizedLevel);

            if (rms > 0.035) {
              speechDetected = true;
              silenceTimerStart = null;
            } else if (speechDetected && Date.now() - captureStartedAt > 900) {
              if (silenceTimerStart === null) {
                silenceTimerStart = Date.now();
              } else if (Date.now() - silenceTimerStart > 1600) {
                if (mediaRecorderRef.current?.state === 'recording') {
                  mediaRecorderRef.current.stop();
                }
                return;
              }
            }
            rafIdRef.current = requestAnimationFrame(tick);
          };
          rafIdRef.current = requestAnimationFrame(tick);
        }
      } catch {
        // Analyser is strictly visual; manual tap-to-stop works even without AudioContext
      }

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        mediaRecorderRef.current = null;
        cleanupCaptureResources();

        if (!mountedRef.current) return;
        if (chunks.length === 0) {
          setVoiceState('idle');
          return;
        }

        const blob = new Blob(chunks, { type: effectiveMimeType });
        if (blob.size < 400) {
          setVoiceState('idle');
          return;
        }

        setVoiceState('thinking');
        setLiveTranscript('');

        try {
          const base64 = await blobToBase64(blob);
          const res = await agentService.transcribeAudio({
            audioBase64: base64,
            mimeType: effectiveMimeType,
            preferredLanguage: voiceLanguage,
            accessToken
          });

          if (!mountedRef.current) return;
          const transcript = (res.transcript || '').trim();
          if (!transcript) {
            setVoiceNotice('No clear speech detected. Tap the microphone and try again.');
            setVoiceState('idle');
            return;
          }
          await onTranscriptReadyRef.current(transcript);
        } catch (err) {
          if (!mountedRef.current) return;
          const message = err instanceof Error ? err.message : 'Unable to transcribe audio.';
          setVoiceNotice(message);
          setVoiceState('idle');
        }
      };

      setLiveTranscript('');
      setVoiceState('listening');
      recorder.start(250);
      maxCaptureTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, 40000);
    } catch (err) {
      cleanupCaptureResources();
      const errName = (err as { name?: string })?.name || '';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setMicPermission('denied');
        setVoiceNotice('Microphone permission was denied. Allow mic access in your browser settings or type below.');
      } else {
        setVoiceNotice('Could not access your microphone right now. You can type your question below.');
      }
      setVoiceState('idle');
    }
  }, [accessToken, cleanupCaptureResources, voiceLanguage]);

  const startWebSpeechCapture = useCallback(
    (langCode: 'ml-IN' | 'en-IN') => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        void startMediaRecorderCapture();
        return;
      }

      try {
        const recognition = new Ctor();
        recognition.lang = langCode;
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        latestTranscriptRef.current = '';
        recognitionRef.current = recognition;

        let settled = false;

        recognition.onstart = () => {
          if (!mountedRef.current) return;
          setMicPermission('granted');
          setVoiceNotice(null);
          setLiveTranscript('');
          setVoiceState('listening');
        };

        recognition.onresult = (event) => {
          if (!mountedRef.current) return;
          let full = '';
          for (let i = 0; i < event.results.length; i++) {
            full += event.results[i][0]?.transcript || '';
          }
          const clean = full.trim();
          latestTranscriptRef.current = clean;
          setLiveTranscript(clean);
        };

        recognition.onerror = (event) => {
          if (!mountedRef.current || settled) return;
          const code = event.error;
          if (code === 'not-allowed' || code === 'service-not-allowed') {
            settled = true;
            recognitionRef.current = null;
            setMicPermission('denied');
            setVoiceNotice('Microphone permission is blocked. Enable access or type your question below.');
            setVoiceState('idle');
            return;
          }
          if (code === 'language-not-supported' || code === 'network' || code === 'audio-capture') {
            settled = true;
            recognitionRef.current = null;
            void startMediaRecorderCapture();
            return;
          }
          if (code === 'no-speech') {
            settled = true;
            recognitionRef.current = null;
            setVoiceNotice('No speech heard. Tap the microphone to speak again.');
            setVoiceState('idle');
            return;
          }
          if (code !== 'aborted') {
            settled = true;
            recognitionRef.current = null;
            setVoiceState('idle');
          }
        };

        recognition.onend = () => {
          if (!mountedRef.current) return;
          recognitionRef.current = null;
          if (settled) return;
          settled = true;
          const finalText = latestTranscriptRef.current.trim();
          setLiveTranscript('');
          if (finalText) {
            void onTranscriptReadyRef.current(finalText);
          } else if (voiceStateRef.current === 'listening') {
            setVoiceState('idle');
          }
        };

        recognition.start();
      } catch {
        recognitionRef.current = null;
        void startMediaRecorderCapture();
      }
    },
    [startMediaRecorderCapture]
  );

  const startListening = useCallback(() => {
    if (voiceStateRef.current === 'listening' || voiceStateRef.current === 'thinking') {
      return;
    }
    stopSpeaking();
    setVoiceNotice(null);

    const hasSpeech = Boolean(getSpeechRecognitionCtor());
    if (voiceLanguage !== 'auto' && hasSpeech) {
      startWebSpeechCapture(voiceLanguage);
      return;
    }

    // For 'auto' (bilingual Malayalam + English + Manglish) prefer MediaRecorder + Gemini transcription
    // when available; otherwise fall back to Web Speech en-IN.
    if (typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)) {
      void startMediaRecorderCapture();
    } else if (hasSpeech) {
      startWebSpeechCapture('en-IN');
    } else {
      setMicPermission('unsupported');
      setVoiceNotice('Voice input is not supported in this browser. Type your question below.');
    }
  }, [startMediaRecorderCapture, startWebSpeechCapture, stopSpeaking, voiceLanguage]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        recognitionRef.current = null;
      }
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        cleanupCaptureResources();
        setVoiceState('idle');
      }
    }
  }, [cleanupCaptureResources]);

  const toggleMicrophone = useCallback(() => {
    if (voiceStateRef.current === 'listening') {
      stopListening();
    } else if (voiceStateRef.current === 'speaking') {
      stopSpeaking();
      startListening();
    } else if (voiceStateRef.current === 'idle') {
      startListening();
    }
  }, [startListening, stopListening, stopSpeaking]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      if (next) {
        stopSpeaking();
      }
      return next;
    });
  }, [stopSpeaking]);

  const clearCachedAudio = useCallback(() => {
    stopSpeaking();
    audioUrlCacheRef.current.forEach(url => URL.revokeObjectURL(url));
    audioUrlCacheRef.current.clear();
    setLastSpokenText(null);
  }, [stopSpeaking]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore abort errors
        }
        recognitionRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore stop errors
        }
      }
      cleanupCaptureResources();
      stopSpeaking();
      audioUrlCacheRef.current.forEach(url => URL.revokeObjectURL(url));
      audioUrlCacheRef.current.clear();
    };
  }, [cleanupCaptureResources, stopSpeaking]);

  return {
    voiceState,
    setVoiceState,
    voiceLanguage,
    setVoiceLanguage,
    isMuted,
    toggleMute,
    micPermission,
    liveTranscript,
    audioLevel,
    voiceNotice,
    setVoiceNotice,
    speakingMessageId,
    canReplay: Boolean(lastSpokenText),
    toggleMicrophone,
    startListening,
    stopListening,
    stopSpeaking,
    speakResponse,
    replayLastResponse,
    clearCachedAudio
  };
}
