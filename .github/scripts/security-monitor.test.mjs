import test from 'node:test';
import assert from 'node:assert/strict';
import { pinnedNode, nodeFindings, auditFindings, fingerprint, publish, render, notificationTitle } from './security-monitor.mjs';

const schedule = { v26: { end: '2029-04-30' } };
const releases = [
  { version: 'v26.13.1', security: true },
  { version: 'v26.13.0', security: false },
  { version: 'v26.12.1', security: true },
  { version: 'v27.0.0', security: true },
];
const healthy = { version: '26.13.1', findings: [], errors: [] };

test('mise requires an exact stable version and rejects injected suffixes', () => {
  assert.equal(pinnedNode('[tools]\nnode = "26.13.1"\n'), '26.13.1');
  assert.throws(() => pinnedNode('node = "26; echo secret"'));
  assert.throws(() => pinnedNode('node = "latest"'));
});

test('Node compares numerically within the configured major and reports support expiry', () => {
  assert.equal(nodeFindings('26.12.1', releases, schedule, '2026-11-15')[0].fixed, 'v26.13.1');
  assert.deepEqual(nodeFindings('26.13.1', releases, schedule, '2026-11-15'), []);
  assert.equal(nodeFindings('26.13.1', releases, schedule, '2029-04-30')[0].kind, 'node-eol');
  assert.throws(() => nodeFindings('26.13.1', [], schedule, '2026-11-15'));
  assert.throws(() => nodeFindings('26.13.1', releases, {}, '2026-11-15'));
});

test('audit extracts root advisories once instead of counting affected parents as separate problems', () => {
  const advisory = { name: 'minimatch', url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249', severity: 'moderate', range: '<11.0.1' };
  const item = { via: [advisory], nodes: ['node_modules/minimatch'], fixAvailable: false };
  const audit = { metadata: { vulnerabilities: { total: 2 } }, vulnerabilities: { minimatch: item, parent: { ...item, via: ['minimatch', advisory] } } };
  const result = auditFindings(audit, 'all', { packages: { 'node_modules/minimatch': { version: '10.2.6' } } });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].versions, ['10.2.6']);
  assert.equal(result[0].fix, false);
  assert.throws(() => auditFindings({ error: { code: 'ENETUNREACH' } }, 'all', {}));
  assert.throws(() => auditFindings({ metadata: { vulnerabilities: { total: 1 } }, vulnerabilities: {} }, 'all', {}));
});

test('an unchanged report makes no Issue mutation, while a resolution posts a comment', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  process.env.GITHUB_REPOSITORY = 'example/project';
  process.env.GITHUB_TOKEN = 'test-only';
  process.env.GITHUB_RUN_ID = '42';
  const previous = { ...healthy, errors: ['npm-audit-all-failed'] };
  const issue = { number: 9, user: { login: 'github-actions[bot]' }, body: `<!-- sora-security-monitor:v1 -->\n<!-- state:${fingerprint(previous)} -->` };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method, body: options.body });
    return { ok: true, json: async () => options.method === 'GET' ? [issue] : {} };
  };
  try {
    await publish(previous, false);
    assert.equal(calls.length, 1);
    calls.length = 0;
    await publish(healthy, false);
    assert.deepEqual(calls.map(c => c.method), ['GET', 'POST', 'PATCH']);
    assert.match(calls[1].body, /今回の監査で要対応の検出はありません/);
    calls.length = 0;
    globalThis.fetch = async (url, options) => {
      calls.push(options);
      return { ok: false, status: 403 };
    };
    await assert.rejects(publish(healthy, false), /HTTP 403/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test('test notifications use a separate clearly labelled Issue and preserve the real monitor state', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  process.env.GITHUB_REPOSITORY = 'example/project';
  process.env.GITHUB_TOKEN = 'test-only';
  process.env.GITHUB_RUN_ID = '42';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(options);
    return { ok: true, json: async () => ({ html_url: 'https://github.com/example/project/issues/10' }) };
  };
  try {
    const message = await publish(healthy, true);
    assert.match(message, /\[テストIssueを開く\]\(https:\/\/github\.com\/example\/project\/issues\/10\)\n\nメール/);
    assert.equal(calls.length, 1);
    assert.match(calls[0].body, /通知テスト/);
    assert.doesNotMatch(calls[0].body, /sora-security-monitor:v1/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test('notification wording separates development warnings, failures, fixes and resolution without implying an automatic safe fix', () => {
  const warning = { ...healthy, findings: [{ kind: 'npm', scope: 'development', name: 'minimatch', severity: 'moderate', versions: ['10.2.6'], range: '<11.0.1', fix: true, url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249' }] };
  const text = render(warning, 'https://github.com/example/project/actions/runs/42');
  assert.match(notificationTitle(warning), /開発用ツール/);
  assert.match(text, /^\*\*開発用ツールに脆弱性の警告があります。/);
  assert.match(text, /同じ検査結果の日は追加通知しません/);
  assert.match(text, /安全に適用できるかは/);
  assert.doesNotMatch(text, /修正案 true|"isSemVerMajor"/);
  const failed = { ...healthy, errors: ['npm-audit-all-failed'] };
  assert.match(notificationTitle(failed), /確認失敗/);
  assert.match(render(failed, ''), /検査を完了できていない/);
  assert.doesNotMatch(render(failed, ''), /追加の操作は不要|検出はありません/);
  assert.match(notificationTitle({ ...healthy, findings: [{ kind: 'node-security-release' }] }), /修正版あり/);
  assert.match(notificationTitle(healthy), /解消確認/);
});
