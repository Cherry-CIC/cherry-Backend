import 'dotenv/config';

import { App, LogLevel } from '@slack/bolt';
import path from 'node:path';

import { buildAnswerFromResults, EMPTY_QUESTION_MESSAGE, FALLBACK_MESSAGE } from './answer';
import { loadOrBuildIndex, searchIndex } from './retrieval';
import type { BotReply, RuntimeConfig, SearchIndex, SlackQuestion } from './types';

interface BotRuntime {
  config: RuntimeConfig;
  index: SearchIndex;
}

interface SlackMessageLike {
  bot_id?: string;
  channel?: string;
  channel_type?: string;
  subtype?: string;
  text?: string;
  thread_ts?: string;
  ts?: string;
  user?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const botMode = env.BOT_MODE?.trim() || 'retrieve_only';

  if (botMode !== 'retrieve_only') {
    throw new Error('Only BOT_MODE=retrieve_only is supported.');
  }

  return {
    allowedChannelIds: new Set(parseList(env.ALLOWED_CHANNEL_IDS ?? '')),
    botMode,
    indexPath: env.INDEX_PATH ?? path.join(process.cwd(), 'data', 'index.json'),
    nodeEnv: env.NODE_ENV ?? 'development',
    volunteerLeadLabel: env.VOLUNTEER_LEAD_LABEL?.trim() || 'the volunteer lead'
  };
}

export async function createRuntime(env: NodeJS.ProcessEnv = process.env): Promise<BotRuntime> {
  const config = loadConfig(env);
  const index = await loadOrBuildIndex(config.indexPath, env);
  return { config, index };
}

export function createSlackApp(runtime: BotRuntime, env: NodeJS.ProcessEnv = process.env): App {
  assertSlackEnv(env);

  const app = new App({
    appToken: env.SLACK_APP_TOKEN,
    logLevel: LogLevel.INFO,
    socketMode: true,
    token: env.SLACK_BOT_TOKEN
  });

  registerHandlers(app, runtime);
  return app;
}

export function registerHandlers(app: App, runtime: BotRuntime): void {
  app.command('/cherryhelp', async ({ ack, command, respond }) => {
    await ack();

    try {
      const reply = await handleQuestion(
        {
          channelId: command.channel_id,
          entryPoint: 'slash',
          text: command.text,
          userId: command.user_id
        },
        runtime
      );

      if (reply) {
        await respond({
          mrkdwn: true,
          response_type: 'ephemeral',
          text: reply.text
        });
      }
    } catch {
      await respond({
        mrkdwn: true,
        response_type: 'ephemeral',
        text: FALLBACK_MESSAGE
      });
    }
  });

  app.event('app_mention', async ({ client, context, event }) => {
    const message = event as SlackMessageLike;

    if (shouldIgnoreMessage(message, context.botUserId)) {
      return;
    }

    const reply = await safeHandleQuestion(
      {
        channelId: message.channel,
        entryPoint: 'mention',
        text: stripBotMention(message.text ?? ''),
        userId: message.user
      },
      runtime
    );

    if (!reply || !message.channel) {
      return;
    }

    await client.chat.postMessage({
      channel: message.channel,
      mrkdwn: true,
      text: reply.text,
      thread_ts: message.thread_ts ?? message.ts
    });
  });

  app.message(async ({ client, context, message }) => {
    const slackMessage = message as SlackMessageLike;

    if (slackMessage.channel_type !== 'im' || shouldIgnoreMessage(slackMessage, context.botUserId)) {
      return;
    }

    const reply = await safeHandleQuestion(
      {
        channelId: slackMessage.channel,
        entryPoint: 'dm',
        text: slackMessage.text ?? '',
        userId: slackMessage.user
      },
      runtime
    );

    if (!reply || !slackMessage.channel) {
      return;
    }

    await client.chat.postMessage({
      channel: slackMessage.channel,
      mrkdwn: true,
      text: reply.text
    });
  });
}

export async function handleQuestion(question: SlackQuestion, runtime: BotRuntime): Promise<BotReply | null> {
  if (!isAllowedChannel(question.channelId, runtime.config)) {
    return null;
  }

  const text = normaliseQuestionText(question.text);
  if (!text) {
    return { text: EMPTY_QUESTION_MESSAGE };
  }

  const results = searchIndex(runtime.index, text, 3);
  return {
    text: buildAnswerFromResults(text, results, runtime.config.volunteerLeadLabel)
  };
}

export function shouldIgnoreMessage(message: SlackMessageLike, botUserId?: string): boolean {
  if (message.bot_id) {
    return true;
  }

  if (message.subtype) {
    return true;
  }

  if (botUserId && message.user === botUserId) {
    return true;
  }

  return false;
}

export function stripBotMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/gi, ' ').trim();
}

export function normaliseQuestionText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function isAllowedChannel(channelId: string | undefined, config: RuntimeConfig): boolean {
  if (config.allowedChannelIds.size === 0) {
    return true;
  }

  if (!channelId) {
    return false;
  }

  return config.allowedChannelIds.has(channelId);
}

async function safeHandleQuestion(question: SlackQuestion, runtime: BotRuntime): Promise<BotReply | null> {
  try {
    return await handleQuestion(question, runtime);
  } catch {
    return { text: FALLBACK_MESSAGE };
  }
}

function parseList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function assertSlackEnv(env: NodeJS.ProcessEnv): void {
  const missing = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'].filter((key) => !env[key]?.trim());

  if (missing.length > 0) {
    throw new Error(`Missing required Slack environment variables: ${missing.join(', ')}.`);
  }
}

async function start(): Promise<void> {
  const runtime = await createRuntime();
  const app = createSlackApp(runtime);
  await app.start();
  console.log('cherry-help is running in Socket Mode.');
}

if (require.main === module) {
  start().catch((error: unknown) => {
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.error(`cherry-help failed to start: ${name}.`);
    process.exit(1);
  });
}
