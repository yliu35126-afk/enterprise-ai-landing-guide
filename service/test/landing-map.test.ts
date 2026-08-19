import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enforceEvidencePolicy } from '../src/landing-map.js';

function mapWith(loss: string, facts: string[], metrics: string[] = []) {
  return {
    factStatus: { confirmedFacts: facts, fileEvidence: [], aiInferences: [], unknownItems: [] },
    candidateScenarios: [{ currentLoss: loss }],
    validationPlan: { day7Result: metrics, day30Metrics: [], stopConditions: [] },
  } as any;
}

describe('Landing map numeric evidence policy', () => {
  it('相同数字但单位不同不能写入当前损失', () => {
    const map = enforceEvidencePolicy(mapWith('2万元/月', ['用户确认每次需要2小时']));
    assert.equal(map.candidateScenarios[0].currentLoss, '待确认');
  });

  it('已确认的同数字同单位可保留', () => {
    const map = enforceEvidencePolicy(mapWith('2小时/次', ['用户确认每次需要2小时']));
    assert.equal(map.candidateScenarios[0].currentLoss, '2小时/次');
  });

  it('金额符号与元单位归一化后可匹配', () => {
    const map = enforceEvidencePolicy(mapWith('￥1000', ['用户确认当前每月损失1000元']));
    assert.equal(map.candidateScenarios[0].currentLoss, '￥1000');
  });

  it('产品固定的7天与30天周期不作为用户数字伪造', () => {
    const map = enforceEvidencePolicy(mapWith('待确认', [], ['7天完成历史资料回放', '30天观察人工修改率']));
    assert.deepEqual(map.validationPlan.day7Result, ['7天完成历史资料回放', '30天观察人工修改率']);
  });
});
