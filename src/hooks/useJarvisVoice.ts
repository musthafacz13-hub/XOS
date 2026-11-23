import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PreferredVoiceLanguage } from '../services/ai/agentService';
import { VoiceController, VoiceStateSnapshot } from '../services/ai/voiceController';
import { AudioPlaybackPhase, DEFAULT_VOICE_LANGUAGE, VoiceInputPhase } from '../services/ai/voiceUtils';

export type JarvisVoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
export type MicPermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported';

interface UseJarvisVoiceOptions {
  accessToken?: string | null;
  onTranscriptReady: (transcript: string, meta: { provider: 'groq' | 'browser'; detectedLanguage?: string }) => void;
}

export function useJarvisVoice({ accessToken, onTranscriptReady }: UseJarvisVoiceOptions) {
  const onTranscriptReadyRef = useRef(onTranscriptReady);
  useEffect(() => {
    onTranscriptReadyRef.current = onTranscriptReady;
  }, [onTranscriptReady]);

  const controllerRef = useRef<VoiceController | null>(null);
  const [aiThinkingOverride, setAiThinkingOverride] = useState(false);

  if (!controllerRef.current) {
    controllerRef.current = new VoiceController({
      accessToken,
      initialLanguage: DEFAULT_VOICE_LANGUAGE,
      onStateChange: (next) => {
        setSnapshot(next);
      },
      onTranscriptCompleted: (transcript, meta) => {
        onTranscriptReadyRef.current(transcript, meta);
      }
    });
  }

  const [snapshot, setSnapshot] = useState<VoiceStateSnapshot>(() =>
    controllerRef.current!.getSnapshot()
  );

  useEffect(() => {
    controllerRef.current?.setAccessToken(accessToken);
  }, [accessToken]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;

    const onVisibility = () => {
      if (typeof document !== 'undefined') {
        controller.handleVisibilityChange(document.hidden);
      }
    };
    const onPageHide = () => {
      controller.handleVisibilityChange(true);
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', onPageHide);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onPageHide);
      }
      controller.destroy();
    };
  }, []);

  const voiceState: JarvisVoiceState = useMemo(() => {
    if (snapshot.inputPhase === 'listening' || snapshot.inputPhase === 'recording') {
      return 'listening';
    }
    if (snapshot.inputPhase === 'processing' || snapshot.playbackPhase === 'generating' || aiThinkingOverride) {
      return 'thinking';
    }
    if (snapshot.playbackPhase === 'playing') {
      return 'speaking';
    }
    if (snapshot.inputPhase === 'failed') {
      return 'error';
    }
    return 'idle';
  }, [aiThinkingOverride, snapshot.inputPhase, snapshot.playbackPhase]);

  const setVoiceState = useCallback((next: JarvisVoiceState) => {
    setAiThinkingOverride(next === 'thinking');
    if (next === 'idle') {
      setAiThinkingOverride(false);
    }
  }, []);

  const setVoiceLanguage = useCallback((lang: PreferredVoiceLanguage) => {
    controllerRef.current?.setVoiceLanguage(lang);
  }, []);

  const setEditableTranscript = useCallback((text: string) => {
    controllerRef.current?.setEditableTranscript(text);
  }, []);

  const toggleMute = useCallback(() => {
    controllerRef.current?.toggleMute();
  }, []);

  const unlockAudioFromUserGesture = useCallback(() => {
    controllerRef.current?.unlockAudioFromUserGesture();
  }, []);

  const startListening = useCallback(() => {
    void controllerRef.current?.startRecording();
  }, []);

  const startBrowserFallbackRecording = useCallback(() => {
    void controllerRef.current?.startRecording({ forceBrowserFallback: true });
  }, []);

  const stopListening = useCallback(() => {
    controllerRef.current?.stopRecording();
  }, []);

  const cancelRecording = useCallback(() => {
    controllerRef.current?.cancelRecording();
  }, []);

  const retryRecording = useCallback(() => {
    void controllerRef.current?.retryRecording();
  }, []);

  const clearVoiceReview = useCallback(() => {
    controllerRef.current?.clearVoiceReview();
  }, []);

  const stopSpeaking = useCallback(() => {
    controllerRef.current?.stopPlayback();
  }, []);

  const pausePlayback = useCallback(() => {
    controllerRef.current?.pausePlayback();
  }, []);

  const playOrResume = useCallback(
    async (target?: { id: string; text: string; langHint: 'ml' | 'en' | 'mixed' }) => {
      await controllerRef.current?.playOrResume(target);
    },
    []
  );

  const speakResponse = useCallback(
    async (text: string, messageId: string, langHint: 'ml' | 'en' | 'mixed', forcePlay: boolean = false) => {
      await controllerRef.current?.speakResponse(text, messageId, langHint, forcePlay);
    },
    []
  );

  const replayLastResponse = useCallback(async () => {
    await controllerRef.current?.replayLastResponse();
  }, []);

  const clearCachedAudio = useCallback(() => {
    controllerRef.current?.clearCachedAudio();
  }, []);

  const toggleMicrophone = useCallback(() => {
    const current = controllerRef.current?.getSnapshot();
    if (!current) return;
    if (current.inputPhase === 'listening' || current.inputPhase === 'recording') {
      controllerRef.current?.stopRecording();
      return;
    }
    if (current.playbackPhase === 'playing' || current.playbackPhase === 'generating') {
      controllerRef.current?.stopPlayback();
    }
    if (current.inputPhase !== 'processing') {
      void controllerRef.current?.startRecording();
    }
  }, []);

  const voiceNotice = snapshot.playbackError || snapshot.voiceError || snapshot.playbackNotice || null;

  return {
    voiceState,
    setVoiceState,
    inputPhase: snapshot.inputPhase as VoiceInputPhase,
    playbackPhase: snapshot.playbackPhase as AudioPlaybackPhase,
    voiceLanguage: snapshot.voiceLanguage,
    setVoiceLanguage,
    isMuted: snapshot.isMuted,
    toggleMute,
    micPermission: snapshot.micPermission as MicPermissionState,
    recordingDurationMs: snapshot.recordingDurationMs,
    liveTranscript: snapshot.liveTranscript,
    setEditableTranscript,
    audioLevel: snapshot.audioLevel,
    voiceError: snapshot.voiceError,
    playbackError: snapshot.playbackError,
    playbackNotice: snapshot.playbackNotice,
    voiceNotice,
    usingBrowserFallback: snapshot.usingBrowserFallback,
    speakingMessageId: snapshot.speakingMessageId,
    readyMessageId: snapshot.readyMessageId,
    lastPlaybackMessage: snapshot.lastMessage,
    canReplay: Boolean(snapshot.lastMessage),
    unlockAudioFromUserGesture,
    toggleMicrophone,
    startListening,
    startBrowserFallbackRecording,
    stopListening,
    cancelRecording,
    retryRecording,
    clearVoiceReview,
    stopSpeaking,
    pausePlayback,
    playOrResume,
    speakResponse,
    replayLastResponse,
    clearCachedAudio
  };
}
