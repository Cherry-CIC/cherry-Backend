import { buildAnswerFromResults, FALLBACK_MESSAGE } from '../src/answer';
import {
  handleQuestion,
  isAllowedChannel,
  loadConfig,
  shouldIgnoreMessage,
  stripBotMention
} from '../src/app';
import { createIndexFromDocuments, searchIndex } from '../src/retrieval';
import { isApprovedDocPath } from '../src/sources/github';
import type { RuntimeConfig, SearchIndex } from '../src/types';

function createTestRuntime(overrides: Partial<RuntimeConfig> = {}): {
  config: RuntimeConfig;
  index: SearchIndex;
} {
  const config = {
    ...loadConfig({
      BOT_MODE: 'retrieve_only',
      VOLUNTEER_LEAD_LABEL: 'the volunteer lead'
    }),
    ...overrides
  };

  const index = createIndexFromDocuments([
    {
      priority: 1,
      source: {
        kind: 'faq',
        path: 'content/volunteer-faq.md',
        title: 'Volunteer FAQ'
      },
      text: '## Running locally\n\nTo run the backend locally, install dependencies, copy `.env.example`, add local test values, then run the development command in the backend README.'
    }
  ]);

  return { config, index };
}

describe('cherry-help bot behaviour', () => {
  it('ignores bot messages', () => {
    expect(shouldIgnoreMessage({ bot_id: 'B123', text: 'hello' })).toBe(true);
    expect(shouldIgnoreMessage({ subtype: 'bot_message', text: 'hello' })).toBe(true);
    expect(shouldIgnoreMessage({ text: 'hello', user: 'U1' }, 'U1')).toBe(true);
  });

  it('answers slash command questions', async () => {
    const runtime = createTestRuntime();
    const reply = await handleQuestion(
      {
        channelId: 'C1',
        entryPoint: 'slash',
        text: 'how do I run the backend locally?',
        userId: 'U1'
      },
      runtime
    );

    expect(reply?.text).toContain('run the backend locally');
    expect(reply?.text).toContain('Source: Volunteer FAQ');
  });

  it('answers app mentions after removing the bot mention', async () => {
    const runtime = createTestRuntime();
    const reply = await handleQuestion(
      {
        channelId: 'C1',
        entryPoint: 'mention',
        text: stripBotMention('<@UHELP> how do I run the backend locally?'),
        userId: 'U1'
      },
      runtime
    );

    expect(reply?.text).toContain('Source: Volunteer FAQ');
  });

  it('answers direct messages', async () => {
    const runtime = createTestRuntime();
    const reply = await handleQuestion(
      {
        channelId: 'D1',
        entryPoint: 'dm',
        text: 'Where are the local setup notes?',
        userId: 'U1'
      },
      runtime
    );

    expect(reply?.text).toContain('Source: Volunteer FAQ');
  });

  it('refuses secret requests', () => {
    const index = createTestRuntime().index;
    const results = searchIndex(index, 'what is the Slack token?', 3);
    const answer = buildAnswerFromResults('what is the Slack token?', results);

    expect(answer).toContain('I cannot help with secrets');
    expect(answer).not.toContain('Source:');
  });

  it('falls back when no source exists', async () => {
    const runtime = createTestRuntime();
    const reply = await handleQuestion(
      {
        channelId: 'C1',
        entryPoint: 'slash',
        text: 'Which biscuits are in the office cupboard?',
        userId: 'U1'
      },
      runtime
    );

    expect(reply?.text).toBe(FALLBACK_MESSAGE);
  });

  it('cites at least one source when answering', async () => {
    const runtime = createTestRuntime();
    const reply = await handleQuestion(
      {
        channelId: 'C1',
        entryPoint: 'slash',
        text: 'run backend locally',
        userId: 'U1'
      },
      runtime
    );

    expect(reply?.text).toMatch(/Source: .+/);
  });

  it('searches the FAQ before lower-priority sources', () => {
    const index = createIndexFromDocuments([
      {
        priority: 1,
        source: {
          kind: 'faq',
          path: 'content/volunteer-faq.md',
          title: 'Volunteer FAQ'
        },
        text: '## Local setup\n\nUse the confirmed volunteer setup notes.'
      },
      {
        priority: 3,
        source: {
          kind: 'notion',
          path: 'notion-page',
          title: 'Detailed Notion page'
        },
        text: '## Local setup\n\nUse the detailed local setup notes with many extra local setup local setup terms.'
      }
    ]);

    const results = searchIndex(index, 'local setup', 3);

    expect(results[0]?.chunk.source.kind).toBe('faq');
  });

  it('does not answer outside allowed channels', async () => {
    const runtime = createTestRuntime({
      allowedChannelIds: new Set(['C_ALLOWED'])
    });

    expect(isAllowedChannel('C_BLOCKED', runtime.config)).toBe(false);

    const reply = await handleQuestion(
      {
        channelId: 'C_BLOCKED',
        entryPoint: 'slash',
        text: 'run backend locally',
        userId: 'U1'
      },
      runtime
    );

    expect(reply).toBeNull();
  });

  it('only treats approved documentation paths as indexable', () => {
    expect(isApprovedDocPath('README.md')).toBe(true);
    expect(isApprovedDocPath('AGENTS.md')).toBe(true);
    expect(isApprovedDocPath('docs/README.md')).toBe(true);
    expect(isApprovedDocPath('.devcontainer/devcontainer.json')).toBe(true);
    expect(isApprovedDocPath('src/README.md')).toBe(false);
    expect(isApprovedDocPath('package.json')).toBe(false);
  });
});
