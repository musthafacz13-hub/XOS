import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Mic,
  PanelLeft,
  Pause,
  Play,
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
import { chatHistoryService } from '../../services/ai/chatHistoryService';
import { AiChatMessage, AiConversation } from '../../services/ai/chatHistoryTypes';
import {
  createClientMessageId,
  generateConversationTitleFromMessage,
  organizeConversations,
  sortConversationsNewestFirst
} from '../../services/ai/chatHistoryUtils';
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
import { ChatHistoryPanel } from './ChatHistoryPanel';
import { NewChatButton } from './NewChatButton';
import { TransactionPreviewCard } from './TransactionPreviewCard';
import { VoiceOrb } from './VoiceOrb';

interface AgentMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  modules?: XosModuleKey[];
  langHint?: 'ml' | 'en' | 'mixed';
  clientMessageId?: string;
}

interface AgentErrorState {
  message: string;
  requestId?: string;
  failedQuery?: string;
  userClientMessageId?: string;
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

function mapDbMessageToAgentMessage(msg: AiChatMessage): AgentMessage {
  return {
    id: msg.id,
    role: msg.role,
    text: msg.content,
    modules: msg.modules,
    langHint: msg.langHint,
    clientMessageId: msg.clientMessageId
  };
}

export const AiAgentView: React.FC = () => {
  const { session, user } = useAuth();
  const accessToken = session?.access_token || null;

  // Persistent database-backed conversations & strictly isolated active thread state (zero browser storage)
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState<boolean>(Boolean(isSupabaseConfigured));
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const [isHistoryDesktopOpen, setIsHistoryDesktopOpen] = useState(true);
  const [isHistoryMobileOpen, setIsHistoryMobileOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busyConversationId, setBusyConversationId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiConversation | null>(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine === false : false
  );

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
  const activeConversationIdRef = useRef<string | null>(null);
  const pendingProposalRef = useRef<PendingTransactionProposal | null>(null);
  const isSubmittingRef = useRef(false);
  const isSavingTransactionRef = useRef(false);
  const mountedRef = useRef(true);
  const lastUserIdRef = useRef<string | undefined>(user?.id);
  const abortControllerRef = useRef<AbortController | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceRef = useRef<ReturnType<typeof useJarvisVoice> | null>(null);
  const listLoadSeqRef = useRef(0);
  const conversationLoadSeqRef = useRef(0);
  const requestEpochRef = useRef(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    pendingProposalRef.current = pendingProposal;
  }, [pendingProposal]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const upsertConversationInList = useCallback((updated: AiConversation) => {
    setConversations(prev => {
      const filtered = prev.filter(item => item.id !== updated.id);
      return sortConversationsNewestFirst([updated, ...filtered]);
    });
  }, []);

  const loadConversations = useCallback(async () => {
    if (isSupabaseConfigured && !user?.id) {
      setConversations([]);
      setIsLoadingConversations(false);
      setHistoryError(null);
      return;
    }

    const seq = ++listLoadSeqRef.current;
    setIsLoadingConversations(true);
    setHistoryError(null);
    try {
      const list = await chatHistoryService.listConversations();
      if (!mountedRef.current || listLoadSeqRef.current !== seq) return;
      setConversations(list);
    } catch (err) {
      if (!mountedRef.current || listLoadSeqRef.current !== seq) return;
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Could not load conversation history.';
      setHistoryError(msg);
    } finally {
      if (mountedRef.current && listLoadSeqRef.current === seq) {
        setIsLoadingConversations(false);
      }
    }
  }, [user?.id]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (lastUserIdRef.current !== user?.id) {
      lastUserIdRef.current = user?.id;
      requestEpochRef.current += 1;
      conversationLoadSeqRef.current += 1;
      abortControllerRef.current?.abort();
      activeConversationIdRef.current = null;
      setActiveConversationId(null);
      setMessages([]);
      setInputText('');
      setErrorNotice(null);
      setPendingProposal(null);
      setIsEditingProposal(false);
      setProposalEditError(null);
      setClarificationOptions(null);
      setDeleteTarget(null);
      setDeleteError(null);
      setShowArchived(false);
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
        const confirmLang = activeProposal.detectedLanguage;
        const activeConvId = activeConversationIdRef.current;

        let savedMsgId = confirmMsgId;
        if (activeConvId) {
          try {
            const saved = await chatHistoryService.saveMessage({
              conversationId: activeConvId,
              role: 'model',
              content: result.confirmationMessage,
              clientMessageId: createClientMessageId(),
              metadata: { langHint: confirmLang }
            });
            savedMsgId = saved.message.id;
            if (mountedRef.current) {
              upsertConversationInList(saved.conversation);
            }
          } catch {
            // Keep transaction confirmation visible even if history save had a transient issue
          }
        }

        if (!mountedRef.current) return;
        if (!activeConvId || activeConversationIdRef.current === activeConvId) {
          setMessages(prev => [
            ...prev,
            {
              id: savedMsgId,
              role: 'model',
              text: result.confirmationMessage,
              langHint: confirmLang
            }
          ]);
        }

        voiceRef.current?.setVoiceState('idle');
        await voiceRef.current?.speakResponse(
          result.confirmationMessage,
          savedMsgId,
          confirmLang
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
    [accessToken, upsertConversationInList, user?.id]
  );

  const persistSystemAssistantMessage = useCallback(
    async (text: string, langHint: 'ml' | 'en' | 'mixed', conversationId: string | null) => {
      if (!conversationId) return;
      try {
        const saved = await chatHistoryService.saveMessage({
          conversationId,
          role: 'model',
          content: text,
          clientMessageId: createClientMessageId(),
          metadata: { langHint }
        });
        if (mountedRef.current) {
          upsertConversationInList(saved.conversation);
        }
      } catch {
        // Non-fatal for local cancellation notice
      }
    },
    [upsertConversationInList]
  );

  const handleCancelPendingTransaction = useCallback(
    (_source: 'button' | 'voice') => {
      const activeProposal = pendingProposalRef.current;
      if (!activeProposal || isSavingTransactionRef.current) return;
      const lang = activeProposal.detectedLanguage;
      const activeConvId = activeConversationIdRef.current;
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
      void persistSystemAssistantMessage(cancelText, lang, activeConvId);
    },
    [persistSystemAssistantMessage]
  );

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
    async (rawQuery: string, isRetry: boolean = false, retryClientMessageId?: string) => {
      const cleanQuery = rawQuery.trim();
      if (!cleanQuery || isSubmittingRef.current || isSavingTransactionRef.current) return;

      // If an active non-expired proposal awaits confirmation, inspect typed/spoken confirmation or cancel first
      if (!isRetry && pendingProposalRef.current) {
        const activeProp = pendingProposalRef.current;
        const voiceCmd = matchPendingConfirmationVoiceCommand(cleanQuery);
        if (voiceCmd === 'confirm' && Date.now() <= activeProp.expiresAtMs) {
          setInputText('');
          const convId = activeConversationIdRef.current;
          setMessages(prev => [
            ...prev,
            {
              id: createMessageId(),
              role: 'user',
              text: cleanQuery,
              langHint: activeProp.detectedLanguage
            }
          ]);
          if (convId) {
            void chatHistoryService
              .saveMessage({
                conversationId: convId,
                role: 'user',
                content: cleanQuery,
                clientMessageId: createClientMessageId(),
                metadata: { langHint: activeProp.detectedLanguage }
              })
              .then(saved => {
                if (mountedRef.current) upsertConversationInList(saved.conversation);
              })
              .catch(() => {});
          }
          void handleConfirmPendingTransaction('voice');
          return;
        }
        if (voiceCmd === 'cancel') {
          setInputText('');
          const convId = activeConversationIdRef.current;
          setMessages(prev => [
            ...prev,
            {
              id: createMessageId(),
              role: 'user',
              text: cleanQuery,
              langHint: activeProp.detectedLanguage
            }
          ]);
          if (convId) {
            void chatHistoryService
              .saveMessage({
                conversationId: convId,
                role: 'user',
                content: cleanQuery,
                clientMessageId: createClientMessageId(),
                metadata: { langHint: activeProp.detectedLanguage }
              })
              .then(saved => {
                if (mountedRef.current) upsertConversationInList(saved.conversation);
              })
              .catch(() => {});
          }
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

      const currentEpoch = requestEpochRef.current;
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

      const userClientMsgId =
        retryClientMessageId ||
        (alreadyAppendedSamePendingTurn ? lastMsg?.clientMessageId : undefined) ||
        createClientMessageId();
      const optimisticUserMsgId = alreadyAppendedSamePendingTurn && lastMsg ? lastMsg.id : createMessageId();

      if (!alreadyAppendedSamePendingTurn) {
        const userMessage: AgentMessage = {
          id: optimisticUserMsgId,
          role: 'user',
          text: cleanQuery,
          modules: preliminaryIntent.modules,
          langHint: preliminaryIntent.detectedLanguage,
          clientMessageId: userClientMsgId
        };
        setMessages(prev => [...prev, userMessage]);
      }

      setInputText('');

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        // 1. Ensure an owned persistent conversation exists before sending/persisting messages
        let targetConversationId = activeConversationIdRef.current;
        if (!targetConversationId) {
          const createdConv = await chatHistoryService.createConversation({
            title: generateConversationTitleFromMessage(cleanQuery),
            languagePreference: voiceRef.current?.voiceLanguage || 'ml-IN'
          });
          if (!mountedRef.current || requestEpochRef.current !== currentEpoch || controller.signal.aborted) {
            voiceRef.current?.setVoiceState('idle');
            return;
          }
          targetConversationId = createdConv.id;
          activeConversationIdRef.current = targetConversationId;
          setActiveConversationId(targetConversationId);
          upsertConversationInList(createdConv);
        }

        // 2. Persist the user message first with idempotent clientMessageId (safe on retries)
        const savedUser = await chatHistoryService.saveMessage({
          conversationId: targetConversationId,
          role: 'user',
          content: cleanQuery,
          clientMessageId: userClientMsgId,
          metadata: {
            langHint: preliminaryIntent.detectedLanguage,
            modules: preliminaryIntent.modules
          }
        });

        if (!mountedRef.current || requestEpochRef.current !== currentEpoch || controller.signal.aborted) {
          voiceRef.current?.setVoiceState('idle');
          return;
        }

        upsertConversationInList(savedUser.conversation);
        setMessages(prev =>
          prev.map(m =>
            m.id === optimisticUserMsgId || m.clientMessageId === userClientMsgId
              ? { ...m, id: savedUser.message.id, clientMessageId: userClientMsgId }
              : m
          )
        );

        // 3. Ensure authenticated Supabase financial records are hydrated before building grounded AI context
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
          if (!mountedRef.current || controller.signal.aborted || requestEpochRef.current !== currentEpoch) {
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

        if (
          !mountedRef.current ||
          requestEpochRef.current !== currentEpoch ||
          activeConversationIdRef.current !== targetConversationId
        ) {
          voiceRef.current?.setVoiceState('idle');
          return;
        }

        const assistantClientMsgId = createClientMessageId();
        let assistantMsgId = createMessageId();
        let persistenceWarning: string | null = null;

        try {
          const savedAssistant = await chatHistoryService.saveMessage({
            conversationId: targetConversationId,
            role: 'model',
            content: result.reply,
            clientMessageId: assistantClientMsgId,
            metadata: {
              langHint: result.detectedLanguage,
              modules: selective.selectedModules,
              actionType: result.actionType
            }
          });
          assistantMsgId = savedAssistant.message.id;
          if (mountedRef.current && requestEpochRef.current === currentEpoch) {
            upsertConversationInList(savedAssistant.conversation);
          }
        } catch (saveErr) {
          persistenceWarning =
            saveErr instanceof Error && saveErr.message
              ? saveErr.message
              : 'Response could not be saved to chat history.';
        }

        if (
          !mountedRef.current ||
          requestEpochRef.current !== currentEpoch ||
          activeConversationIdRef.current !== targetConversationId
        ) {
          return;
        }

        const assistantMessage: AgentMessage = {
          id: assistantMsgId,
          role: 'model',
          text: result.reply,
          modules: selective.selectedModules,
          langHint: result.detectedLanguage,
          clientMessageId: assistantClientMsgId
        };

        setMessages(prev => [...prev, assistantMessage]);
        if (persistenceWarning) {
          setErrorNotice({
            message: persistenceWarning,
            retryable: false
          });
        }

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
        if (!mountedRef.current || requestEpochRef.current !== currentEpoch) return;
        voiceRef.current?.setVoiceState('idle');
        if (err instanceof AiServiceError) {
          if (err.code === 'cancelled') {
            return;
          }
          setErrorNotice({
            message: err.message,
            requestId: err.requestId,
            failedQuery: cleanQuery,
            userClientMessageId: userClientMsgId,
            retryable: err.retryable
          });
        } else {
          const message =
            err instanceof Error && err.message
              ? err.message
              : 'Could not reach the AI service. Please try again.';
          setErrorNotice({
            message,
            failedQuery: cleanQuery,
            userClientMessageId: userClientMsgId,
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
    [
      accessToken,
      handleCancelPendingTransaction,
      handleConfirmPendingTransaction,
      upsertConversationInList,
      user?.id
    ]
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
          const convId = activeConversationIdRef.current;
          setMessages(prev => [
            ...prev,
            {
              id: createMessageId(),
              role: 'user',
              text: transcript,
              langHint: activeProp.detectedLanguage
            }
          ]);
          if (convId) {
            void chatHistoryService
              .saveMessage({
                conversationId: convId,
                role: 'user',
                content: transcript,
                clientMessageId: createClientMessageId(),
                metadata: { langHint: activeProp.detectedLanguage }
              })
              .then(saved => {
                if (mountedRef.current) upsertConversationInList(saved.conversation);
              })
              .catch(() => {});
          }
          void handleConfirmPendingTransaction('voice');
          return;
        }
        if (cmd === 'cancel') {
          voiceRef.current?.clearVoiceReview();
          setInputText('');
          const convId = activeConversationIdRef.current;
          setMessages(prev => [
            ...prev,
            {
              id: createMessageId(),
              role: 'user',
              text: transcript,
              langHint: activeProp.detectedLanguage
            }
          ]);
          if (convId) {
            void chatHistoryService
              .saveMessage({
                conversationId: convId,
                role: 'user',
                content: transcript,
                clientMessageId: createClientMessageId(),
                metadata: { langHint: activeProp.detectedLanguage }
              })
              .then(saved => {
                if (mountedRef.current) upsertConversationInList(saved.conversation);
              })
              .catch(() => {});
          }
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

  const handleResetSession = useCallback(() => {
    requestEpochRef.current += 1;
    conversationLoadSeqRef.current += 1;
    abortControllerRef.current?.abort();
    voice.cancelRecording();
    voice.clearCachedAudio();
    voice.setVoiceState('idle');
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setShowArchived(false);
    setIsLoadingMessages(false);
    setErrorNotice(null);
    setPendingProposal(null);
    setIsEditingProposal(false);
    setProposalEditError(null);
    setClarificationOptions(null);
    resetTransactionExecutorState();
    setMessages([]);
    setInputText('');
  }, [voice]);

  const handleSelectConversation = useCallback(
    async (conv: AiConversation) => {
      if (conv.archived) return;
      if (conv.id === activeConversationIdRef.current && !isLoadingMessages) {
        setIsHistoryMobileOpen(false);
        return;
      }

      requestEpochRef.current += 1;
      const loadSeq = ++conversationLoadSeqRef.current;
      abortControllerRef.current?.abort();
      voice.cancelRecording();
      voice.clearCachedAudio();
      voice.setVoiceState('idle');

      activeConversationIdRef.current = conv.id;
      setActiveConversationId(conv.id);
      setShowArchived(false);
      setErrorNotice(null);
      setPendingProposal(null);
      setIsEditingProposal(false);
      setProposalEditError(null);
      setClarificationOptions(null);
      resetTransactionExecutorState();
      setMessages([]);
      setInputText('');
      setIsLoadingMessages(true);
      voice.setVoiceLanguage(conv.languagePreference);

      try {
        const loaded = await chatHistoryService.getMessages(conv.id);
        if (
          !mountedRef.current ||
          conversationLoadSeqRef.current !== loadSeq ||
          activeConversationIdRef.current !== conv.id
        ) {
          return;
        }
        setMessages(loaded.map(mapDbMessageToAgentMessage));
      } catch (err) {
        if (
          !mountedRef.current ||
          conversationLoadSeqRef.current !== loadSeq ||
          activeConversationIdRef.current !== conv.id
        ) {
          return;
        }
        setErrorNotice({
          message:
            err instanceof Error && err.message
              ? err.message
              : 'Could not load messages for this conversation.',
          retryable: false
        });
      } finally {
        if (mountedRef.current && conversationLoadSeqRef.current === loadSeq) {
          setIsLoadingMessages(false);
        }
      }
    },
    [isLoadingMessages, voice]
  );

  const handleLanguageChange = useCallback(
    (nextLang: PreferredVoiceLanguage) => {
      voice.setVoiceLanguage(nextLang);
      const activeId = activeConversationIdRef.current;
      if (!activeId) return;
      void chatHistoryService
        .updateConversationLanguage(activeId, nextLang)
        .then(updated => {
          if (mountedRef.current) upsertConversationInList(updated);
        })
        .catch(() => {});
    },
    [upsertConversationInList, voice]
  );

  const handleRenameConversation = useCallback(
    async (conversationId: string, nextTitle: string) => {
      setBusyConversationId(conversationId);
      try {
        const updated = await chatHistoryService.updateConversationTitle(conversationId, nextTitle);
        if (mountedRef.current) {
          upsertConversationInList(updated);
        }
      } catch (err) {
        if (mountedRef.current) {
          setErrorNotice({
            message:
              err instanceof Error && err.message ? err.message : 'Could not rename conversation.',
            retryable: false
          });
        }
        throw err;
      } finally {
        if (mountedRef.current) {
          setBusyConversationId(null);
        }
      }
    },
    [upsertConversationInList]
  );

  const handleTogglePinConversation = useCallback(
    async (conv: AiConversation) => {
      setBusyConversationId(conv.id);
      try {
        const updated = await chatHistoryService.setConversationPinned(conv.id, !conv.pinned);
        if (mountedRef.current) {
          upsertConversationInList(updated);
        }
      } catch (err) {
        if (mountedRef.current) {
          setErrorNotice({
            message:
              err instanceof Error && err.message ? err.message : 'Could not update pinned status.',
            retryable: false
          });
        }
      } finally {
        if (mountedRef.current) {
          setBusyConversationId(null);
        }
      }
    },
    [upsertConversationInList]
  );

  const handleToggleArchiveConversation = useCallback(
    async (conv: AiConversation) => {
      const nextArchived = !conv.archived;
      setBusyConversationId(conv.id);
      try {
        const updated = await chatHistoryService.setConversationArchived(conv.id, nextArchived);
        if (!mountedRef.current) return;
        upsertConversationInList(updated);
        if (nextArchived && activeConversationIdRef.current === conv.id) {
          handleResetSession();
        }
      } catch (err) {
        if (mountedRef.current) {
          setErrorNotice({
            message:
              err instanceof Error && err.message ? err.message : 'Could not update archive status.',
            retryable: false
          });
        }
      } finally {
        if (mountedRef.current) {
          setBusyConversationId(null);
        }
      }
    },
    [handleResetSession, upsertConversationInList]
  );

  const handleConfirmDeleteConversation = useCallback(async () => {
    const target = deleteTarget;
    if (!target || isDeletingConversation) return;
    setIsDeletingConversation(true);
    setDeleteError(null);
    try {
      await chatHistoryService.deleteConversation(target.id);
      if (!mountedRef.current) return;
      setConversations(prev => prev.filter(c => c.id !== target.id));
      if (activeConversationIdRef.current === target.id) {
        handleResetSession();
      }
      setDeleteTarget(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setDeleteError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not delete conversation. Please try again.'
      );
    } finally {
      if (mountedRef.current) {
        setIsDeletingConversation(false);
      }
    }
  }, [deleteTarget, handleResetSession, isDeletingConversation]);

  const organizedConversations = useMemo(
    () => organizeConversations(conversations),
    [conversations]
  );

  const activeConversation = useMemo(
    () => conversations.find(c => c.id === activeConversationId) || null,
    [activeConversationId, conversations]
  );

  const handleRetryFailedQuery = () => {
    if (!errorNotice?.failedQuery || isSubmitting) return;
    void handleSubmitQuery(errorNotice.failedQuery, true, errorNotice.userClientMessageId);
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
    <div className="max-w-5xl mx-auto flex gap-4 min-h-[calc(100dvh-13.75rem)] sm:min-h-[calc(100dvh-15rem)] md:min-h-[calc(100dvh-10rem)]">
      <ChatHistoryPanel
        isDesktopOpen={isHistoryDesktopOpen}
        isMobileOpen={isHistoryMobileOpen}
        showArchived={showArchived}
        onSetShowArchived={setShowArchived}
        onCloseDesktop={() => setIsHistoryDesktopOpen(false)}
        onCloseMobile={() => setIsHistoryMobileOpen(false)}
        pinned={organizedConversations.pinned}
        recentGroups={organizedConversations.recentGroups}
        archived={organizedConversations.archived}
        activeConversationId={activeConversationId}
        busyConversationId={busyConversationId}
        isLoading={isLoadingConversations}
        error={historyError}
        isOffline={isOffline}
        isNewChatDisabled={isSubmitting || isRecordingOrListening || isTranscribing}
        deleteTarget={deleteTarget}
        isDeleting={isDeletingConversation}
        deleteError={deleteError}
        onRetryLoad={() => void loadConversations()}
        onNewChat={handleResetSession}
        onSelectConversation={(conv) => void handleSelectConversation(conv)}
        onRenameConversation={handleRenameConversation}
        onTogglePinConversation={(conv) => void handleTogglePinConversation(conv)}
        onToggleArchiveConversation={(conv) => void handleToggleArchiveConversation(conv)}
        onRequestDeleteConversation={(conv) => {
          setDeleteError(null);
          setDeleteTarget(conv);
        }}
        onConfirmDeleteConversation={handleConfirmDeleteConversation}
        onCancelDeleteConversation={() => {
          if (!isDeletingConversation) {
            setDeleteError(null);
            setDeleteTarget(null);
          }
        }}
      />

      <div className="flex-1 min-w-0 max-w-2xl mx-auto flex flex-col min-h-[calc(100dvh-13.75rem)] sm:min-h-[calc(100dvh-15rem)] md:min-h-[calc(100dvh-10rem)]">
        {/* Responsive Jarvis AI Utility Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-black/[0.06] sm:flex-nowrap sm:gap-3">
          <div className="flex items-center gap-2 min-w-0 order-1 sm:flex-1">
            <button
              type="button"
              onClick={() => setIsHistoryMobileOpen(true)}
              aria-label="Open chat history"
              data-testid="mobile-history-toggle"
              className="lg:hidden min-h-[44px] sm:min-h-[38px] px-3 inline-flex items-center gap-1.5 rounded-xl border border-black/[0.08] bg-white text-xs font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7]"
            >
              <PanelLeft className="w-4 h-4 text-[#6e6e73] shrink-0" />
              <span>Chats</span>
            </button>

            {!isHistoryDesktopOpen && (
              <button
                type="button"
                onClick={() => setIsHistoryDesktopOpen(true)}
                aria-label="Open chat history"
                data-testid="desktop-history-toggle"
                className="hidden lg:inline-flex min-h-[38px] px-3 items-center gap-1.5 rounded-xl border border-black/[0.08] bg-white text-xs font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7]"
              >
                <PanelLeft className="w-4 h-4 text-[#6e6e73] shrink-0" />
                <span>Chats</span>
              </button>
            )}

            <div className={isHistoryDesktopOpen ? 'lg:hidden shrink-0' : 'shrink-0'}>
              <NewChatButton
                compact
                onClick={handleResetSession}
                disabled={isSubmitting || isRecordingOrListening || isTranscribing}
              />
            </div>

            <span className="hidden md:inline-block text-xs text-[#86868b] truncate pl-1 min-w-0">
              {activeConversation ? activeConversation.title : 'Read-only until confirmed'}
            </span>
          </div>

          <div
            role="group"
            aria-label="Voice language"
            className="w-full order-3 sm:order-2 sm:w-auto sm:shrink-0 grid grid-cols-3 sm:inline-flex items-center gap-1 bg-[#f5f5f7] p-1 rounded-xl"
          >
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = voice.voiceLanguage === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleLanguageChange(opt.id)}
                  disabled={isRecordingOrListening || isTranscribing || isSubmitting}
                  aria-pressed={active}
                  className={`min-h-[44px] sm:min-h-[32px] px-2.5 sm:px-3 py-1.5 sm:py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] disabled:opacity-60 ${
                    active
                      ? 'bg-white text-[#1d1d1f] font-semibold shadow-2xs ring-1 ring-black/[0.04]'
                      : 'text-[#6e6e73] hover:text-[#1d1d1f]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="order-2 sm:order-3 shrink-0">
            <button
              type="button"
              onClick={voice.toggleMute}
              aria-pressed={!voice.isMuted}
              className={`min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px] flex items-center justify-center rounded-xl border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] ${
                voice.isMuted
                  ? 'border-black/[0.08] bg-white text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7]'
                  : 'border-[#0284c7]/25 bg-[#0284c7]/10 text-[#0284c7] hover:bg-[#0284c7]/15'
              }`}
              aria-label={voice.isMuted ? 'Unmute Jarvis voice output' : 'Mute Jarvis voice output'}
              title={voice.isMuted ? 'Voice muted' : 'Voice enabled'}
            >
              {voice.isMuted ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {activeConversation && (
          <div className="md:hidden pt-2 text-[11px] font-medium text-[#86868b] truncate">
            {activeConversation.title}
          </div>
        )}

        {/* Main Content Area: Loading Messages OR Centered Minimal Voice Stage (empty) OR Active Strip + Messaging Feed */}
        {isLoadingMessages ? (
          <div className="flex-1 py-6 space-y-4" aria-label="Loading conversation messages">
            <div className="flex justify-end">
              <div className="h-10 w-48 rounded-2xl bg-[#f5f5f7] animate-pulse" />
            </div>
            <div className="flex justify-start">
              <div className="h-16 w-72 rounded-2xl bg-[#f5f5f7]/70 animate-pulse" />
            </div>
            <div className="flex justify-end">
              <div className="h-10 w-36 rounded-2xl bg-[#f5f5f7] animate-pulse" />
            </div>
          </div>
        ) : messages.length === 0 ? (
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
                  ? 'text-[#0284c7]'
                  : effectiveVoiceState === 'error'
                    ? 'text-rose-600'
                    : 'text-[#1d1d1f]'
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
                    className="px-3 py-1.5 rounded-xl bg-[#0284c7] text-white text-xs font-medium hover:bg-[#0369a1] cursor-pointer min-h-[38px]"
                  >
                    Stop & Transcribe
                  </button>
                )}
                <button
                  type="button"
                  onClick={voice.cancelRecording}
                  className="px-3 py-1.5 rounded-xl border border-black/[0.08] text-xs font-medium text-[#6e6e73] hover:text-[#1d1d1f] cursor-pointer min-h-[38px]"
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
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-[#0284c7] hover:bg-[#0284c7]/10 cursor-pointer min-h-[38px]"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </button>
                <button
                  type="button"
                  onClick={voice.stopSpeaking}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-[#6e6e73] hover:bg-[#f5f5f7] cursor-pointer min-h-[38px]"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Stop</span>
                </button>
              </div>
            )}
          </div>

          {/* Compact Suggestion Buttons (only when conversation is empty) */}
          <div className="flex flex-wrap items-center justify-center gap-2 max-w-md px-1 pt-1">
            {QUICK_PROMPTS.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={isSubmitting || isRecordingOrListening || isTranscribing}
                onClick={() => void handleSubmitQuery(item.query, false)}
                className="px-3.5 py-2 rounded-xl border border-black/[0.08] bg-[#fbfbfd] hover:border-[#0284c7]/50 hover:bg-[#0284c7]/[0.05] hover:text-[#0284c7] text-xs font-medium text-[#1d1d1f] transition-colors cursor-pointer disabled:opacity-50 min-h-[44px] sm:min-h-[40px]"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Compact Voice Control Strip during active conversation */}
          <div className="sticky top-[calc(4rem+env(safe-area-inset-top,0px))] md:top-16 z-10 liquid-glass border-b border-black/[0.06] py-2 flex items-center justify-between gap-3">
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
                    ? 'text-[#0284c7]'
                    : effectiveVoiceState === 'error'
                      ? 'text-rose-600'
                      : 'text-[#6e6e73]'
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
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#0284c7] hover:bg-[#0284c7]/10 cursor-pointer min-h-[40px]"
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    onClick={voice.cancelRecording}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#6e6e73] hover:bg-[#f5f5f7] cursor-pointer min-h-[40px]"
                  >
                    Cancel
                  </button>
                </>
              )}
              {isTranscribing && (
                <button
                  type="button"
                  onClick={voice.cancelRecording}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#6e6e73] hover:bg-[#f5f5f7] cursor-pointer min-h-[40px]"
                >
                  Cancel
                </button>
              )}
              {voice.playbackPhase === 'playing' && (
                <>
                  <button
                    type="button"
                    onClick={voice.pausePlayback}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#0284c7] hover:bg-[#0284c7]/10 cursor-pointer min-h-[40px]"
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    onClick={voice.stopSpeaking}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#6e6e73] hover:bg-[#f5f5f7] cursor-pointer min-h-[40px]"
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
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0284c7] hover:bg-[#0284c7]/10 cursor-pointer min-h-[40px]"
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
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#6e6e73] hover:text-[#0284c7] hover:bg-[#f5f5f7] cursor-pointer min-h-[40px]"
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
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[#f5f5f7] px-4 py-2.5 text-[15px] text-[#1d1d1f] leading-relaxed whitespace-pre-line break-words">
                      {msg.text}
                    </div>
                  ) : (
                    <div className="max-w-[94%] space-y-1.5">
                      <p className="text-[15px] text-[#1d1d1f] leading-relaxed whitespace-pre-line break-words">
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
                              className="text-left px-3 py-2 rounded-xl border border-[#0284c7]/30 bg-[#0284c7]/[0.05] hover:bg-[#0284c7]/[0.1] text-xs font-medium text-[#1d1d1f] transition-colors cursor-pointer disabled:opacity-50 min-h-[44px] sm:min-h-[38px]"
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
                              className="inline-flex items-center gap-1 py-1 text-xs font-medium text-[#0284c7] hover:text-[#0369a1] cursor-pointer min-h-[34px]"
                            >
                              <Pause className="w-3.5 h-3.5" />
                              <span>Pause</span>
                            </button>
                            <button
                              type="button"
                              onClick={voice.stopSpeaking}
                              className="inline-flex items-center gap-1 py-1 text-xs font-medium text-[#6e6e73] hover:text-[#1d1d1f] cursor-pointer min-h-[34px]"
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
                              className="inline-flex items-center gap-1 py-1 text-xs font-semibold text-[#0284c7] hover:text-[#0369a1] cursor-pointer min-h-[34px]"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>Resume</span>
                            </button>
                            <button
                              type="button"
                              onClick={voice.stopSpeaking}
                              className="inline-flex items-center gap-1 py-1 text-xs font-medium text-[#6e6e73] hover:text-[#1d1d1f] cursor-pointer min-h-[34px]"
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
                            className="inline-flex items-center gap-1 py-1 text-xs font-semibold text-[#0284c7] hover:text-[#0369a1] cursor-pointer min-h-[34px]"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Play</span>
                          </button>
                        ) : isGeneratingThis ? (
                          <button
                            type="button"
                            onClick={voice.stopSpeaking}
                            className="inline-flex items-center gap-1 py-1 text-xs font-medium text-[#6e6e73] hover:text-[#1d1d1f] cursor-pointer min-h-[34px]"
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
                            className="inline-flex items-center gap-1 py-1 text-xs font-medium text-[#86868b] hover:text-[#0284c7] transition-colors cursor-pointer min-h-[34px]"
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
              <div className="text-sm text-[#86868b] py-1">
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
        <div className="mb-2 px-3.5 py-2.5 rounded-xl border border-[#0284c7]/25 bg-[#0284c7]/[0.05] flex flex-wrap sm:flex-nowrap items-center justify-between gap-2">
          <p className="text-xs text-[#1d1d1f] leading-snug min-w-0">
            {voice.usingBrowserFallback
              ? 'Browser voice transcript ready — edit if needed and tap Send.'
              : 'Transcript ready — review or edit below, then tap Send.'}
          </p>
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            <button
              type="button"
              onClick={voice.retryRecording}
              className="px-2.5 py-1 rounded-lg text-xs font-medium text-[#0284c7] hover:bg-[#0284c7]/10 cursor-pointer min-h-[40px]"
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
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-[#6e6e73] hover:text-[#1d1d1f] cursor-pointer"
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
          className={`mb-2.5 px-3.5 py-2.5 rounded-xl border flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 ${
            voice.playbackPhase === 'blocked'
              ? 'border-[#0284c7]/25 bg-[#0284c7]/[0.05]'
              : 'border-rose-200/80 bg-rose-50/40'
          }`}
        >
          <div className="min-w-0 flex-1">
            <p
              className={`text-xs leading-snug ${
                voice.playbackPhase === 'blocked' ? 'text-[#1d1d1f]' : 'text-rose-800'
              }`}
            >
              {activeBannerMessage}
            </p>
            {activeErrorRefId && (
              <p className="text-[10px] text-[#86868b] mt-0.5 select-all truncate">
                Ref · {activeErrorRefId}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {voice.playbackPhase === 'blocked' && latestAssistantMessage && (
              <button
                type="button"
                onClick={() => void voice.playOrResume()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0284c7] hover:bg-[#0284c7]/10 transition-colors cursor-pointer min-h-[40px]"
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
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0284c7] hover:bg-[#0284c7]/10 transition-colors cursor-pointer min-h-[40px]"
              >
                Retry audio
              </button>
            )}

            {voice.voiceError && voice.usingBrowserFallback && (
              <button
                type="button"
                onClick={voice.startBrowserFallbackRecording}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#0284c7] hover:bg-[#0284c7]/10 transition-colors cursor-pointer min-h-[40px]"
              >
                Browser mic
              </button>
            )}

            {voice.voiceError && (
              <button
                type="button"
                onClick={voice.retryRecording}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0284c7] hover:bg-[#0284c7]/10 transition-colors cursor-pointer min-h-[40px]"
              >
                Retry
              </button>
            )}

            {errorNotice?.retryable && errorNotice.failedQuery && (
              <button
                type="button"
                onClick={handleRetryFailedQuery}
                disabled={isSubmitting}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0284c7] hover:bg-[#0284c7]/10 transition-colors cursor-pointer disabled:opacity-50 min-h-[40px]"
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
        className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] md:bottom-0 z-10 liquid-glass pt-2 pb-1"
      >
        <div className="flex items-end gap-1.5 border border-black/[0.12] focus-within:border-[#0284c7] focus-within:ring-2 focus-within:ring-[#0284c7]/15 rounded-2xl bg-white pl-3.5 pr-1.5 py-1.5 transition-all">
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
            placeholder="Message Jarvis AI…"
            disabled={isSubmitting}
            aria-label="Message Jarvis AI"
            className="flex-1 resize-none bg-transparent py-2.5 sm:py-2 text-base sm:text-sm text-[#1d1d1f] placeholder:text-[#86868b] focus:outline-none max-h-[120px] leading-snug disabled:opacity-60"
          />

          <button
            type="button"
            onClick={voice.toggleMicrophone}
            disabled={(isSubmitting || isTranscribing) && voice.voiceState === 'thinking'}
            aria-label={isRecordingOrListening ? 'Stop microphone' : 'Speak a message'}
            className={`min-h-[44px] min-w-[44px] sm:min-h-[40px] sm:min-w-[40px] rounded-xl flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-40 ${
              isRecordingOrListening
                ? 'bg-[#0284c7] text-white'
                : 'text-[#6e6e73] hover:text-[#0284c7] hover:bg-[#f5f5f7]'
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
            className="min-h-[44px] min-w-[44px] sm:min-h-[40px] sm:min-w-[40px] rounded-xl bg-[#0284c7] hover:bg-[#0369a1] text-white flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:bg-[#f5f5f7] disabled:text-[#86868b] disabled:cursor-not-allowed"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </form>
      </div>
    </div>
  );
};
