import type { RetrievalResult } from './types';

export const FALLBACK_MESSAGE =
  'I do not know from the approved cherry docs yet. Please ask the volunteer lead, and we can add the answer to the volunteer FAQ afterwards.';

export const EMPTY_QUESTION_MESSAGE =
  'Please add a question so I can look in the approved cherry docs.';

const REFUSAL_MESSAGE =
  'I cannot help with secrets, credentials, personal data, admin bypasses or unsafe changes. Please ask the volunteer lead to handle this safely.';

const SECRET_PATTERNS = [
  /\b(slack|github|notion|stripe|firebase|sendcloud)?\s*(token|secret|password|credential|api\s*key|client\s*secret|signing\s*secret|verification\s*token)\b/i,
  /\b(xoxb|xapp|sk_live|sk_test|ghp_|github_pat_)\b/i,
  /\b(show|print|paste|send|share|reveal|tell\s+me|what\s+is|what's|read)\b.*\b(\.env|env\s*file|environment\s*file)\b/i,
  /\b(\.env|env\s*file|environment\s*file)\b.*\b(show|print|paste|send|share|reveal|contents|values)\b/i
];

const PERSONAL_DATA_PATTERNS = [
  /\b(customer|donor|user|volunteer)\b.*\b(address|phone|email|personal\s*data|private\s*data|bank|payment\s*details)\b/i,
  /\b(personal\s*data|private\s*messages|private\s*slack|donor\s*data|customer\s*data)\b/i
];

const UNSAFE_ADMIN_PATTERNS = [
  /\b(bypass|disable|work\s*around|override)\b.*\b(admin|security|permission|access|approval|auth|authentication)\b/i,
  /\b(make\s+me\s+admin|grant\s+admin|skip\s+approval|disable\s+security)\b/i
];

export function isSensitiveRequest(question: string): boolean {
  const text = question.trim();
  return [...SECRET_PATTERNS, ...PERSONAL_DATA_PATTERNS, ...UNSAFE_ADMIN_PATTERNS].some((pattern) =>
    pattern.test(text)
  );
}

export function buildFallbackAnswer(): string {
  return FALLBACK_MESSAGE;
}

export function buildAnswerFromResults(
  question: string,
  results: RetrievalResult[],
  volunteerLeadLabel = 'the volunteer lead'
): string {
  const cleanQuestion = question.trim();

  if (!cleanQuestion) {
    return EMPTY_QUESTION_MESSAGE;
  }

  if (isSensitiveRequest(cleanQuestion)) {
    return REFUSAL_MESSAGE;
  }

  const best = results[0];
  if (!best) {
    return buildFallbackAnswer();
  }

  const snippet = formatSnippet(best.chunk.text);
  const source = formatSource(best.chunk.source);

  return `${snippet}\n\nSource: ${source}\n\nIf this does not look right, ask ${volunteerLeadLabel} to check it.`;
}

function formatSnippet(text: string): string {
  const compact = text
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (compact.length <= 900) {
    return compact;
  }

  return `${compact.slice(0, 897).trim()}...`;
}

function formatSource(source: RetrievalResult['chunk']['source']): string {
  const section = source.section ? `, ${source.section}` : '';
  const path = source.path ? `, ${source.path}` : '';
  const url = source.url ? ` (${source.url})` : '';
  return `${source.title}${section}${path}${url}`;
}
