import { AssistantActionType } from './transactionSchemas';
import { XosModuleKey } from './xosKnowledge';

export type ConversationLanguagePreference = 'auto' | 'ml-IN' | 'en-IN';

export type ConversationDateBucket = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older';

export interface AiConversation {
  id: string;
  userId: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  languagePreference: ConversationLanguagePreference;
  lastMessagePreview: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

export interface AiChatMessageMetadata {
  langHint?: 'ml' | 'en' | 'mixed';
  modules?: XosModuleKey[];
  actionType?: AssistantActionType;
}

export interface AiChatMessage {
  id: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'model';
  content: string;
  langHint?: 'ml' | 'en' | 'mixed';
  modules?: XosModuleKey[];
  actionType?: AssistantActionType;
  clientMessageId: string;
  createdAt: string;
}

export interface ConversationGroup {
  label: ConversationDateBucket;
  items: AiConversation[];
}

export interface OrganizedConversations {
  pinned: AiConversation[];
  recentGroups: ConversationGroup[];
  archived: AiConversation[];
}
