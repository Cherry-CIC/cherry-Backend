export type SourceKind = 'faq' | 'github' | 'notion';

export type EntryPoint = 'slash' | 'mention' | 'dm';

export interface SourceCitation {
  kind: SourceKind;
  title: string;
  path?: string;
  url?: string;
  section?: string;
}

export interface SourceDocument {
  source: SourceCitation;
  text: string;
  priority: number;
}

export interface IndexedChunk {
  id: string;
  text: string;
  source: SourceCitation;
  priority: number;
  tokens: string[];
}

export interface SearchIndex {
  builtAt: string;
  chunks: IndexedChunk[];
}

export interface RetrievalResult {
  chunk: IndexedChunk;
  score: number;
}

export interface RuntimeConfig {
  allowedChannelIds: Set<string>;
  botMode: 'retrieve_only';
  indexPath: string;
  nodeEnv: string;
  volunteerLeadLabel: string;
}

export interface SlackQuestion {
  channelId?: string;
  entryPoint: EntryPoint;
  text: string;
  userId?: string;
}

export interface BotReply {
  text: string;
}
