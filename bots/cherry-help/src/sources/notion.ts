import { Client } from '@notionhq/client';

import type { SourceDocument } from '../types';
import { redactSensitiveLines } from './safety';

export async function fetchNotionDocs(env: NodeJS.ProcessEnv = process.env): Promise<SourceDocument[]> {
  const token = env.NOTION_TOKEN?.trim();
  const pageIds = parsePageIds(env.NOTION_PAGE_IDS ?? '');

  if (!token || pageIds.length === 0) {
    return [];
  }

  const notion = new Client({ auth: token });
  const documents: SourceDocument[] = [];

  for (const pageId of pageIds) {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const title = getPageTitle(page);
    const blocks = await readBlocks(notion, pageId);
    const text = redactSensitiveLines(blocks.join('\n\n')).trim();

    if (!text) {
      continue;
    }

    documents.push({
      priority: 3,
      source: {
        kind: 'notion',
        title,
        path: pageId,
        url: getPageUrl(page)
      },
      text
    });
  }

  return documents;
}

function parsePageIds(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function readBlocks(notion: Client, blockId: string): Promise<string[]> {
  const output: string[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor
    });

    for (const block of response.results) {
      const blockText = getBlockText(block);
      if (blockText) {
        output.push(blockText);
      }

      if ('has_children' in block && block.has_children) {
        output.push(...(await readBlocks(notion, block.id)));
      }
    }

    cursor = response.next_cursor ?? undefined;
  } while (cursor);

  return output;
}

function getBlockText(block: unknown): string {
  if (!isRecord(block) || typeof block.type !== 'string') {
    return '';
  }

  const typedValue = block[block.type];
  if (!isRecord(typedValue)) {
    return '';
  }

  const richText = typedValue.rich_text;
  if (!Array.isArray(richText)) {
    return '';
  }

  return richText
    .map((part) => {
      if (!isRecord(part) || !isRecord(part.text) || typeof part.text.content !== 'string') {
        return '';
      }
      return part.text.content;
    })
    .join('')
    .trim();
}

function getPageTitle(page: unknown): string {
  if (!isRecord(page) || !isRecord(page.properties)) {
    return 'Notion page';
  }

  for (const property of Object.values(page.properties)) {
    if (!isRecord(property) || property.type !== 'title' || !Array.isArray(property.title)) {
      continue;
    }

    const title = property.title
      .map((part) => {
        if (!isRecord(part) || !isRecord(part.text) || typeof part.text.content !== 'string') {
          return '';
        }
        return part.text.content;
      })
      .join('')
      .trim();

    if (title) {
      return title;
    }
  }

  return 'Notion page';
}

function getPageUrl(page: unknown): string | undefined {
  if (!isRecord(page) || typeof page.url !== 'string') {
    return undefined;
  }

  return page.url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
