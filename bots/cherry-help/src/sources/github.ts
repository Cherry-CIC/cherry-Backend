import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { SourceDocument } from '../types';

const APPROVED_ROOT_FILES = new Set(['README.md', 'AGENTS.md', 'CONTRIBUTING.md']);
const APPROVED_DIRECTORIES = ['docs/', '.devcontainer/'];
const APPROVED_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.json', '.yml', '.yaml']);
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'coverage', 'data']);
const MAX_FILE_SIZE_BYTES = 256 * 1024;

interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

interface RepoSpec {
  owner: string;
  repo: string;
  ref?: string;
}

export async function readApprovedLocalDocs(rootDir: string): Promise<SourceDocument[]> {
  const documents: SourceDocument[] = [];
  const absoluteRoot = path.resolve(rootDir);

  for (const filePath of await walkFiles(absoluteRoot)) {
    const relativePath = toPosixPath(path.relative(absoluteRoot, filePath));

    if (!isApprovedDocPath(relativePath) || isBlockedPath(relativePath)) {
      continue;
    }

    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      continue;
    }

    const text = await fs.readFile(filePath, 'utf8');
    documents.push({
      priority: 2,
      source: {
        kind: 'github',
        title: relativePath,
        path: relativePath
      },
      text: redactSensitiveLines(text)
    });
  }

  return documents;
}

export async function fetchGitHubDocs(env: NodeJS.ProcessEnv = process.env): Promise<SourceDocument[]> {
  const token = env.GITHUB_TOKEN?.trim();
  const repoSpecs = parseRepoSpecs(env.GITHUB_REPOS ?? '');

  if (!token || repoSpecs.length === 0) {
    return [];
  }

  const documents: SourceDocument[] = [];

  for (const repoSpec of repoSpecs) {
    const ref = repoSpec.ref ?? (await fetchDefaultBranch(repoSpec, token));
    const tree = await fetchRepoTree(repoSpec, ref, token);

    for (const item of tree) {
      if (item.type !== 'blob' || !isApprovedDocPath(item.path) || isBlockedPath(item.path)) {
        continue;
      }

      if (item.size && item.size > MAX_FILE_SIZE_BYTES) {
        continue;
      }

      const text = await fetchRepoFile(repoSpec, item.path, ref, token);
      documents.push({
        priority: 2,
        source: {
          kind: 'github',
          title: `${repoSpec.owner}/${repoSpec.repo}`,
          path: item.path,
          url: `https://github.com/${repoSpec.owner}/${repoSpec.repo}/blob/${ref}/${item.path}`
        },
        text: redactSensitiveLines(text)
      });
    }
  }

  return documents;
}

export function isApprovedDocPath(filePath: string): boolean {
  const cleanPath = toPosixPath(filePath);
  const basename = path.posix.basename(cleanPath);
  const extension = path.posix.extname(cleanPath);

  if (!APPROVED_EXTENSIONS.has(extension)) {
    return false;
  }

  if (APPROVED_ROOT_FILES.has(cleanPath) || APPROVED_ROOT_FILES.has(basename)) {
    return true;
  }

  return APPROVED_DIRECTORIES.some((directory) => cleanPath.startsWith(directory));
}

function parseRepoSpecs(value: string): RepoSpec[] {
  return value
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [repoPart, refPart] = part.split(/[#@:]/, 2);
      const [owner, repo] = repoPart.split('/');

      if (!owner || !repo) {
        throw new Error('GITHUB_REPOS must contain values like owner/repo or owner/repo#branch.');
      }

      return {
        owner,
        repo,
        ref: refPart
      };
    });
}

async function fetchDefaultBranch(repoSpec: RepoSpec, token: string): Promise<string> {
  const data = await githubRequest<{ default_branch: string }>(
    `https://api.github.com/repos/${repoSpec.owner}/${repoSpec.repo}`,
    token
  );
  return data.default_branch;
}

async function fetchRepoTree(repoSpec: RepoSpec, ref: string, token: string): Promise<GitHubTreeItem[]> {
  const data = await githubRequest<{ tree: GitHubTreeItem[] }>(
    `https://api.github.com/repos/${repoSpec.owner}/${repoSpec.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    token
  );
  return data.tree ?? [];
}

async function fetchRepoFile(repoSpec: RepoSpec, filePath: string, ref: string, token: string): Promise<string> {
  const data = await githubRequest<{ content?: string; encoding?: string }>(
    `https://api.github.com/repos/${repoSpec.owner}/${repoSpec.repo}/contents/${encodePath(filePath)}?ref=${encodeURIComponent(ref)}`,
    token
  );

  if (!data.content || data.encoding !== 'base64') {
    return '';
  }

  return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
}

async function githubRequest<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cherry-help-bot'
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function walkFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries: Array<import('node:fs').Dirent>;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const nextPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(nextPath);
      } else if (entry.isFile()) {
        results.push(nextPath);
      }
    }
  }

  await walk(rootDir);
  return results;
}

function isBlockedPath(filePath: string): boolean {
  const cleanPath = toPosixPath(filePath).toLowerCase();
  return (
    cleanPath.includes('/.env') ||
    cleanPath === '.env' ||
    cleanPath.endsWith('.env') ||
    cleanPath.includes('node_modules/') ||
    cleanPath.includes('/dist/') ||
    cleanPath.includes('/coverage/')
  );
}

function redactSensitiveLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/\b(xoxb|xapp|sk_live|ghp_|github_pat_|password\s*=|secret\s*=|token\s*=)\b/i.test(line))
    .join('\n');
}

function encodePath(filePath: string): string {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}
