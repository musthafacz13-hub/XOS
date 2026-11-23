import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Mic,
  RotateCcw,
  Square,
  Volume2,
  VolumeX
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { JarvisVoiceState, useJarvisVoice } from '../../hooks/useJarvisVoice';
import {
  agentService,
  AiServiceError,
  PreferredVoiceLanguage
} from '../../services/ai/agentService';
import {
  buildSelectiveXosContext,
  detectQueryIntent,
  SessionTurnMemory,
  XOSReadOnlySnapshot
} from '../../services/ai/contextBuilder';
import { XosModuleKey } from '../../services/ai/xosKnowledge';
import { repository } from '../../services/repository';
import { isSupabaseConfigured } from '../../services/supabase';
import { VoiceOrb } from './VoiceOrb';

interface AgentMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  modules?: XosModuleKey[];
  langHint?: 'ml' | 'en' | 'mixed';
}

interface AgentErrorState {
  message: string;
  requestId?: string;
  failedQuery?: string;
  retryable: boolean;
}

const QUICK_PROMPTS: Array<{ label: string; query: string }> = [
  {
    label: 'Monthly spending',
    query: 'How are my expenses this month compared to last month?'
  },
  {
    label: 'ഈ മാസം എന്റെ ചെലവുകൾ',
    query: 'ഈ മാസം എന്റെ ചെലവുകൾ എങ്ങനെയുണ്ട്?'
  },
  {
    label: 'Salary and attendance',
    query: 'Summarize my work attendance and earned salary for this month.'
  },
  {
    label: 'Debt and savings',
    query: 'What is my current debt balance and total savings progress?'
  }
];

const LANGUAGE_OPTIONS: Array<{ id: PreferredVoiceLanguage; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'en-IN', label: 'English' },
  { id: 'ml-IN', label: 'മലയാളം' }
];

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const AiAgentView: React.FC = () => {
  const { session, user } = useAuth();
  const accessToken = session?.access_token || null;

  // Strictly active-session in-memory conversation state (zero browser persistence)
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [errorNotice, setErrorNotice] = useState<AgentErrorState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const messagesRef = useRef<AgentMessage[]>([]);
  const isSubmittingRef = useRef(false);
  const mountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceRef = useRef<ReturnType<typeof useJarvisVoice> | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const syncTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  useEffect(() => {
    syncTextareaHeight();
  }, [inputText, syncTextareaHeight]);

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

      const lastTurnWithModules = [...recentHistory]
        .reverse()
        .find(t => t.role === 'user' && Array.isArray(t.modules) && t.modules.length > 0);
      const preliminaryIntent = detectQueryIntent(cleanQuery, lastTurnWithModules?.modules || []);

      if (!isRetry && !alreadyAppendedSamePendingTurn) {
        const userMessage: AgentMessage = {
          id: createMessageId(),
          role: 'user',
          text: cleanQuery,
          modules: preliminaryIntent.modules,
          langHint: preliminaryIntent.detectedLanguage
        };
        setMessages(prev => [...prev, userMessage]);
      }

      if (!viaVoice) {
        setInputText('');
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        // Ensure authenticated Supabase records are hydrated before building grounded AI context
        const hydrationBefore = repository.getHydrationState();
        const needsHydration =
          isSupabaseConfigured &&
          Boolean(user?.id) &&
          (!hydrationBefore.hasHydrated ||
            hydrationBefore.hydratedUserId !== user?.id ||
            repository.getFetchErrors().length > 0);

        if (needsHydration && user?.id) {
          try {
            await repository.fetchAllUserData(user.id);
          } catch {
            // Non-fatal: proceed with current repository state and report fetchErrorTables cleanly
          }
          if (!mountedRef.current || controller.signal.aborted) {
            voiceRef.current?.setVoiceState('idle');
            return;
          }
        }

        // Read fresh read-only snapshot directly from repository (never stale React closure state)
        const freshSnapshot: XOSReadOnlySnapshot = {
          settings: repository.getSettings(),
          goals: repository.getGoals(),
          expenses: repository.getExpenses(),
          incomes: repository.getIncomes(),
          attendance: repository.getAttendance(),
          savingsGoals: repository.getSavingsGoals(),
          savingsTransactions: repository.getSavingsTransactions(),
          salaryPayouts: repository.getSalaryPayouts(),
          debts: repository.getDebts(),
          debtRepayments: repository.getDebtRepayments()
        };
        const hydrationAfter = repository.getHydrationState();
        const fetchErrorTables = repository.getFetchErrors().map(err => err.table);

        const selective = buildSelectiveXosContext({
          query: cleanQuery,
          data: freshSnapshot,
          recentTurns: recentHistory,
          dataAvailability: {
            isHydrated: hydrationAfter.hasHydrated,
            isHydrating: hydrationAfter.isHydrating,
            fetchErrorTables
          }
        });

        const result = await agentService.sendMessage({
          message: cleanQuery,
          history: recentHistory,
          groundedContext: selective.groundedContext,
          preferredLanguage: voiceRef.current?.voiceLanguage || 'auto',
          accessToken,
          signal: controller.signal
        });

        if (!mountedRef.current) return;

        const assistantMsgId = createMessageId();
        const assistantMessage: AgentMessage = {
          id: assistantMsgId,
          role: 'model',
          text: result.reply,
          modules: selective.selectedModules,
          langHint: result.detectedLanguage
        };

        setMessages(prev => [...prev, assistantMessage]);
        await voiceRef.current?.speakResponse(
          result.reply,
          assistantMsgId,
          result.detectedLanguage
        );
      } catch (err) {
        if (!mountedRef.current) return;
        if (err instanceof AiServiceError) {
          if (err.code === 'cancelled') {
            voiceRef.current?.setVoiceState('idle');
            return;
          }
          setErrorNotice({
            message: err.message,
            requestId: err.requestId,
            failedQuery: cleanQuery,
            retryable: err.retryable
          });
        } else {
          setErrorNotice({
            message: 'Could not reach the AI service. Please try again.',
            failedQuery: cleanQuery,
            retryable: true
          });
        }
        voiceRef.current?.setVoiceState('error');
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        isSubmittingRef.current = false;
        if (mountedRef.current) {
          setIsSubmitting(false);
        }
      }
    },
    [accessToken, user?.id]
  );

  const voice = useJarvisVoice({
    accessToken,
    onTranscriptReady: async (transcript) => {
      await handleSubmitQuery(transcript, true);
    }
  });

  voiceRef.current = voice;

  useEffect(() => {
    if (messages.length > 0) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length, isSubmitting]);

  const handleResetSession = () => {
    abortControllerRef.current?.abort();
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

  const submitTextMessage = () => {
    const trimmed = inputText.trim();
    if (!trimmed || isSubmitting) return;
    void handleSubmitQuery(trimmed, false);
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitTextMessage();
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitTextMessage();
    }
  };

  const effectiveVoiceState: JarvisVoiceState = useMemo(() => {
    if (errorNotice && voice.voiceState === 'idle') return 'error';
    return voice.voiceState;
  }, [errorNotice, voice.voiceState]);

  const statusText = useMemo(() => {
    switch (effectiveVoiceState) {
      case 'listening':
        return voice.liveTranscript || 'Listening…';
      case 'thinking':
        return 'Processing…';
      case 'speaking':
        return voice.isMuted ? 'Muted' : 'Speaking…';
      case 'error':
        return 'Tap to try again';
      default:
        return 'Tap to speak';
    }
  }, [effectiveVoiceState, voice.isMuted, voice.liveTranscript]);

  const latestAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'model') return messages[i];
    }
    return null;
  }, [messages]);

  const activeErrorMessage = errorNotice?.message || voice.voiceNotice || null;
  const activeErrorRefId = errorNotice?.requestId;

  return (
    <div className="max-w-2xl mx-auto flex flex-col min-h-[calc(100dvh-13.75rem)] sm:min-h-[calc(100dvh-15rem)] md:min-h-[calc(100dvh-10rem)]">
      {/* Compact Utility Bar (Read-only indicator, Language selector, Audio & Reset) */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-black/[0.06]">
        <span className="text-xs text-neutral-400 whitespace-nowrap">
          Read-only
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          <div
            role="group"
            aria-label="Voice language"
            className="inline-flex items-center bg-neutral-100 p-0.5 rounded-lg"
          >
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = voice.voiceLanguage === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => voice.setVoiceLanguage(opt.id)}
                  disabled={voice.voiceState === 'listening' || isSubmitting}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap min-h-[30px] disabled:opacity-60 ${
                    active
                      ? 'bg-white text-[#111111] shadow-2xs'
                      : 'text-neutral-500 hover:text-[#111111]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={voice.toggleMute}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-neutral-500 hover:text-[#111111] hover:bg-neutral-100 transition-colors cursor-pointer"
            aria-label={voice.isMuted ? 'Unmute voice output' : 'Mute voice output'}
            title={voice.isMuted ? 'Voice muted' : 'Voice enabled'}
          >
            {voice.isMuted ? (
              <VolumeX className="w-4 h-4 text-neutral-400" />
            ) : (
              <Volume2 className="w-4 h-4 text-[#0284C7]" />
            )}
          </button>

          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleResetSession}
              disabled={isSubmitting}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-neutral-500 hover:text-[#111111] hover:bg-neutral-100 transition-colors cursor-pointer disabled:opacity-40"
              aria-label="New conversation"
              title="New conversation"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area: Centered Minimal Voice Stage (empty) OR Active Strip + Messaging Feed */}
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-6 sm:py-10 gap-5 text-center">
          <VoiceOrb
            state={effectiveVoiceState}
            audioLevel={voice.audioLevel}
            onPress={voice.toggleMicrophone}
            disabled={isSubmitting && voice.voiceState === 'thinking'}
            size="md"
          />

          <div className="space-y-1.5 max-w-sm px-2">
            <p
              className={`text-sm font-medium transition-colors ${
                effectiveVoiceState === 'listening' || effectiveVoiceState === 'speaking'
                  ? 'text-[#0284C7]'
                  : effectiveVoiceState === 'error'
                    ? 'text-rose-600'
                    : 'text-[#111111]'
              }`}
            >
              {statusText}
            </p>

            {effectiveVoiceState === 'speaking' && (
              <button
                type="button"
                onClick={voice.stopSpeaking}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#0284C7] hover:text-[#0369A1] cursor-pointer py-1"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop</span>
              </button>
            )}
          </div>

          {/* Compact Suggestion Chips (only when conversation is empty) */}
          <div className="flex flex-wrap items-center justify-center gap-2 max-w-md pt-1">
            {QUICK_PROMPTS.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleSubmitQuery(item.query, false)}
                className="px-3.5 py-2 rounded-full border border-black/[0.08] bg-white hover:border-[#0284C7]/50 hover:text-[#0284C7] text-xs font-medium text-neutral-700 transition-colors cursor-pointer disabled:opacity-50 min-h-[38px]"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Compact Voice Control Strip during active conversation */}
          <div className="sticky top-[calc(4rem+env(safe-area-inset-top,0px))] md:top-16 z-10 bg-white/95 backdrop-blur-xs border-b border-black/[0.05] py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <VoiceOrb
                state={effectiveVoiceState}
                audioLevel={voice.audioLevel}
                onPress={voice.toggleMicrophone}
                disabled={isSubmitting && voice.voiceState === 'thinking'}
                size="sm"
              />
              <span
                className={`text-xs font-medium truncate ${
                  effectiveVoiceState === 'listening' || effectiveVoiceState === 'speaking'
                    ? 'text-[#0284C7]'
                    : effectiveVoiceState === 'error'
                      ? 'text-rose-600'
                      : 'text-neutral-600'
                }`}
              >
                {statusText}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {effectiveVoiceState === 'speaking' && (
                <button
                  type="button"
                  onClick={voice.stopSpeaking}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#0284C7] hover:bg-sky-50 cursor-pointer min-h-[34px]"
                >
                  Stop
                </button>
              )}
              {effectiveVoiceState === 'listening' && (
                <button
                  type="button"
                  onClick={voice.stopListening}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#0284C7] hover:bg-sky-50 cursor-pointer min-h-[34px]"
                >
                  Done
                </button>
              )}
              {effectiveVoiceState !== 'speaking' &&
                effectiveVoiceState !== 'listening' &&
                voice.canReplay &&
                latestAssistantMessage && (
                  <button
                    type="button"
                    onClick={() => void voice.replayLastResponse()}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-neutral-500 hover:text-[#0284C7] hover:bg-neutral-50 cursor-pointer min-h-[34px]"
                  >
                    Replay
                  </button>
                )}
            </div>
          </div>

          {/* Clean Messaging Feed */}
          <div className="flex-1 py-4 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                {msg.role === 'user' ? (
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-neutral-100 px-4 py-2.5 text-[15px] text-[#111111] leading-relaxed whitespace-pre-line break-words">
                    {msg.text}
                  </div>
                ) : (
                  <div className="max-w-[94%] space-y-1">
                    <p className="text-[15px] text-[#111111] leading-relaxed whitespace-pre-line break-words">
                      {msg.text}
                    </p>
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
                      className="inline-flex items-center gap-1 py-1 text-xs font-medium text-neutral-400 hover:text-[#0284C7] transition-colors cursor-pointer min-h-[32px]"
                      aria-label={
                        voice.speakingMessageId === msg.id
                          ? 'Stop audio playback'
                          : 'Listen to response'
                      }
                    >
                      {voice.speakingMessageId === msg.id ? (
                        <>
                          <Square className="w-3 h-3 fill-current text-[#0284C7]" />
                          <span className="text-[#0284C7]">Stop</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-3.5 h-3.5" />
                          <span>Listen</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            ))}

            {isSubmitting && (
              <div className="text-sm text-neutral-400 py-1">
                Thinking…
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        </>
      )}

      {/* Concise Inline Error Notice */}
      {activeErrorMessage && (
        <div
          role={errorNotice ? 'alert' : 'status'}
          data-request-id={activeErrorRefId || undefined}
          className="mb-2.5 px-3.5 py-2.5 rounded-xl border border-rose-200/80 bg-rose-50/40 flex items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <p className="text-xs text-rose-800 leading-snug">
              {activeErrorMessage}
            </p>
            {activeErrorRefId && (
              <p className="text-[10px] text-neutral-400 mt-0.5 select-all truncate">
                Ref · {activeErrorRefId}
              </p>
            )}
          </div>

          {errorNotice?.retryable && errorNotice.failedQuery && (
            <button
              type="button"
              onClick={handleRetryFailedQuery}
              disabled={isSubmitting}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0284C7] hover:bg-sky-50 transition-colors cursor-pointer disabled:opacity-50 min-h-[34px]"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Minimal Expanding Chat Input (Docked cleanly above MobileBottomNav) */}
      <form
        onSubmit={handleTextSubmit}
        className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] md:bottom-0 z-10 bg-white/95 backdrop-blur-xs pt-2 pb-1"
      >
        <div className="flex items-end gap-1.5 border border-black/[0.12] focus-within:border-[#0284C7] rounded-2xl bg-white pl-3.5 pr-1.5 py-1.5 transition-colors">
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            onFocus={() => {
              requestAnimationFrame(() => {
                textareaRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              });
            }}
            placeholder="Message XOS…"
            disabled={isSubmitting}
            aria-label="Message XOS AI Agent"
            className="flex-1 resize-none bg-transparent py-2 text-[16px] sm:text-sm text-[#111111] placeholder:text-neutral-400 focus:outline-none max-h-[120px] leading-snug disabled:opacity-60"
          />

          <button
            type="button"
            onClick={voice.toggleMicrophone}
            disabled={isSubmitting && voice.voiceState === 'thinking'}
            aria-label={voice.voiceState === 'listening' ? 'Stop microphone' : 'Speak a message'}
            className={`min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-40 ${
              voice.voiceState === 'listening'
                ? 'bg-[#0284C7] text-white'
                : 'text-neutral-500 hover:text-[#0284C7] hover:bg-neutral-50'
            }`}
          >
            {voice.voiceState === 'listening' ? (
              <Square className="w-4 h-4 fill-current" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>

          <button
            type="submit"
            disabled={!inputText.trim() || isSubmitting}
            aria-label="Send message"
            className="min-h-[40px] min-w-[40px] rounded-xl bg-[#0284C7] hover:bg-[#0369A1] text-white flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:bg-neutral-100 disabled:text-neutral-400 disabled:cursor-not-allowed"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
};
