import { spawn } from 'node:child_process';

export class GitHubError extends Error {
  constructor(code, { status = null, outcomeUnknown = false } = {}) {
    super(`GitHubの処理を確認できません（${code}）`);
    this.name = 'GitHubError';
    this.code = code;
    this.status = status;
    this.outcome_unknown = outcomeUnknown;
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_OUTPUT = 16 * 1024 * 1024;

function executeGh({ args, input, timeoutMs, responseType = 'json' }) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let bytes = 0;
    let finished = false;
    const finish = (error, output = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error !== null) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new GitHubError('timeout'));
    }, timeoutMs);
    child.on('error', () => finish(new GitHubError('unavailable')));
    child.stdin.on('error', () => {});
    child.stderr.on('data', () => {});
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) {
        child.kill();
        finish(new GitHubError('response_limit'));
      } else chunks.push(chunk);
    });
    child.on('close', (code) => {
      const bytes = Buffer.concat(chunks);
      const output = responseType === 'binary' ? bytes : bytes.toString('utf8');
      if (code !== 0 && (responseType === 'binary' || !/^HTTP\//.test(output))) finish(new GitHubError('transport_failure'));
      else finish(null, output);
    });
    child.stdin.end(input ?? '');
  });
}

function parseResponse(raw) {
  if (raw !== null && typeof raw === 'object' && Number.isInteger(raw.status)) return raw;
  if (typeof raw !== 'string') throw new GitHubError('invalid_response');
  const split = raw.match(/^HTTP\/[^\s]+\s+(\d+)[^\r\n]*\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*)$/);
  if (split === null) throw new GitHubError('invalid_response');
  const headers = Object.fromEntries(split[2].split(/\r?\n/).filter((x) => x.includes(':')).map((line) => {
    const i = line.indexOf(':');
    return [line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()];
  }));
  let data = null;
  if (split[3].trim() !== '') {
    try { data = JSON.parse(split[3]); } catch { throw new GitHubError('invalid_response'); }
  }
  return { status: Number(split[1]), headers, data };
}

/** 書き込みは再送しない。executeの差し替えも同じ制約で試験する。 */
export function createGitHubClient({
  repo,
  execute = executeGh,
  clock = Date.now,
  sleep = pause,
  maxApiCalls = 200,
  timeoutMs = 10_000,
  jobTimeoutMs = 300_000,
} = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? '')) throw new GitHubError('invalid_repository');
  const started = clock();
  let calls = 0;

  async function request(method, path, body, readOnly) {
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method) || typeof path !== 'string' ||
      path.startsWith('-') || path.includes('://') || path.includes('\n') || path.split(/[?#]/, 1)[0].split('/').some((segment) => segment === '.' || segment === '..')) {
      throw new GitHubError('invalid_request');
    }
    for (let attempt = 0; ; attempt += 1) {
      if (calls >= maxApiCalls) throw new GitHubError('api_budget');
      if (clock() - started >= jobTimeoutMs) throw new GitHubError('job_timeout');
      calls += 1;
      let response = null;
      let error = null;
      try {
        const args = ['api', '--include', '--method', method, path, '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
        if (body !== null && body !== undefined) args.push('--input', '-');
        response = parseResponse(await execute({ args, input: body === null || body === undefined ? null : JSON.stringify(body), timeoutMs }));
        if (response.status >= 200 && response.status < 300) return response.data;
        error = new GitHubError('http_failure', { status: response.status, outcomeUnknown: !readOnly && response.status >= 500 });
      } catch (caught) {
        error = new GitHubError(caught instanceof GitHubError ? caught.code : 'transport_failure', {
          status: caught instanceof GitHubError ? caught.status : null,
          outcomeUnknown: !readOnly,
        });
      }
      const retryable = error.status === null || error.status === 429 || error.status >= 500 ||
        (error.status === 403 && response?.headers?.['x-ratelimit-remaining'] === '0');
      if (!readOnly || !retryable || attempt >= 3 || error.code === 'response_limit') throw error;
      const retryAfter = Number(response?.headers?.['retry-after']);
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : 1000 * 2 ** attempt;
      if (clock() - started + delay >= jobTimeoutMs) throw new GitHubError('job_timeout');
      await sleep(delay);
    }
  }

  async function rest(method, path, body = null) {
    return request(method, path.replace(/^\//, ''), body, method === 'GET');
  }

  async function graphql(query, variables = {}) {
    if (typeof query !== 'string' || !/^(?:query\b|\{)/.test(query.trim())) throw new GitHubError('graphql_write_forbidden');
    const response = await request('POST', 'graphql', { query, variables }, true);
    if (!response || response.errors?.length || !response.data) throw new GitHubError('graphql_incomplete');
    return response.data;
  }

  async function paginate(path, { maxPages = 10, maxItems = 1000, key = null, pageSize = 100 } = {}) {
    if (![maxPages, maxItems, pageSize].every((x) => Number.isInteger(x) && x > 0) || pageSize > 100) throw new GitHubError('invalid_limit');
    const items = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const separator = path.includes('?') ? '&' : '?';
      const data = await rest('GET', `${path}${separator}per_page=${pageSize}&page=${page}`);
      const batch = key === null ? data : data?.[key];
      if (!Array.isArray(batch) || data?.incomplete_results === true) throw new GitHubError('pagination_incomplete');
      items.push(...batch);
      if (items.length >= maxItems) throw new GitHubError('item_limit');
      if (batch.length < pageSize) return items;
    }
    throw new GitHubError('page_limit');
  }

  async function downloadArtifact(path, { maxBytes = 65536 } = {}) {
    if (typeof path !== 'string' || !new RegExp(`^/?repos/${repo.replace('.', '\\.')}\\/actions/artifacts/[0-9]+/zip$`).test(path)) throw new GitHubError('invalid_artifact');
    for (let attempt = 0; ; attempt += 1) {
      if (calls >= maxApiCalls) throw new GitHubError('api_budget');
      if (clock() - started >= jobTimeoutMs) throw new GitHubError('job_timeout');
      calls += 1;
      try {
        const data = await execute({ args: ['api', '--method', 'GET', path.replace(/^\//, '')], input: null, timeoutMs, responseType: 'binary' });
        if (!Buffer.isBuffer(data) || data.length > maxBytes) throw new GitHubError('artifact_limit');
        return data;
      } catch (error) {
        if (attempt >= 3 || error?.code === 'artifact_limit') throw new GitHubError(error?.code === 'artifact_limit' ? 'artifact_limit' : 'artifact_unavailable');
        await sleep(1000 * 2 ** attempt);
      }
    }
  }

  return { repo, rest, graphql, paginate, downloadArtifact, get calls() { return calls; } };
}
