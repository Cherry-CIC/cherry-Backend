import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { IndexedChunk, SearchIndex, SourceCitation, SourceDocument, RetrievalResult } from '../types';
import { fetchGitHubDocs, readApprovedLocalDocs } from '../sources/github';
import { fetchNotionDocs } from '../sources/notion';

const STOP_WORDS = new Set([
  'a',
  'about',
  'after',
  'all',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'get',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'me',
  'of',
  'on',
  'or',
  'our',
  'please',
  'should',
  'the',
  'this',
  'to',
  'we',
  'what',
  'when',
  'where',
  'with',
  'you'
]);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

export function createIndexFromDocuments(documents: SourceDocument[]): SearchIndex {
  const chunks = documents.flatMap((document) => chunkDocument(document));
  return {
    builtAt: new Date().toISOString(),
    chunks
  };
}

export async function buildIndexFromEnvironment(env: NodeJS.ProcessEnv = process.env): Promise<SearchIndex> {
  const botRoot = process.cwd();
  const faqPath = path.join(botRoot, 'content', 'volunteer-faq.md');
  const documents: SourceDocument[] = [];

  documents.push(...(await readFaqDocument(faqPath)));
  documents.push(...(await readApprovedLocalDocs(env.LOCAL_DOCS_ROOT ?? botRoot)));
  documents.push(...(await fetchGitHubDocs(env)));
  documents.push(...(await fetchNotionDocs(env)));

  return createIndexFromDocuments(documents);
}

export async function loadOrBuildIndex(indexPath: string, env: NodeJS.ProcessEnv = process.env): Promise<SearchIndex> {
  try {
    return await loadIndex(indexPath);
  } catch {
    return buildIndexFromEnvironment(env);
  }
}

export async function loadIndex(indexPath: string): Promise<SearchIndex> {
  const raw = await fs.readFile(indexPath, 'utf8');
  const parsed = JSON.parse(raw) as SearchIndex;

  return {
    builtAt: parsed.builtAt,
    chunks: parsed.chunks.map((chunk) => ({
      ...chunk,
      tokens: chunk.tokens.length > 0 ? chunk.tokens : tokenise(chunk.text)
    }))
  };
}

export async function saveIndex(indexPath: string, index: SearchIndex): Promise<void> {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

export function searchIndex(index: SearchIndex, query: string, limit = 3): RetrievalResult[] {
  const queryTokens = [...new Set(tokenise(query))];
  if (queryTokens.length === 0) {
    return [];
  }

  const scoredResults = index.chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, query, queryTokens) }))
    .filter((result) => result.score >= 1.5);

  for (const priority of [1, 2, 3]) {
    const priorityResults = scoredResults
      .filter((result) => result.chunk.priority === priority)
      .sort((left, right) => right.score - left.score);

    if (priorityResults.length > 0) {
      return priorityResults.slice(0, limit);
    }
  }

  return [];
}

function chunkDocument(document: SourceDocument): IndexedChunk[] {
  const sections = splitMarkdownSections(document.text, document.source);
  return sections.flatMap((section, sectionIndex) => {
    const paragraphs = section.text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    const grouped = groupParagraphs(paragraphs, 900);

    return grouped.map((text, chunkIndex) => {
      const source = {
        ...document.source,
        section: section.heading ?? document.source.section
      };

      return {
        id: stableChunkId(source, sectionIndex, chunkIndex),
        text,
        source,
        priority: document.priority,
        tokens: tokenise(`${source.title} ${source.section ?? ''} ${text}`)
      };
    });
  });
}

function splitMarkdownSections(text: string, source: SourceCitation): Array<{ heading?: string; text: string }> {
  const sections: Array<{ heading?: string; text: string }> = [];
  let heading = source.section;
  let buffer: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);

    if (headingMatch && buffer.some((value) => value.trim().length > 0)) {
      sections.push({ heading, text: buffer.join('\n').trim() });
      heading = headingMatch[2].trim();
      buffer = [line];
      continue;
    }

    if (headingMatch) {
      heading = headingMatch[2].trim();
    }

    buffer.push(line);
  }

  if (buffer.some((value) => value.trim().length > 0)) {
    sections.push({ heading, text: buffer.join('\n').trim() });
  }

  return sections;
}

function groupParagraphs(paragraphs: string[], maxLength: number): string[] {
  const groups: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length > maxLength && current) {
      groups.push(current);
      current = paragraph;
      continue;
    }

    current = candidate;
  }

  if (current) {
    groups.push(current);
  }

  return groups;
}

function scoreChunk(chunk: IndexedChunk, query: string, queryTokens: string[]): number {
  const tokenCounts = new Map<string, number>();
  for (const token of chunk.tokens) {
    tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  }

  let matchedTokens = 0;
  let occurrenceScore = 0;
  for (const token of queryTokens) {
    const count = tokenCounts.get(token) ?? 0;
    if (count > 0) {
      matchedTokens += 1;
      occurrenceScore += Math.min(count, 4) * 0.35;
    }
  }

  if (matchedTokens === 0) {
    return 0;
  }

  const titleTokens = new Set(tokenise(`${chunk.source.title} ${chunk.source.section ?? ''}`));
  const titleMatches = queryTokens.filter((token) => titleTokens.has(token)).length;
  const phraseBoost = chunk.text.toLowerCase().includes(query.trim().toLowerCase()) ? 4 : 0;
  const priorityBoost = (4 - chunk.priority) * 0.1;

  return matchedTokens * 2 + occurrenceScore + titleMatches + phraseBoost + priorityBoost;
}

function stableChunkId(source: SourceCitation, sectionIndex: number, chunkIndex: number): string {
  const sourceId = [source.kind, source.path, source.url, source.title, source.section]
    .filter(Boolean)
    .join(':')
    .replace(/[^a-zA-Z0-9:_-]+/g, '-');
  return `${sourceId}:${sectionIndex}:${chunkIndex}`;
}

async function readFaqDocument(faqPath: string): Promise<SourceDocument[]> {
  try {
    const text = await fs.readFile(faqPath, 'utf8');
    return [
      {
        priority: 1,
        source: {
          kind: 'faq',
          title: 'Volunteer FAQ',
          path: 'content/volunteer-faq.md'
        },
        text
      }
    ];
  } catch {
    return [];
  }
}
