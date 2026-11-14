import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const marker = '<!-- sora-security-monitor:v1 -->';
const indexUrl = 'https://nodejs.org/dist/index.json';
const scheduleUrl = 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json';

export function pinnedNode(text) {
  const version = text.match(/^node\s*=\s*"(\d+\.\d+\.\d+)"\s*$/m)?.[1];
  if (!version) throw new Error('Node.jsの固定版をmise.tomlから取得できません');
  return version;
}

function compare(a, b) {
  const left = a.replace(/^v/, '').split('.').map(Number);
  const right = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function nodeFindings(version, releases, schedule, today) {
  if (!Array.isArray(releases) || !releases.some(r => r.version === `v${version}`)) {
    throw new Error('Node.js公式配布一覧に指定版がありません');
  }
  const major = version.split('.')[0];
  const line = schedule[`v${major}`];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(line?.end || '')) throw new Error('サポート期限を確認できません');
  const fixes = releases.filter(r => r.security === true && new RegExp(`^v${major}\\.\\d+\\.\\d+$`).test(r.version) && compare(r.version, version) > 0);
  fixes.sort((a, b) => compare(b.version, a.version));
  const findings = [];
  if (today >= line.end) findings.push({ kind: 'node-eol', version, end: line.end });
  if (fixes.length) findings.push({ kind: 'node-security-release', version, fixed: fixes[0].version });
  return findings;
}

export function auditFindings(audit, scope, lock) {
  if (audit.error || !audit.metadata?.vulnerabilities || !audit.vulnerabilities) throw new Error('監査結果を確認できません');
  const results = new Map();
  for (const item of Object.values(audit.vulnerabilities)) {
    if (!Array.isArray(item.via)) throw new Error('監査形式が変わりました');
    for (const advisory of item.via.filter(v => typeof v === 'object')) {
      if (!/^https:\/\/github.com\/advisories\/GHSA-[\w-]+$/.test(advisory.url || '')) throw new Error('アドバイザリURLを確認できません');
      const affected = audit.vulnerabilities[advisory.name];
      const versions = [...new Set((affected?.nodes || []).map(p => lock.packages[p]?.version).filter(Boolean))].sort();
      results.set(advisory.url, { kind: 'npm', scope, url: advisory.url, name: advisory.name, severity: advisory.severity, range: advisory.range, versions, fix: affected?.fixAvailable ?? false });
    }
  }
  if (audit.metadata.vulnerabilities.total > 0 && !results.size) throw new Error('監査警告の根拠を取得できません');
  return [...results.values()].sort((a, b) => a.url.localeCompare(b.url));
}

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function collect() {
  const findings = [];
  const errors = [];
  const version = pinnedNode(await readFile('mise.toml', 'utf8'));
  if (process.versions.node !== version) errors.push('node-runtime-mismatch');
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  for (const [scope, flags] of [['all', []], ['runtime', ['--omit=dev']]]) {
    try {
      const result = spawnSync('npm', ['audit', '--json', '--ignore-scripts', '--fetch-timeout=20000', '--fetch-retries=0', ...flags], { encoding: 'utf8', timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
      if (![0, 1].includes(result.status) || result.error) throw new Error('監査コマンド失敗');
      findings.push(...auditFindings(JSON.parse(result.stdout), scope, lock));
    } catch { errors.push(`npm-audit-${scope}-failed`); }
  }
  try {
    const [releases, schedule] = await Promise.all([json(indexUrl), json(scheduleUrl)]);
    findings.push(...nodeFindings(version, releases, schedule, new Date().toISOString().slice(0, 10)));
  } catch { errors.push('node-official-check-failed'); }
  const runtime = new Set(findings.filter(f => f.scope === 'runtime').map(f => f.url));
  const normalized = findings.filter(f => f.scope !== 'all' || !runtime.has(f.url)).map(f => f.scope === 'all' ? { ...f, scope: errors.includes('npm-audit-runtime-failed') ? 'unconfirmed' : 'development' } : f);
  return { version, findings: normalized, errors };
}

export function fingerprint(report) {
  return createHash('sha256').update(JSON.stringify(report)).digest('hex');
}

export function notificationTitle(report) {
  if (report.errors.length) return '【確認失敗】Sora監視を確認してください';
  if (report.findings.some(f => f.kind === 'node-eol')) return '【更新が必要】Node.jsのサポート期限が終了';
  if (report.findings.some(f => f.kind === 'node-security-release')) return '【修正版あり】Node.jsの更新を確認してください';
  if (report.findings.some(f => f.scope === 'runtime' || f.scope === 'unconfirmed')) return '【影響確認】実行用または用途未確認の依存関係に脆弱性';
  if (report.findings.length) return '【更新確認】開発用ツールに脆弱性';
  return '【解消確認】今回の検査で要対応の検出なし';
}

export function render(report, runUrl) {
  let conclusion = '今回の監査で要対応の検出はありません。追加の操作は不要です。';
  let action = '今後も定期検査を続けます。';
  if (report.errors.length) {
    conclusion = '検査を完了できていない項目があります。';
    action = '下の実行結果で失敗箇所を確認し、通信や設定を確認してから再実行してください。';
  } else if (report.findings.some(f => f.kind === 'node-eol')) {
    conclusion = '指定しているNode.jsのサポート期限が終了しています。';
    action = 'サポート中のNode.jsへの更新候補を検証してください。';
  } else if (report.findings.some(f => f.kind === 'node-security-release')) {
    conclusion = '指定版より新しいNode.jsのセキュリティ修正版が公開されています。';
    action = '修正版の変更内容を確認し、更新候補を検証してください。';
  } else if (report.findings.some(f => f.scope === 'runtime' || f.scope === 'unconfirmed')) {
    conclusion = '実行用、または用途を確認できていない依存関係に脆弱性が見つかりました。';
    action = '利用している版・公開環境・悪用条件を照合し、更新の必要性と優先度を確認してください。';
  } else if (report.findings.length) {
    conclusion = '開発用ツールに脆弱性の警告があります。';
    action = '依存元の対応版と互換性を確認してください。対応版待ちと判断済みの問題は、その判断に沿って監視を続けてください。';
  }
  const lines = [
    `**${conclusion}**`, '',
    `**次の対応** — ${action}`, '',
    '同じ検査結果の日は追加通知しません。結果に変化があったときに、このIssueへ記録します。', '',
    '### 検出した内容', '',
  ];
  if (!report.findings.length && !report.errors.length) lines.push('今回の検査で脆弱性や未適用のNode.js修正版の検出はありません。');
  const severities = { critical: '緊急（Critical）', high: '高（High）', moderate: '中程度（Moderate）', low: '低（Low）', info: '参考情報' };
  for (const finding of report.findings) {
    if (finding.kind === 'npm') {
      const scope = { runtime: '実行用依存', development: '開発用ツール', unconfirmed: '用途の区分未確認' }[finding.scope];
      let fix = 'npmから更新案は提示されていません。依存元の対応状況を確認してください。';
      if (finding.fix) fix = 'npmは更新案を提示しています。安全に適用できるかは、依存元の対応と検証結果を確認して判断します。';
      if (typeof finding.fix === 'object' && finding.fix?.version) {
        fix = `npmの更新候補は${finding.fix.name} ${finding.fix.version}です。互換性の確認と検証が必要です。`;
      }
      lines.push(`- **${finding.name}** — ${scope}、重要度は${severities[finding.severity] || '未確認'}。導入版は${finding.versions.join(', ') || '取得できず'}。`, `  ${fix}`, `  [脆弱性の詳細](${finding.url})`, '');
    } else if (finding.kind === 'node-security-release') {
      lines.push(`- **Node.js** — 指定版${finding.version}、セキュリティ修正版${finding.fixed}。`, `  [公式の修正内容](https://nodejs.org/en/blog/release/${finding.fixed})`, '');
    } else if (finding.kind === 'node-eol') {
      lines.push(`- **Node.js ${finding.version}** — サポート期限は${finding.end}です。`, '  [公式サポート期間](https://github.com/nodejs/Release#release-schedule)', '');
    }
  }
  const errors = {
    'node-runtime-mismatch': '検査に使ったNode.jsと指定版が一致しません。',
    'npm-audit-all-failed': '開発用を含む依存関係の監査に失敗しました。',
    'npm-audit-runtime-failed': '実行用依存の監査に失敗し、用途の区分を確定できませんでした。',
    'node-official-check-failed': 'Node.js公式の修正版またはサポート期限を確認できませんでした。',
    'monitor-collection-failed': '検査結果の収集に失敗しました。',
    'monitor-report-missing': '通知に必要な検査結果を取得できませんでした。',
  };
  for (const code of report.errors) lines.push(`- **確認失敗** — ${errors[code] || '詳細は実行結果を確認してください。'}`);
  lines.push('', `Node.js指定版は${report.version || '取得できず'}。`, `[検査の実行結果](${runUrl}) · [Node.js公式告知](https://nodejs.org/en/blog/vulnerability/)`);
  return lines.join('\n');
}

export async function publish(report, test) {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !token) throw new Error('GitHub設定が不足しています');
  const root = `https://api.github.com/repos/${repository}`;
  const runUrl = `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  async function api(path, method = 'GET', body) {
    return json(root + path, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  if (test) {
    const issue = await api('/issues', 'POST', { title: '【通知テスト】Sora監視のメール受信確認', body: `これは通知経路のテストです。脆弱性検出ではありません。\n\n${runUrl}\n\nGitHubからのメールとアプリ通知が届いたか確認後、このIssueを閉じてください。` });
    return `[テストIssueを開く](${issue.html_url})\n\nメール到達は受信側で確認してください。`;
  }
  const matches = [];
  for (let page = 1; ; page++) {
    const issues = await api(`/issues?state=all&creator=github-actions%5Bbot%5D&per_page=100&page=${page}`);
    for (const issue of issues) if (!issue.pull_request && issue.user?.login === 'github-actions[bot]' && issue.body?.startsWith(marker)) matches.push(issue);
    if (issues.length < 100) break;
    if (page >= 100) throw new Error('Issue検索の上限に達しました');
  }
  if (matches.length > 1) throw new Error('監視Issueが複数あります');
  const hash = fingerprint(report);
  const issue = matches[0];
  const previous = issue?.body.match(/<!-- state:([a-f0-9]{64}) -->/)?.[1];
  const text = render(report, runUrl);
  if (previous === hash) return '検出内容の変化がないため通知を省略しました。';
  if (!issue && !report.findings.length && !report.errors.length) return '今回の検査で要対応の検出はありません。';
  const body = `${marker}\n<!-- state:${hash} -->\n${text}`;
  if (!issue) {
    const created = await api('/issues', 'POST', { title: notificationTitle(report), body });
    return `監視Issueを作成しました ${created.html_url}`;
  }
  // コメントを先に追加する。途中で失敗した場合は通知漏れより再通知を優先する。
  await api(`/issues/${issue.number}/comments`, 'POST', { body: `監視結果が変わりました。\n\n${text}` });
  await api(`/issues/${issue.number}`, 'PATCH', { title: notificationTitle(report), body, state: 'open' });
  return `監視Issueを更新しました ${issue.html_url}`;
}

async function main() {
  const reportPath = process.env.MONITOR_REPORT;
  if (!reportPath) throw new Error('MONITOR_REPORTが必要です');
  if (process.argv.includes('--collect')) {
    let report;
    try { report = await collect(); } catch { report = { version: null, findings: [], errors: ['monitor-collection-failed'] }; }
    await writeFile(reportPath, JSON.stringify(report));
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (!process.argv.includes('--publish')) throw new Error('実行モードが必要です');
  let report;
  try { report = JSON.parse(await readFile(reportPath, 'utf8')); }
  catch { report = { version: null, findings: [], errors: ['monitor-report-missing'] }; }
  const message = await publish(report, process.env.MONITOR_TEST === 'true');
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, message + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('監視の実行またはIssue通知に失敗しました。Actionsの実行結果を確認してください。'); process.exitCode = 1; });
}
