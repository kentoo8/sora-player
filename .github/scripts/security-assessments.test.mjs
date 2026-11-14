import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, advisoryFingerprint, evaluateAssessment } from './security-assessments.mjs';
import { render, notificationTitle, fingerprint } from './security-monitor.mjs';

const finding = {
  kind: 'npm', scope: 'development', name: 'minimatch', severity: 'moderate',
  versions: ['10.2.6'], range: '>=7.0.0 <11.0.1', fix: true,
  url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249',
};
const upstream = { parser: { version: '8.72.2', dependencies: { minimatch: '^10.2.2' } } };
const rule = {
  decision: 'wait', finding, sourceHash: 'source-before', advisoryHash: 'advisory-before', upstream,
  reason: '悪用条件の最適化レベル2以上に対し、確認した呼び出しは既定値1です。',
  action: '現在は追加の操作を行わず、依存元の対応版を待ちます。',
  evidence: '依存経路と呼び出しを調査して判断しました。',
};
const context = { sourceHash: rule.sourceHash, advisoryHash: rule.advisoryHash, upstream };
const report = { version: '26.13.1', findings: [finding], errors: [] };

function assessedReport(currentContext = context) {
  return { ...report, assessments: [evaluateAssessment(finding, rule, currentContext)] };
}

test('the reviewed exact configuration says waiting is acceptable and no operation is needed', () => {
  const result = assessedReport();
  assert.equal(result.assessments[0].status, 'wait');
  assert.match(notificationTitle(result), /待ってよい・操作不要/);
  assert.match(render(result, ''), /^\*\*今の構成では対応版を待ってよい/);
  assert.match(render(result, ''), /最適化レベル2以上/);
  assert.equal(fingerprint(result), fingerprint(assessedReport()));
});

test('unknown problems and runtime use never inherit permission to wait', () => {
  assert.equal(evaluateAssessment(finding, null, context).status, 'review');
  const runtime = { ...finding, scope: 'runtime' };
  assert.equal(evaluateAssessment(runtime, rule, context).status, 'review');
  const unknown = { ...report, assessments: [evaluateAssessment(finding, null, context)] };
  assert.doesNotMatch(notificationTitle(unknown), /待ってよい/);
  assert.match(render(unknown, ''), /Codexへ伝え/);
});

test('package versions, severity, source/configuration and official advisory changes invalidate the assessment', () => {
  for (const changed of [{ ...finding, severity: 'high' }, { ...finding, versions: ['10.2.7'] }, { ...finding, fix: false }]) {
    assert.equal(evaluateAssessment(changed, rule, context).status, 'review');
  }
  const changedSource = assessedReport({ ...context, sourceHash: 'source-after' });
  const changedAdvisory = assessedReport({ ...context, advisoryHash: 'advisory-after' });
  assert.equal(changedSource.assessments[0].status, 'review');
  assert.match(changedAdvisory.assessments[0].reason, /公式の悪用条件/);
  assert.notEqual(fingerprint(changedSource), fingerprint(assessedReport()));
  assert.notEqual(fingerprint(changedSource), fingerprint(assessedReport({ ...context, sourceHash: 'source-after-again' })));
});

test('an upstream release invalidates waiting even when npm audit still reports the same warning', () => {
  const current = { parser: { version: '8.73.0', dependencies: { minimatch: '^11.0.1' } } };
  const result = assessedReport({ ...context, upstream: current });
  assert.equal(result.assessments[0].status, 'review');
  assert.match(result.assessments[0].reason, /公開版・依存指定/);
  assert.notEqual(fingerprint(result), fingerprint(assessedReport()));
  assert.doesNotMatch(notificationTitle(result), /待ってよい/);
});

test('an incomplete audit has priority over a previously accepted waiting decision', () => {
  const result = { ...assessedReport(), errors: ['npm-audit-runtime-failed'] };
  assert.match(notificationTitle(result), /確認失敗/);
  assert.doesNotMatch(render(result, ''), /今の構成では対応版を待ってよい/);
  const mixed = { ...assessedReport(), findings: [finding, { ...finding, url: 'https://github.com/advisories/GHSA-other' }] };
  assert.doesNotMatch(notificationTitle(mixed), /待ってよい/);
});

test('official exploitation details and withdrawal matter, while volatile EPSS values do not', () => {
  const advisory = { summary: 'Pattern amplification', description: 'Requires optimizationLevel >= 2', severity: 'moderate', withdrawn_at: null, vulnerabilities: [], epss: { percentage: 0.1 } };
  assert.equal(advisoryFingerprint(advisory), advisoryFingerprint({ ...advisory, epss: { percentage: 0.2 } }));
  assert.notEqual(advisoryFingerprint(advisory), advisoryFingerprint({ ...advisory, description: 'Also affects default settings' }));
  assert.notEqual(advisoryFingerprint(advisory), advisoryFingerprint({ ...advisory, withdrawn_at: '2026-11-15' }));
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  assert.throws(() => advisoryFingerprint({}));
});
