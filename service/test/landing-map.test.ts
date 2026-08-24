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

  it('三个验证字段真正移除无证据的样本量、准确率和比例', () => {
    const input = mapWith('待确认', []);
    input.validationPlan.day7Result = ['用50份真实订单验证'];
    input.validationPlan.day30Metrics = ['准确率达到80%'];
    input.validationPlan.stopConditions = ['错误减少低于30%时停止'];

    const map = enforceEvidencePolicy(input);

    const output = JSON.stringify([
      ...map.validationPlan.day7Result,
      ...map.validationPlan.day30Metrics,
      ...map.validationPlan.stopConditions,
    ]);
    assert.doesNotMatch(output, /50\s*份|80\s*%|30\s*%/);
    assert.match(output, /企业实际量待确认|真实基线待确认/);
    assert.equal(map.factStatus.unknownItems.length, 3);
    assert.doesNotMatch(JSON.stringify(map.factStatus.unknownItems), /50\s*份|80\s*%|30\s*%/);
  });

  it('三个验证字段保留用户Evidence中的数字', () => {
    const facts = ['用户确认使用50份订单，当前准确率80%，停止线为30%'];
    const input = mapWith('待确认', facts);
    input.validationPlan.day7Result = ['用50份真实订单验证'];
    input.validationPlan.day30Metrics = ['准确率达到80%'];
    input.validationPlan.stopConditions = ['低于30%时停止'];

    const map = enforceEvidencePolicy(input);

    assert.deepEqual(map.validationPlan.day7Result, ['用50份真实订单验证']);
    assert.deepEqual(map.validationPlan.day30Metrics, ['准确率达到80%']);
    assert.deepEqual(map.validationPlan.stopConditions, ['低于30%时停止']);
  });
});
