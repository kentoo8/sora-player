import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export async function sourceFingerprint(root = '.') {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Tracked sources unavailable');
  const paths = result.stdout.split('\0').filter(path =>
    path && !path.startsWith('docs/') && path !== '.github/security-assessments.json' &&
    /\.(?:[cm]?js|jsx|ts|tsx|json|toml|ya?ml)$/.test(path)
  ).sort();
  if (!paths.length) throw new Error('No tracked source files');
  const files = await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')]));
  return digest(files);
}

export function advisoryFingerprint(advisory) {
  if (typeof advisory.description !== 'string' || !Array.isArray(advisory.vulnerabilities)) throw new Error('Advisory details unavailable');
  return digest({
    summary: advisory.summary,
    description: advisory.description,
    severity: advisory.severity,
    withdrawn_at: advisory.withdrawn_at,
    vulnerabilities: advisory.vulnerabilities,
    cvss: advisory.cvss,
    cwes: advisory.cwes,
    references: advisory.references,
  });
}

export function evaluateAssessment(finding, rule, context) {
  const review = reason => ({
    url: finding.url, status: 'review', reason, observedConditions: digest(context),
    action: 'このIssueをCodexへ伝え、利用経路・悪用条件・更新候補の再調査を依頼してください。',
  });
  if (!rule) return review('この問題には、利用環境を調査して保存した判断がまだありません。');
  const changed = [];
  if (!isDeepStrictEqual(finding, rule.finding)) changed.push('対象版・重要度・用途・npmの更新案');
  if (context.sourceHash !== rule.sourceHash) changed.push('依存関係・ソース・設定');
  if (context.advisoryHash !== rule.advisoryHash) changed.push('公式の悪用条件・修正情報');
  for (const [name, baseline] of Object.entries(rule.upstream)) {
    if (!isDeepStrictEqual(context.upstream[name], baseline)) changed.push(`${name}の公開版・依存指定`);
  }
  if (changed.length) return review(`以前の判断条件が変わりました（${changed.join('、')}）。再調査が必要です。`);
  return { url: finding.url, status: 'wait', reason: rule.reason, action: rule.action, evidence: rule.evidence };
}

async function requestJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Assessment source unavailable');
  return response.json();
}

function validatePolicy(policy) {
  if (policy.version !== 1 || !Array.isArray(policy.rules)) throw new Error('Invalid assessment policy');
  const urls = new Set();
  for (const rule of policy.rules) {
    if (rule.decision !== 'wait' || rule.finding?.kind !== 'npm' || rule.finding.scope !== 'development' ||
        !/^https:\/\/github.com\/advisories\/GHSA-[\w-]+$/.test(rule.finding.url || '') ||
        !/^[a-f0-9]{64}$/.test(rule.sourceHash || '') || !/^[a-f0-9]{64}$/.test(rule.advisoryHash || '') ||
        !rule.reason || !rule.action || !rule.evidence || !rule.upstream || typeof rule.upstream !== 'object' ||
        !Object.keys(rule.upstream).length || urls.has(rule.finding.url)) throw new Error('Invalid assessment rule');
    for (const [name, baseline] of Object.entries(rule.upstream)) {
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name) || !baseline.version || typeof baseline.dependencies !== 'object') throw new Error('Invalid upstream baseline');
    }
    urls.add(rule.finding.url);
  }
}

export async function assessReport(report) {
  const assessments = [];
  const errors = [...report.errors];
  const findings = report.findings.filter(finding => finding.kind === 'npm');
  if (!findings.length) return { ...report, assessments };
  try {
    const policy = JSON.parse(await readFile('.github/security-assessments.json', 'utf8'));
    validatePolicy(policy);
    const sourceHash = await sourceFingerprint();
    for (const finding of findings) {
      const rule = policy.rules.find(item => item.finding.url === finding.url);
      if (!rule) {
        assessments.push(evaluateAssessment(finding, null, {}));
        continue;
      }
      if (report.errors.length) {
        assessments.push({ url: finding.url, status: 'review', reason: '検査を完了できず、保存した判断の適用条件を確認できませんでした。', action: 'このIssueをCodexへ伝え、検査の復旧と影響の再確認を依頼してください。' });
        continue;
      }
      try {
        const id = new URL(finding.url).pathname.split('/').at(-1);
        const [advisory, packages] = await Promise.all([
          requestJson(`https://api.github.com/advisories/${id}`),
          Promise.all(Object.keys(rule.upstream).map(async name => {
            const metadata = await requestJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
            if (!metadata.version || !metadata.dependencies) throw new Error('Upstream details unavailable');
            return [name, { version: metadata.version, dependencies: metadata.dependencies }];
          })),
        ]);
        if (advisory.ghsa_id !== id) throw new Error('Advisory mismatch');
        assessments.push(evaluateAssessment(finding, rule, { sourceHash, advisoryHash: advisoryFingerprint(advisory), upstream: Object.fromEntries(packages) }));
      } catch {
        errors.push('assessment-evidence-failed');
        assessments.push({ url: finding.url, status: 'review', reason: '判断の根拠となる公式情報を再確認できませんでした。', action: '通信・公式情報を再確認し、このIssueをCodexへ伝えて調査を依頼してください。' });
      }
    }
  } catch {
    errors.push('assessment-policy-failed');
    for (const finding of findings) assessments.push({ url: finding.url, status: 'review', reason: '保存済み判断の条件を確認できませんでした。', action: 'このIssueをCodexへ伝え、判断条件の確認を依頼してください。' });
  }
  return { ...report, errors: [...new Set(errors)].sort(), assessments };
}
