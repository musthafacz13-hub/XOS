import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { JarvisVoiceState, useJarvisVoice } from '../../hooks/useJarvisVoice';
import {
  agentService,
  AiServiceError,
  PreferredVoiceLanguage
} from '../../services/ai/agentService';
import {
  buildEntryCatalog,
  buildSelectiveXosContext,
  detectQueryIntent,
  SessionTurnMemory,
  XOSReadOnlySnapshot
} from '../../services/ai/contextBuilder';
import {
  executeConfirmedTransaction,
  resetTransactionExecutorState
} from '../../services/ai/transactionExecutor';
import {
  buildConfirmationQuestion,
  createIdempotencyKey,
  createProposalId,
  DisambiguationOption,
  EntryCatalog,
  formatRupeesSimple,
  matchPendingConfirmationVoiceCommand,
  PENDING_TRANSACTION_TTL_MS,
  PendingTransactionProposal,
  ValidatedTransactionProposal,
  ValidatedTransactionProposalSchema
} from '../../services/ai/transactionSchemas';
import { formatRecordingDuration } from '../../services/ai/voiceUtils';
import { XosModuleKey } from '../../services/ai/xosKnowledge';
import { repository } from '../../services/repository';
import { isSupabaseConfigured } from '../../services/supabase';
import { TransactionPreviewCard } from './TransactionPreviewCard';
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
  { id: 'ml-IN', label: 'മലയാളം' },
  { id: 'en-IN', label: 'English' },
  { id: 'auto', label: 'Auto' }
];

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readCurrentSnapshot(): XOSReadOnlySnapshot {
  return {
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
}

export const AiAgentView: React.FC = () => {
  const { session, user } = useAuth();
  const accessToken = session?.access_token || null;

  // Strictly active-session in-memory conversation & proposal state (zero browser persistence)
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [errorNotice, setErrorNotice] = useState<AgentErrorState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [pendingProposal, setPendingProposal] = useState<PendingTransactionProposal | null>(null);
  const [entryCatalog, setEntryCatalog] = useState<EntryCatalog | null>(null);
  const [isEditingProposal, setIsEditingProposal] = useState(false);
  const [proposalEditError, setProposalEditError] = useState<string | null>(null);
  const [isSavingTransaction, setIsSavingTransaction] = useState(false);
  const [clarificationOptions, setClarificationOptions] = useState<{
    messageId: string;
    options: DisambiguationOption[];
    detectedLanguage: 'ml' | 'en' | 'mixed';
  } | null>(null);

  const messagesRef = useRef<AgentMessage[]>([]);
  const pendingProposalRef = useRef<PendingTransactionProposal | null>(null);
  const isSubmittingRef = useRef(false);
  const isSavingTransactionRef = useRef(false);
  const mountedRef = useRef(true);
  const lastUserIdRef = useRef<string | undefined>(user?.id);
  const abortControllerRef = useRef<AbortController | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceRef = useRef<ReturnType<typeof useJarvisVoice> | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    pendingProposalRef.current = pendingProposal;
  }, [pendingProposal]);

  useEffect(() => {
    if (lastUserIdRef.current !== user?.id) {
      lastUserIdRef.current = user?.id;
      setPendingProposal(null);
      setIsEditingProposal(false);
      setProposalEditError(null);
      setClarificationOptions(null);
      resetTransactionExecutorState();
    }
  }, [user?.id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  // Automatically expire unconfirmed pending transaction previews after 2 minutes
  useEffect(() => {
    if (!pendingProposal) return;
    const targetProposalId = pendingProposal.proposalId;
    const targetLang = pendingProposal.detectedLanguage;
    const remainingMs = pendingProposal.expiresAtMs - Date.now();

    const expireNow = () => {
      if (!mountedRef.current || isSavingTransactionRef.current) return;
      if (pendingProposalRef.current?.proposalId !== targetProposalId) return;
      setPendingProposal(null);
      setIsEditingProposal(false);
      setProposalEditError(null);
      const isMl = targetLang === 'ml' || targetLang === 'mixed';
      const expiredText = isMl
        ? 'ഈ ഇടപാട് പ്രിവ്യൂ 2 മിനിറ്റ് കഴിഞ്ഞ് കാലഹരണപ്പെട്ടു (സേവ് ചെയ്തിട്ടില്ല). വേണമെങ്കിൽ വീണ്ടും പറയൂ.'
        : 'This transaction preview expired after 2 minutes without confirmation and was not saved.';
      setMessages(prev => [
        ...prev,
        {
          id: createMessageId(),
          role: 'model',
          text: expiredText,
          langHint: targetLang
        }
      ]);
    };

    if (remainingMs <= 0) {
      expireNow();
      return;
    }

    const timer = setTimeout(expireNow, remainingMs);
    return () => clearTimeout(timer);
  }, [pendingProposal]);

  const syncTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  useEffect(() => {
    syncTextareaHeight();
  }, [inputText, syncTextareaHeight]);

  const handleConfirmPendingTransaction = useCallback(
    async (source: 'button' | 'voice') => {
      const activeProposal = pendingProposalRef.current;
      if (!activeProposal || isSavingTransactionRef.current) return;

      voiceRef.current?.unlockAudioFromUserGesture();
      setErrorNotice(null);

      if (Date.now() > activeProposal.expiresAtMs) {
        setPendingProposal(null);
        setIsEditingProposal(false);
        setProposalEditError(null);
        setErrorNotice({
          message: 'This transaction preview has expired. Please speak or type it again to review before saving.',
          retryable: false
        });
        return;
      }

      if (isSupabaseConfigured && (!user?.id || !accessToken)) {
        setErrorNotice({
          message: 'Your session has expired. Please sign in again.',
          retryable: false
        });
        return;
      }

      isSavingTransactionRef.current = true;
      setIsSavingTransaction(true);

      try {
        const result = await executeConfirmedTransaction({
          proposal: activeProposal,
          confirmedByUser: true,
          confirmationSource: source
        });
        if (!mountedRef.current) return;

        setPendingProposal(null);
        setIsEditingProposal(false);
        setProposalEditError(null);
        setClarificationOptions(null);
        setEntryCatalog(buildEntryCatalog(readCurrentSnapshot()));

        const confirmMsgId = createMessageId();
        setMessages(prev => [
          ...prev,
          {
            id: confirmMsgId,
            role: 'model',
            text: result.confirmationMessage,
            langHint: activeProposal.detectedLanguage
          }
        ]);

        voiceRef.current?.setVoiceState('idle');
        await voiceRef.current?.speakResponse(
          result.confirmationMessage,
          confirmMsgId,
          activeProposal.detectedLanguage
        );
      } catch (err) {
        if (!mountedRef.current) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Could not save transaction. Please try again.';
        if (/expired/i.test(message)) {
          setPendingProposal(null);
          setIsEditingProposal(false);
        }
        setErrorNotice({
          message,
          retryable: false
        });
      } finally {
        isSavingTransactionRef.current = false;
        if (mountedRef.current) {
          setIsSavingTransaction(false);
        }
      }
    },
    [accessToken, user?.id]
  );

  const handleCancelPendingTransaction = useCallback((_source: 'button' | 'voice') => {
    const activeProposal = pendingProposalRef.current;
    if (!activeProposal || isSavingTransactionRef.current) return;
    const lang = activeProposal.detectedLanguage;
    setPendingProposal(null);
    setIsEditingProposal(false);
    setProposalEditError(null);
    setErrorNotice(null);

    const isMl = lang === 'ml' || lang === 'mixed';
    const cancelText = isMl
      ? 'ശരി, ഈ ഇടപാട് സേവ് ചെയ്യാതെ റദ്ദാക്കി.'
      : 'Cancelled — no transaction was saved.';

    setMessages(prev => [
      ...prev,
      {
        id: createMessageId(),
        role: 'model',
        text: cancelText,
        langHint: lang
      }
    ]);
  }, []);

  const handleApplyEditProposal = useCallback(
    (updatedTx: ValidatedTransactionProposal) => {
      const current = pendingProposalRef.current;
      if (!current) return;
      const nowMs = Date.now();
      const proposalId = createProposalId();
      const idempotencyKey = createIdempotencyKey(proposalId, updatedTx);
      const currency = entryCatalog?.currency || repository.getSettings().currency || 'INR';

      setPendingProposal({
        ...current,
        proposalId,
        idempotencyKey,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + PENDING_TRANSACTION_TTL_MS,
        summaryReply: buildConfirmationQuestion(updatedTx, current.detectedLanguage, currency),
        transaction: updatedTx
      });
      setIsEditingProposal(false);
      setProposalEditError(null);
    },
    [entryCatalog?.currency]
  );

  const handleSelectDisambiguationOption = useCallback(
    (option: DisambiguationOption) => {
      if (isSavingTransactionRef.current || isSubmittingRef.current) return;
      const catalog = entryCatalog || buildEntryCatalog(readCurrentSnapshot());
      const lang = clarificationOptions?.detectedLanguage || 'en';
      const nowMs = Date.now();

      let candidateTx: ValidatedTransactionProposal | null = null;
      if (option.kind === 'debt') {
        if (option.proposedAmount > option.remainingAmount + 0.001) {
          setErrorNotice({
            message: `Repayment of ${formatRupeesSimple(option.proposedAmount, catalog.currency)} exceeds ${option.personName}'s remaining debt (${formatRupeesSimple(option.remainingAmount, catalog.currency)}).`,
            retryable: false
          });
          return;
        }
        const remainingAfter = Math.max(
          0,
          Number((option.remainingAmount - option.proposedAmount).toFixed(2))
        );
        candidateTx = {
          intent: 'record_debt_repayment',
          debtId: option.id,
          personName: option.personName,
          direction: option.direction,
          amount: option.proposedAmount,
          remainingBefore: option.remainingAmount,
          remainingAfter,
          date: option.proposedDate,
          paymentMethod: option.paymentMethod,
          ...(option.notes ? { notes: option.notes } : {})
        };
      } else {
        if (
          option.transactionType === 'withdrawal' &&
          option.proposedAmount > option.currentAmount + 0.001
        ) {
          setErrorNotice({
            message: `Withdrawal exceeds ${option.name}'s current balance (${formatRupeesSimple(option.currentAmount, catalog.currency)}).`,
            retryable: false
          });
          return;
        }
        const balanceAfter =
          option.transactionType === 'deposit'
            ? Number((option.currentAmount + option.proposedAmount).toFixed(2))
            : Math.max(0, Number((option.currentAmount - option.proposedAmount).toFixed(2)));
        candidateTx = {
          intent: 'create_savings_transaction',
          savingsGoalId: option.id,
          savingsGoalName: option.name,
          transactionType: option.transactionType,
          amount: option.proposedAmount,
          currentBalanceBefore: option.currentAmount,
          balanceAfter,
          date: option.proposedDate,
          ...(option.note ? { note: option.note } : {})
        };
      }

      const validated = ValidatedTransactionProposalSchema.safeParse(candidateTx);
      if (!validated.success) {
        setErrorNotice({
          message: validated.error.issues[0]?.message || 'Could not prepare this transaction.',
          retryable: false
        });
        return;
      }

      const proposalId = createProposalId();
      const idempotencyKey = createIdempotencyKey(proposalId, validated.data);
      const summaryReply = buildConfirmationQuestion(validated.data, lang, catalog.currency);

      setClarificationOptions(null);
      setIsEditingProposal(false);
      setProposalEditError(null);
      setErrorNotice(null);
      setPendingProposal({
        proposalId,
        idempotencyKey,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + PENDING_TRANSACTION_TTL_MS,
        confidence: 1,
        summaryReply,
        detectedLanguage: lang,
        transaction: validated.data
      });
      setMessages(prev => [
        ...prev,
        {
          id: createMessageId(),
          role: 'model',
          text: summaryReply,
          langHint: lang
        }
      ]);
    },
    [clarificationOptions?.detectedLanguage, entryCatalog]
  );

  const handleSubmitQuery = useCallback(
    async (rawQuery: string, isRetry: boolean = false) => {
      const cleanQuery = rawQuery.trim();
      if (!cleanQuery || isSubmittingRef.current || isSavingTransactionRef.current) return;

      // If an active non-expired proposal awaits confirmation, inspect typed/spoken confirmation or cancel first
      if (!isRetry && pendingProposalRef.current) {
        const activeProp = pendingProposalRef.current;
        const voiceCmd = matchPendingConfirmationVoiceCommand(cleanQuery);
        if (voiceCmd === 'confirm' && Date.now() <= activeProp.expiresAtMs) {
          setInputText('');
          setMessages(prev => [
            ...prev,
            {
              id: createMessageId(),
              role: 'user',
              text: cleanQuery,
              langHint: activeProp.detectedLanguage
            }
          ]);
          void handleConfirmPendingTransaction('voice');
          return;
        }
        if (voiceCmd === 'cancel') {
          setInputText('');
          setMessages(prev => [
            ...prev,
            {
              id: createMessageId(),
              role: 'user',
              text: cleanQuery,
              langHint: activeProp.detectedLanguage
            }
          ]);
          handleCancelPendingTransaction('voice');
          return;
        }
        // Any unrelated new message invalidates the old unconfirmed proposal
        setPendingProposal(null);
        setIsEditingProposal(false);
        setProposalEditError(null);
      }

      setClarificationOptions(null);

      // Prime audio element & AudioContext synchronously while user gesture is active
      voiceRef.current?.unlockAudioFromUserGesture();
      voiceRef.current?.clearVoiceReview();

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setErrorNotice(null);
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

      setInputText('');

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
        const freshSnapshot = readCurrentSnapshot();
        const hydrationAfter = repository.getHydrationState();
        const fetchErrorTables = repository.getFetchErrors().map(err => err.table);
        const catalog = buildEntryCatalog(freshSnapshot);
        setEntryCatalog(catalog);

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
          entryCatalog: catalog,
          preferredLanguage: voiceRef.current?.voiceLanguage || 'ml-IN',
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

        if (result.actionType === 'transaction_proposal' && result.pendingTransaction) {
          setPendingProposal(result.pendingTransaction);
          setIsEditingProposal(false);
          setProposalEditError(null);
          setClarificationOptions(null);
        } else if (
          result.actionType === 'clarification_needed' &&
          result.clarification?.disambiguationOptions &&
          result.clarification.disambiguationOptions.length > 0
        ) {
          setPendingProposal(null);
          setClarificationOptions({
            messageId: assistantMsgId,
            options: result.clarification.disambiguationOptions,
            detectedLanguage: result.detectedLanguage
          });
        } else {
          setPendingProposal(null);
          setClarificationOptions(null);
        }

        voiceRef.current?.setVoiceState('idle');
        await voiceRef.current?.speakResponse(
          result.reply,
          assistantMsgId,
          result.detectedLanguage
        );
      } catch (err) {
        if (!mountedRef.current) return;
        voiceRef.current?.setVoiceState('idle');
        if (err instanceof AiServiceError) {
          if (err.code === 'cancelled') {
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
    [accessToken, handleCancelPendingTransaction, handleConfirmPendingTransaction, user?.id]
  );

  // Voice confirmation/cancellation triggers ONLY when an active non-expired preview exists;
  // all other transcripts go safely to the editable review composer.
  const voice = useJarvisVoice({
    accessToken,
    onTranscriptReady: (transcript) => {
      const activeProp = pendingProposalRef.current;
      if (
        activeProp &&
        Date.now() <= activeProp.expiresAtMs &&
        !isSavingTransactionRef.current
      ) {
        const cmd = matchPendingConfirmationVoiceCommand(transcript);
        if (cmd === 'confirm') {
          voiceRef.current?.clearVoiceReview();
          setInputText('');
          setMessages(prev => [
            ...prev,
            {
              id: createMessageId(),
              role: 'user',
              text: transcript,
              langHint: activeProp.detectedLanguage
            }
          ]);
          void handleConfirmPendingTransaction('voice');
          return;
        }
        if (cmd === 'cancel') {
          voiceRef.current?.clearVoiceReview();
          setInputText('');
          setMessages(prev => [
            ...prev,
            {
              id: createMessageId(),
              role: 'user',
              text: transcript,
              langHint: activeProp.detectedLanguage
            }
          ]);
          handleCancelPendingTransaction('voice');
          return;
        }
      }

      setInputText(transcript);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  });

  voiceRef.current = voice;

  useEffect(() => {
    if (messages.length > 0 || pendingProposal) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length, isSubmitting, pendingProposal]);

  const handleResetSession = () => {
    abortControllerRef.current?.abort();
    voice.cancelRecording();
    voice.clearCachedAudio();
    voice.setVoiceState('idle');
    setErrorNotice(null);
    setPendingProposal(null);
    setIsEditingProposal(false);
    setProposalEditError(null);
    setClarificationOptions(null);
    resetTransactionExecutorState();
    setMessages([]);
    setInputText('');
  };

  const handleRetryFailedQuery = () => {
    if (!errorNotice?.failedQuery || isSubmitting) return;
    void handleSubmitQuery(errorNotice.failedQuery, true);
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

  const isRecordingOrListening =
    voice.inputPhase === 'listening' || voice.inputPhase === 'recording';
  const isTranscribing = voice.inputPhase === 'processing';

  const effectiveVoiceState: JarvisVoiceState = useMemo(() => {
    if (errorNotice && voice.voiceState === 'idle') return 'error';
    return voice.voiceState;
  }, [errorNotice, voice.voiceState]);

  const statusText = useMemo(() => {
    if (voice.inputPhase === 'listening') return 'Starting mic…';
    if (voice.inputPhase === 'recording') {
      return voice.liveTranscript
        ? voice.liveTranscript
        : `Recording ${formatRecordingDuration(voice.recordingDurationMs)}`;
    }
    if (voice.inputPhase === 'processing') return 'Transcribing…';
    if (voice.inputPhase === 'completed') return 'Review transcript & Send';
    if (voice.inputPhase === 'failed') return 'Tap to try again';
    if (isSubmitting || voice.playbackPhase === 'generating') return 'Preparing audio…';
    if (voice.playbackPhase === 'playing') return voice.isMuted ? 'Muted' : 'Playing response';
    if (voice.playbackPhase === 'paused') return 'Audio paused';
    if (voice.playbackPhase === 'blocked') return 'Tap Play to hear Jarvis';
    if (errorNotice) return 'Tap to try again';
    return 'Tap to speak';
  }, [
    errorNotice,
    isSubmitting,
    voice.inputPhase,
    voice.isMuted,
    voice.liveTranscript,
    voice.playbackPhase,
    voice.recordingDurationMs
  ]);

  const latestAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'model') return messages[i];
    }
    return null;
  }, [messages]);

  const activeBannerMessage =
    errorNotice?.message ||
    voice.voiceError ||
    voice.playbackError ||
    voice.playbackNotice ||
    null;
  const activeErrorRefId = errorNotice?.requestId;

  return (
    <div className="max-w-2xl mx-auto flex flex-col min-h-[calc(100dvh-13.75rem)] sm:min-h-[calc(100dvh-15rem)] md:min-h-[calc(100dvh-10rem)]">
      {/* Compact Utility Bar (Read-only until confirmed indicator, Language selector, Audio & Reset) */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-black/[0.06]">
        <span className="text-xs text-neutral-400 whitespace-nowrap">
          Read-only until confirmed
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
                  disabled={isRecordingOrListening || isTranscribing || isSubmitting}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap min-h-[32px] disabled:opacity-60 ${
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
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-neutral-500 hover:text-[#111111] hover:bg-neutral-100 transition-colors cursor-pointer"
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
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-neutral-500 hover:text-[#111111] hover:bg-neutral-100 transition-colors cursor-pointer disabled:opacity-40"
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
            disabled={(isSubmitting || isTranscribing) && voice.voiceState === 'thinking'}
            size="md"
          />

          <div className="space-y-2 max-w-sm px-2">
            <p
              className={`text-sm font-medium tabular-nums transition-colors ${
                isRecordingOrListening || voice.playbackPhase === 'playing'
                  ? 'text-[#0284C7]'
                  : effectiveVoiceState === 'error'
                    ? 'text-rose-600'
                    : 'text-[#111111]'
              }`}
            >
              {statusText}
            </p>

            {(isRecordingOrListening || isTranscribing) && (
              <div className="flex items-center justify-center gap-2">
                {isRecordingOrListening && (
                  <button
                    type="button"
                    onClick={voice.stopListening}
                    className="px-3 py-1.5 rounded-lg bg-[#0284C7] text-white text-xs font-medium hover:bg-[#0369A1] cursor-pointer min-h-[36px]"
                  >
                    Stop & Transcribe
                  </button>
                )}
                <button
                  type="button"
                  onClick={voice.cancelRecording}
                  className="px-3 py-1.5 rounded-lg border border-black/[0.08] text-xs font-medium text-neutral-600 hover:text-[#111111] cursor-pointer min-h-[36px]"
                >
                  Cancel
                </button>
              </div>
            )}

            {voice.playbackPhase === 'playing' && (
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={voice.pausePlayback}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#0284C7] hover:bg-sky-50 cursor-pointer min-h-[36px]"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </button>
                <button
                  type="button"
                  onClick={voice.stopSpeaking}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-neutral-600 hover:bg-neutral-100 cursor-pointer min-h-[36px]"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Stop</span>
                </button>
              </div>
            )}
          </div>

          {/* Compact Suggestion Chips (only when conversation is empty) */}
          <div className="flex flex-wrap items-center justify-center gap-2 max-w-md pt-1">
            {QUICK_PROMPTS.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={isSubmitting || isRecordingOrListening || isTranscribing}
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
                disabled={(isSubmitting || isTranscribing) && voice.voiceState === 'thinking'}
                size="sm"
              />
              <span
                className={`text-xs font-medium truncate tabular-nums ${
                  isRecordingOrListening || voice.playbackPhase === 'playing'
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
              {isRecordingOrListening && (
                <>
                  <button
                    type="button"
                    onClick={voice.stopListening}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#0284C7] hover:bg-sky-50 cursor-pointer min-h-[36px]"
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    onClick={voice.cancelRecording}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-neutral-500 hover:bg-neutral-100 cursor-pointer min-h-[36px]"
                  >
                    Cancel
                  </button>
                </>
              )}
              {isTranscribing && (
                <button
                  type="button"
                  onClick={voice.cancelRecording}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-neutral-500 hover:bg-neutral-100 cursor-pointer min-h-[36px]"
                >
                  Cancel
                </button>
              )}
              {voice.playbackPhase === 'playing' && (
                <>
                  <button
                    type="button"
                    onClick={voice.pausePlayback}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#0284C7] hover:bg-sky-50 cursor-pointer min-h-[36px]"
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    onClick={voice.stopSpeaking}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-neutral-500 hover:bg-neutral-100 cursor-pointer min-h-[36px]"
                  >
                    Stop
                  </button>
                </>
              )}
              {(voice.playbackPhase === 'paused' || voice.playbackPhase === 'blocked') &&
                latestAssistantMessage && (
                  <button
                    type="button"
                    onClick={() => void voice.playOrResume()}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#0284C7] hover:bg-sky-50 cursor-pointer min-h-[36px]"
                  >
                    {voice.playbackPhase === 'paused' ? 'Resume' : 'Play'}
                  </button>
                )}
              {voice.playbackPhase !== 'playing' &&
                voice.playbackPhase !== 'paused' &&
                voice.playbackPhase !== 'blocked' &&
                !isRecordingOrListening &&
                !isTranscribing &&
                voice.canReplay &&
                latestAssistantMessage && (
                  <button
                    type="button"
                    onClick={() => void voice.replayLastResponse()}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-neutral-500 hover:text-[#0284C7] hover:bg-neutral-50 cursor-pointer min-h-[36px]"
                  >
                    Replay
                  </button>
                )}
            </div>
          </div>

          {/* Clean Messaging Feed */}
          <div className="flex-1 py-4 space-y-4">
            {messages.map((msg) => {
              const isPlayingThis =
                voice.playbackPhase === 'playing' && voice.speakingMessageId === msg.id;
              const isPausedThis =
                voice.playbackPhase === 'paused' && voice.readyMessageId === msg.id;
              const isBlockedThis =
                voice.playbackPhase === 'blocked' && voice.readyMessageId === msg.id;
              const isGeneratingThis =
                voice.playbackPhase === 'generating' && voice.speakingMessageId === msg.id;

              return (
                <div
                  key={msg.id}
                  className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                >
                  {msg.role === 'user' ? (
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-neutral-100 px-4 py-2.5 text-[15px] text-[#111111] leading-relaxed whitespace-pre-line break-words">
                      {msg.text}
                    </div>
                  ) : (
                    <div className="max-w-[94%] space-y-1.5">
                      <p className="text-[15px] text-[#111111] leading-relaxed whitespace-pre-line break-words">
                        {msg.text}
                      </p>
                      {clarificationOptions?.messageId === msg.id && (
                        <div
                          data-testid="disambiguation-options"
                          className="flex flex-col sm:flex-row sm:flex-wrap gap-1.5 pt-1"
                        >
                          {clarificationOptions.options.map((opt) => (
                            <button
                              key={`${opt.kind}:${opt.id}`}
                              type="button"
                              disabled={isSavingTransaction || isSubmitting}
                              onClick={() => handleSelectDisambiguationOption(opt)}
                              className="text-left px-3 py-2 rounded-xl border border-[#0284C7]/30 bg-sky-50/50 hover:bg-sky-100/70 text-xs font-medium text-[#111111] transition-colors cursor-pointer disabled:opacity-50 min-h-[38px]"
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        {isPlayingThis ? (
                          <>
                            <button
                              type="button"
                              onClick={voice.pausePlayback}
                              className="inline-flex items-center gap-1 py-1 text-xs font-medium text-[#0284C7] hover:text-[#0369A1] cursor-pointer min-h-[34px]"
                            >
                              <Pause className="w-3.5 h-3.5" />
                              <span>Pause</span>
                            </button>
                            <button
                              type="button"
                              onClick={voice.stopSpeaking}
                              className="inline-flex items-center gap-1 py-1 text-xs font-medium text-neutral-500 hover:text-[#111111] cursor-pointer min-h-[34px]"
                            >
                              <Square className="w-3 h-3 fill-current" />
                              <span>Stop</span>
                            </button>
                          </>
                        ) : isPausedThis ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                void voice.playOrResume({
                                  id: msg.id,
                                  text: msg.text,
                                  langHint: msg.langHint || 'en'
                                })
                              }
                              className="inline-flex items-center gap-1 py-1 text-xs font-semibold text-[#0284C7] hover:text-[#0369A1] cursor-pointer min-h-[34px]"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>Resume</span>
                            </button>
                            <button
                              type="button"
                              onClick={voice.stopSpeaking}
                              className="inline-flex items-center gap-1 py-1 text-xs font-medium text-neutral-500 hover:text-[#111111] cursor-pointer min-h-[34px]"
                            >
                              <Square className="w-3 h-3 fill-current" />
                              <span>Stop</span>
                            </button>
                          </>
                        ) : isBlockedThis ? (
                          <button
                            type="button"
                            onClick={() =>
                              void voice.playOrResume({
                                id: msg.id,
                                text: msg.text,
                                langHint: msg.langHint || 'en'
                              })
                            }
                            className="inline-flex items-center gap-1 py-1 text-xs font-semibold text-[#0284C7] hover:text-[#0369A1] cursor-pointer min-h-[34px]"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Play</span>
                          </button>
                        ) : isGeneratingThis ? (
                          <button
                            type="button"
                            onClick={voice.stopSpeaking}
                            className="inline-flex items-center gap-1 py-1 text-xs font-medium text-neutral-500 hover:text-[#111111] cursor-pointer min-h-[34px]"
                          >
                            <Square className="w-3 h-3 fill-current" />
                            <span>Generating audio…</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              voice.unlockAudioFromUserGesture();
                              void voice.playOrResume({
                                id: msg.id,
                                text: msg.text,
                                langHint: msg.langHint || 'en'
                              });
                            }}
                            className="inline-flex items-center gap-1 py-1 text-xs font-medium text-neutral-400 hover:text-[#0284C7] transition-colors cursor-pointer min-h-[34px]"
                            aria-label="Play audio response"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                            <span>{voice.readyMessageId === msg.id ? 'Replay' : 'Listen'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {isSubmitting && (
              <div className="text-sm text-neutral-400 py-1">
                Thinking…
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        </>
      )}

      {/* Interactive Confirmation Preview Card (never auto-saved without confirmation) */}
      {pendingProposal && (
        <TransactionPreviewCard
          proposal={pendingProposal}
          catalog={entryCatalog || buildEntryCatalog(readCurrentSnapshot())}
          isEditing={isEditingProposal}
          isSaving={isSavingTransaction}
          editError={proposalEditError}
          onStartEdit={() => {
            setProposalEditError(null);
            setIsEditingProposal(true);
          }}
          onCancelEdit={() => {
            setProposalEditError(null);
            setIsEditingProposal(false);
          }}
          onApplyEdit={handleApplyEditProposal}
          onConfirm={() => void handleConfirmPendingTransaction('button')}
          onCancel={() => handleCancelPendingTransaction('button')}
        />
      )}

      {/* Editable Transcript Review Bar (prevents silent auto-submit of uncertain voice recognition) */}
      {voice.inputPhase === 'completed' && inputText.trim() && (
        <div className="mb-2 px-3.5 py-2 rounded-xl border border-sky-200/80 bg-sky-50/40 flex items-center justify-between gap-2">
          <p className="text-xs text-sky-900 leading-snug">
            {voice.usingBrowserFallback
              ? 'Browser voice transcript ready — edit if needed and tap Send.'
              : 'Transcript ready — review or edit below, then tap Send.'}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={voice.retryRecording}
              className="px-2.5 py-1 rounded-lg text-xs font-medium text-[#0284C7] hover:bg-sky-100/60 cursor-pointer min-h-[32px]"
            >
              Re-record
            </button>
            <button
              type="button"
              onClick={() => {
                voice.clearVoiceReview();
                setInputText('');
              }}
              aria-label="Discard transcript"
              className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-neutral-500 hover:text-[#111111] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Contextual Error / Playback Blocked Notice */}
      {activeBannerMessage && (
        <div
          role={errorNotice || voice.voiceError ? 'alert' : 'status'}
          data-request-id={activeErrorRefId || undefined}
          className={`mb-2.5 px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3 ${
            voice.playbackPhase === 'blocked'
              ? 'border-sky-200/80 bg-sky-50/40'
              : 'border-rose-200/80 bg-rose-50/40'
          }`}
        >
          <div className="min-w-0">
            <p
              className={`text-xs leading-snug ${
                voice.playbackPhase === 'blocked' ? 'text-sky-900' : 'text-rose-800'
              }`}
            >
              {activeBannerMessage}
            </p>
            {activeErrorRefId && (
              <p className="text-[10px] text-neutral-400 mt-0.5 select-all truncate">
                Ref · {activeErrorRefId}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {voice.playbackPhase === 'blocked' && latestAssistantMessage && (
              <button
                type="button"
                onClick={() => void voice.playOrResume()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0284C7] hover:bg-sky-100/70 transition-colors cursor-pointer min-h-[34px]"
              >
                Play
              </button>
            )}

            {voice.playbackPhase === 'failed' && latestAssistantMessage && !voice.voiceError && !errorNotice && (
              <button
                type="button"
                onClick={() => {
                  voice.unlockAudioFromUserGesture();
                  void voice.speakResponse(
                    latestAssistantMessage.text,
                    latestAssistantMessage.id,
                    latestAssistantMessage.langHint || 'en',
                    true
                  );
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0284C7] hover:bg-sky-50 transition-colors cursor-pointer min-h-[34px]"
              >
                Retry audio
              </button>
            )}

            {voice.voiceError && voice.usingBrowserFallback && (
              <button
                type="button"
                onClick={voice.startBrowserFallbackRecording}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#0284C7] hover:bg-sky-50 transition-colors cursor-pointer min-h-[34px]"
              >
                Browser mic
              </button>
            )}

            {voice.voiceError && (
              <button
                type="button"
                onClick={voice.retryRecording}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0284C7] hover:bg-sky-50 transition-colors cursor-pointer min-h-[34px]"
              >
                Retry
              </button>
            )}

            {errorNotice?.retryable && errorNotice.failedQuery && (
              <button
                type="button"
                onClick={handleRetryFailedQuery}
                disabled={isSubmitting}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0284C7] hover:bg-sky-50 transition-colors cursor-pointer disabled:opacity-50 min-h-[34px]"
              >
                Retry
              </button>
            )}
          </div>
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
            disabled={(isSubmitting || isTranscribing) && voice.voiceState === 'thinking'}
            aria-label={isRecordingOrListening ? 'Stop microphone' : 'Speak a message'}
            className={`min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-40 ${
              isRecordingOrListening
                ? 'bg-[#0284C7] text-white'
                : 'text-neutral-500 hover:text-[#0284C7] hover:bg-neutral-50'
            }`}
          >
            {isRecordingOrListening ? (
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
