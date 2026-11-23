import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  RotateCcw,
  Send,
  Square,
  Volume2,
  VolumeX,
  AlertCircle,
  Play,
  ShieldCheck
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useXOSData } from '../../hooks/useXOSData';
import { useJarvisVoice } from '../../hooks/useJarvisVoice';
import {
  agentService,
  AiServiceError,
  PreferredVoiceLanguage
} from '../../services/ai/agentService';
import {
  buildSelectiveXosContext,
  SessionTurnMemory
} from '../../services/ai/contextBuilder';
import { XosModuleKey } from '../../services/ai/xosKnowledge';
import { VoiceOrb } from './VoiceOrb';

interface AgentMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  modules?: XosModuleKey[];
  langHint?: 'ml' | 'en' | 'mixed';
  timestamp: string;
}

interface AgentErrorState {
  message: string;
  category?: string;
  stage?: string;
  requestId?: string;
  durationMs?: number;
  failedQuery?: string;
}

const QUICK_PROMPTS: Array<{ label: string; query: string }> = [
  {
    label: 'Monthly spending overview',
    query: 'How are my expenses this month compared to last month?'
  },
  {
    label: 'ഈ മാസം എന്റെ ചെലവുകൾ',
    query: 'ഈ മാസം എന്റെ ചെലവുകൾ എങ്ങനെയുണ്ട്?'
  },
  {
    label: 'Salary & work attendance',
    query: 'Summarize my work attendance and earned salary for this month.'
  },
  {
    label: 'Debt & savings balance',
    query: 'What is my current debt balance and total savings progress?'
  }
];

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatMessageTime(date: Date = new Date()): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });
}

export const AiAgentView: React.FC = () => {
  const data = useXOSData();
  const { session } = useAuth();
  const accessToken = session?.access_token || null;

  // Strictly active-session in-memory conversation state (never written to persistent browser storage)
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [errorNotice, setErrorNotice] = useState<AgentErrorState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const messagesRef = useRef<AgentMessage[]>([]);
  const isSubmittingRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const voiceRef = useRef<ReturnType<typeof useJarvisVoice> | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const handleSubmitQuery = useCallback(
    async (rawQuery: string, viaVoice: boolean = false, isRetry: boolean = false) => {
      const cleanQuery = rawQuery.trim();
      if (!cleanQuery || isSubmittingRef.current) return;

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setErrorNotice(null);
      voiceRef.current?.setVoiceNotice(null);
      voiceRef.current?.stopSpeaking();
      voiceRef.current?.setVoiceState('thinking');

      const lastMsg = messagesRef.current[messagesRef.current.length - 1];
      const alreadyAppendedSamePendingTurn =
        Boolean(lastMsg && lastMsg.role === 'user' && lastMsg.text.trim() === cleanQuery);

      const historySource = alreadyAppendedSamePendingTurn
        ? messagesRef.current.slice(0, -1)
        : messagesRef.current;

      const recentHistory: SessionTurnMemory[] = historySource.slice(-10).map(m => ({
        role: m.role,
        text: m.text,
        modules: m.modules
      }));

      // Selective read-only data retrieval (zero DB writes, zero full-DB dump)
      const selective = buildSelectiveXosContext({
        query: cleanQuery,
        data,
        recentTurns: recentHistory
      });

      if (!isRetry && !alreadyAppendedSamePendingTurn) {
        const userMessage: AgentMessage = {
          id: createMessageId(),
          role: 'user',
          text: cleanQuery,
          modules: selective.selectedModules,
          langHint: selective.intent.detectedLanguage,
          timestamp: formatMessageTime()
        };
        setMessages(prev => [...prev, userMessage]);
      }

      if (!viaVoice) {
        setInputText('');
      }

      try {
        const result = await agentService.sendMessage({
          message: cleanQuery,
          history: recentHistory,
          groundedContext: selective.groundedContext,
          preferredLanguage: voiceRef.current?.voiceLanguage || 'auto',
          accessToken
        });

        const assistantMsgId = createMessageId();
        const assistantMessage: AgentMessage = {
          id: assistantMsgId,
          role: 'model',
          text: result.reply,
          modules: selective.selectedModules,
          langHint: result.detectedLanguage,
          timestamp: formatMessageTime()
        };

        setMessages(prev => [...prev, assistantMessage]);
        await voiceRef.current?.speakResponse(
          result.reply,
          assistantMsgId,
          result.detectedLanguage
        );
      } catch (err) {
        if (err instanceof AiServiceError) {
          setErrorNotice({
            message: err.message,
            category: err.category,
            stage: err.stage,
            requestId: err.requestId,
            durationMs: err.durationMs,
            failedQuery: cleanQuery
          });
        } else {
          setErrorNotice({
            message: 'Unable to reach the AI Agent right now. Please try again.',
            category: 'network_error',
            failedQuery: cleanQuery
          });
        }
        voiceRef.current?.setVoiceState('idle');
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [accessToken, data]
  );

  const voice = useJarvisVoice({
    accessToken,
    onTranscriptReady: async (transcript) => {
      await handleSubmitQuery(transcript, true);
    }
  });

  voiceRef.current = voice;

  // Scroll transcript smoothly when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length]);

  const handleResetSession = () => {
    voice.clearCachedAudio();
    voice.setVoiceState('idle');
    voice.setVoiceNotice(null);
    setErrorNotice(null);
    setMessages([]);
    setInputText('');
  };

  const handleRetryFailedQuery = () => {
    if (!errorNotice?.failedQuery || isSubmitting) return;
    void handleSubmitQuery(errorNotice.failedQuery, false, true);
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSubmitting) return;
    void handleSubmitQuery(inputText, false);
  };

  const stateHeadline = useMemo(() => {
    switch (voice.voiceState) {
      case 'listening':
        return 'Listening';
      case 'thinking':
        return 'Thinking';
      case 'speaking':
        return 'Speaking';
      default:
        return 'Ready';
    }
  }, [voice.voiceState]);

  const stateHint = useMemo(() => {
    if (voice.voiceState === 'listening') {
      return voice.liveTranscript
        ? voice.liveTranscript
        : voice.voiceLanguage === 'auto'
          ? 'Speak in English, Malayalam, or mixed — tap the orb when done.'
          : 'Listening for your question…';
    }
    if (voice.voiceState === 'thinking') {
      return 'Checking your XOS records…';
    }
    if (voice.voiceState === 'speaking') {
      return voice.isMuted ? 'Audio muted' : 'Speaking response — tap Stop or interrupt with mic';
    }
    return 'Tap the orb to speak naturally in English or Malayalam.';
  }, [voice.isMuted, voice.liveTranscript, voice.voiceLanguage, voice.voiceState]);

  const latestAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'model') return messages[i];
    }
    return null;
  }, [messages]);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/[0.06]">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
            AI Agent
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Personal voice assistant for your XOS finances, work, salary, savings, and goals.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-50 border border-black/[0.06] text-[11px] font-medium text-neutral-600">
            <ShieldCheck className="w-3.5 h-3.5 text-[#0284C7]" />
            <span>Read-only session</span>
          </div>

          <button
            type="button"
            onClick={voice.toggleMute}
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 text-xs font-medium text-neutral-700 hover:text-[#111111] bg-white hover:bg-neutral-50 border border-black/[0.08] rounded-xl transition-colors cursor-pointer whitespace-nowrap"
            aria-label={voice.isMuted ? 'Unmute voice output' : 'Mute voice output'}
          >
            {voice.isMuted ? (
              <>
                <VolumeX className="w-3.5 h-3.5 text-neutral-500" />
                <span>Muted</span>
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5 text-[#0284C7]" />
                <span>Voice On</span>
              </>
            )}
          </button>

          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleResetSession}
              disabled={isSubmitting}
              className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 text-xs font-medium text-neutral-700 hover:text-[#111111] bg-white hover:bg-neutral-50 border border-black/[0.08] rounded-xl transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              aria-label="Start new conversation session"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>New Session</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Split Workspace: Voice Stage + Transcript & Secondary Input */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Voice-First Stage */}
        <section
          aria-label="Voice Assistant Control"
          className="lg:col-span-5 rounded-2xl border border-black/[0.08] bg-white p-5 sm:p-6 flex flex-col items-center justify-between gap-5 shadow-xs min-h-[380px]"
        >
          {/* Voice Language Preference */}
          <div className="w-full flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Voice Mode
            </span>
            <div
              role="group"
              aria-label="Preferred speech recognition language"
              className="inline-flex items-center bg-neutral-100 p-0.5 rounded-xl border border-black/[0.05]"
            >
              {[
                { id: 'auto' as PreferredVoiceLanguage, label: 'Auto' },
                { id: 'en-IN' as PreferredVoiceLanguage, label: 'English' },
                { id: 'ml-IN' as PreferredVoiceLanguage, label: 'മലയാളം' }
              ].map((opt) => {
                const active = voice.voiceLanguage === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => voice.setVoiceLanguage(opt.id)}
                    disabled={voice.voiceState === 'listening' || isSubmitting}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60 ${
                      active
                        ? 'bg-white text-[#111111] shadow-xs font-semibold'
                        : 'text-neutral-600 hover:text-[#111111]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Interactive Orb & Live Status */}
          <div className="flex flex-col items-center text-center gap-3 my-auto">
            <VoiceOrb
              state={voice.voiceState}
              audioLevel={voice.audioLevel}
              onPress={voice.toggleMicrophone}
              disabled={isSubmitting && voice.voiceState === 'thinking'}
            />

            <div className="space-y-1 max-w-xs">
              <div className="text-sm font-bold text-[#111111] tracking-tight">
                {stateHeadline}
              </div>
              <p className="text-xs text-neutral-500 leading-relaxed min-h-[2.25rem]">
                {stateHint}
              </p>
            </div>
          </div>

          {/* Primary Voice Controls */}
          <div className="w-full space-y-2.5">
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={voice.toggleMicrophone}
                disabled={isSubmitting && voice.voiceState === 'thinking'}
                className={`flex-1 min-h-[48px] px-4 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB] ${
                  voice.voiceState === 'listening'
                    ? 'bg-[#0284C7] text-white hover:bg-[#0369A1]'
                    : 'bg-[#111111] text-white hover:bg-black'
                }`}
              >
                {voice.voiceState === 'listening' ? (
                  <>
                    <Square className="w-4 h-4 fill-current" />
                    <span>Stop Listening</span>
                  </>
                ) : voice.micPermission === 'denied' ? (
                  <>
                    <MicOff className="w-4 h-4 text-[#87CEEB]" />
                    <span>Retry Microphone</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4 text-[#87CEEB]" />
                    <span>Tap to Speak</span>
                  </>
                )}
              </button>

              {voice.voiceState === 'speaking' ? (
                <button
                  type="button"
                  onClick={voice.stopSpeaking}
                  className="min-h-[48px] px-4 rounded-xl border border-black/[0.1] bg-white hover:bg-neutral-50 text-xs font-semibold text-[#111111] flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              ) : (
                voice.canReplay &&
                latestAssistantMessage && (
                  <button
                    type="button"
                    onClick={() => void voice.replayLastResponse()}
                    className="min-h-[48px] px-4 rounded-xl border border-black/[0.1] bg-white hover:bg-neutral-50 text-xs font-semibold text-[#111111] flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                    aria-label="Replay last AI voice response"
                  >
                    <Play className="w-3.5 h-3.5 text-[#0284C7]" />
                    <span>Replay</span>
                  </button>
                )
              )}
            </div>

            {voice.voiceNotice && (
              <div
                role="status"
                className="p-2.5 rounded-xl bg-neutral-50 border border-black/[0.08] text-[11px] text-neutral-700 flex items-start gap-2"
              >
                <AlertCircle className="w-3.5 h-3.5 text-[#0284C7] shrink-0 mt-0.5" />
                <span>{voice.voiceNotice}</span>
              </div>
            )}
          </div>
        </section>

        {/* Secondary Transcript & Text Input Workspace */}
        <section
          aria-label="Conversation Transcript"
          className="lg:col-span-7 rounded-2xl border border-black/[0.08] bg-white flex flex-col justify-between shadow-xs min-h-[380px] lg:max-h-[600px]"
        >
          {/* Transcript Feed */}
          <div className="flex-1 p-5 sm:p-6 overflow-y-auto space-y-5">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col justify-center space-y-5 py-4">
                <div className="space-y-1.5">
                  <h3 className="text-sm font-bold text-[#111111]">
                    Ask anything about your workspace
                  </h3>
                  <p className="text-xs text-neutral-500 leading-relaxed max-w-lg">
                    Ask in English, Malayalam, or mixed phrasing. Responses stay grounded in your live XOS records and never modify your data.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {QUICK_PROMPTS.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void handleSubmitQuery(item.query, false)}
                      className="p-3 rounded-xl border border-black/[0.07] bg-neutral-50/70 hover:bg-neutral-100/80 hover:border-black/[0.15] text-left transition-colors cursor-pointer disabled:opacity-50 min-h-[48px]"
                    >
                      <span className="text-xs font-semibold text-[#111111] block">
                        {item.label}
                      </span>
                      <span className="text-[11px] text-neutral-500 block mt-0.5 truncate">
                        {item.query}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`pb-4 border-b border-black/[0.05] last:border-b-0 last:pb-0 ${
                      msg.role === 'user' ? 'pl-0' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span
                        className={`text-[11px] font-semibold uppercase tracking-wider ${
                          msg.role === 'model' ? 'text-[#0284C7]' : 'text-neutral-500'
                        }`}
                      >
                        {msg.role === 'model' ? 'XOS Agent' : 'You'}
                      </span>

                      <div className="flex items-center gap-2">
                        {msg.role === 'model' && (
                          <button
                            type="button"
                            onClick={() => {
                              if (voice.speakingMessageId === msg.id) {
                                voice.stopSpeaking();
                              } else {
                                void voice.speakResponse(
                                  msg.text,
                                  msg.id,
                                  msg.langHint || 'en',
                                  true
                                );
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-neutral-600 hover:text-[#111111] hover:bg-neutral-100 transition-colors cursor-pointer"
                            aria-label={
                              voice.speakingMessageId === msg.id
                                ? 'Stop playing message'
                                : 'Listen to response'
                            }
                          >
                            {voice.speakingMessageId === msg.id ? (
                              <>
                                <Square className="w-3 h-3 fill-current text-[#0284C7]" />
                                <span>Stop</span>
                              </>
                            ) : (
                              <>
                                <Volume2 className="w-3 h-3" />
                                <span>Listen</span>
                              </>
                            )}
                          </button>
                        )}
                        <span className="text-[11px] text-neutral-400 font-mono tabular-nums">
                          {msg.timestamp}
                        </span>
                      </div>
                    </div>

                    <p
                      className={`text-sm leading-relaxed whitespace-pre-line ${
                        msg.role === 'model' ? 'text-[#111111]' : 'text-neutral-700 font-medium'
                      }`}
                    >
                      {msg.text}
                    </p>
                  </div>
                ))}

                {isSubmitting && (
                  <div className="pt-1 text-xs text-neutral-500 font-medium">
                    Analyzing your workspace records…
                  </div>
                )}
                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>

          {/* Error Banner */}
          {errorNotice && (
            <div
              role="alert"
              className="mx-5 mb-3 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold text-rose-950">AI Service Error</div>
                    <p className="text-rose-800 leading-relaxed">{errorNotice.message}</p>
                    {(errorNotice.requestId || errorNotice.category || errorNotice.stage || typeof errorNotice.durationMs === 'number') && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pt-0.5 text-[11px] font-mono text-rose-700/90">
                        {errorNotice.requestId && <span>ID: {errorNotice.requestId}</span>}
                        {errorNotice.category && <span>Category: {errorNotice.category}</span>}
                        {errorNotice.stage && <span>Stage: {errorNotice.stage}</span>}
                        {typeof errorNotice.durationMs === 'number' && (
                          <span>Duration: {(errorNotice.durationMs / 1000).toFixed(1)}s</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {errorNotice.failedQuery && (
                  <button
                    type="button"
                    onClick={handleRetryFailedQuery}
                    disabled={isSubmitting}
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-rose-200 hover:bg-rose-100/70 text-[11px] font-semibold text-rose-900 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Retry</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Secondary Text Input Bar */}
          <form
            onSubmit={handleTextSubmit}
            className="p-3.5 sm:p-4 border-t border-black/[0.06] bg-neutral-50/50 rounded-b-2xl flex items-center gap-2"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Or type in English, Malayalam, or Manglish…"
              disabled={isSubmitting}
              aria-label="Type a question for XOS AI Agent"
              className="flex-1 min-h-[44px] px-3.5 py-2 text-sm text-[#111111] bg-white border border-black/[0.08] rounded-xl placeholder:text-neutral-400 focus-visible:outline-none focus-visible:border-[#111111] focus-visible:ring-2 focus-visible:ring-[#87CEEB]/50 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isSubmitting}
              className="min-h-[44px] min-w-[44px] px-4 rounded-xl bg-[#111111] hover:bg-black text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
              aria-label="Send message"
            >
              <Send className="w-4 h-4 text-[#87CEEB]" />
              <span className="hidden sm:inline">Ask</span>
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};
