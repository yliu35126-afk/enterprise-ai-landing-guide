import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { LandingAi } from '../src/llm.js';
import { LandingDatabase } from '../src/db.js';
import { ExternalLandingSessionService, LandingServiceError } from '../src/session-service.js';

const validMap = {
  companyProfile: { industry: '制造业', companySize: '100-300人', userRole: '负责人', currentGoal: '缩短报价时间' },
  factStatus: { confirmedFacts: [], fileEvidence: [], aiInferences: [], unknownItems: [] },
  candidateScenarios: [{
    name: 'AI报价辅助', currentProblem: '报价依赖老师傅', currentLoss: '￥1000', currentOperator: '报价工程师',
    aiParticipation: '生成报价草稿', humanResponsibilities: ['审核并正式对外报价'], requiredData: ['历史询价', '历史报价'],
    businessValueScore: 90, implementationDifficultyScore: 50, dataReadinessScore: 70, sevenDayValidationPossible: true, reason: '资料可核验',
  }],
  primaryScenario: { name: 'AI报价辅助', selectionReason: '频率高且可在7天内验证' },
  currentFlow: ['接收图纸', '查历史订单', '人工报价'],
  aiEnabledFlow: [{ step: '提取图纸参数', executor: 'AI_EXECUTE' }, { step: '审核报价草稿', executor: 'HUMAN_CONFIRM' }],
  validationPlan: {
    validationObject: '20份历史询价与报价', requiredMaterials: ['20份历史询价', '20份历史报价'],
    day7Result: ['统计人工修改量'], day30Metrics: ['平均报价耗时'], stopConditions: ['关键参数提取错误率超过20%'],
  },
  budgetSource: { type: '减少损失', basis: '缩短报价响应时间', unknownItems: ['实际丢单金额待确认'] },
  nextActions: ['CONTINUE_OPTIMIZATION', 'REQUEST_FDE_REVIEW'],
};

class FakeAi implements LandingAi {
  turnCount = 0;
  mapCount = 0;
  async conversationTurn() {
    this.turnCount += 1;
    return {
      assistantMessage: '已记录这条明确事实。',
      extractedFacts: ['报价依赖两名老师傅'],
      aiInferences: ['历史订单可能可用于相似匹配'],
      unknownItems: ['实际损失待确认'],
      updates: { industry: '制造业', statedProblem: '报价太慢' },
      nextQuestion: '一次报价通常需要多长时间？',
      canGenerateMap: true,
      conversationSummary: '制造业报价效率问题',
    };
  }
  async generateMap() {
    this.mapCount += 1;
    return structuredClone(validMap);
  }
}

describe('ExternalLandingSessionService', () => {
  let db: LandingDatabase;
  let ai: FakeAi;
  let service: ExternalLandingSessionService;

  beforeEach(() => {
    db = new LandingDatabase(':memory:');
    ai = new FakeAi();
    service = new ExternalLandingSessionService(db, ai);
  });
  afterEach(() => db.close());

  function create(platform = 'CLAWHUB') {
    return service.createSession({ sourcePlatform: platform, sourceVersion: '1.0.0', mode: 'KNOWN_PROBLEM' });
  }

  async function withMessage() {
    const created = create();
    await service.addMessage(created.sessionId, created.sessionToken, { mode: 'KNOWN_PROBLEM', message: '报价依赖两名老师傅，一次需要1至2小时。' }, 'message-1');
    return created;
  }

  it('按服务端平台配置创建匿名会话并返回短期Token', () => {
    const result = create('CLAWHUB');
    assert.equal(result.source.sourceChannel, 'SKILL_MARKET');
    assert.equal(result.source.sourcePlatform, 'CLAWHUB');
    assert.match(result.sessionToken, /^elag_/);
    const row = db.session(result.sessionId)!;
    assert.notEqual(row.session_token_hash, result.sessionToken);
    assert.equal(row.source_app, 'enterprise-ai-landing-guide');
  });

  it('拒绝未启用的平台来源', () => {
    assert.throws(() => service.createSession({ sourcePlatform: 'FAKE', sourceVersion: '1.0.0' }), LandingServiceError);
  });

  it('每轮只返回一个主要问题并分开事实与推断', async () => {
    const created = create();
    const result = await service.addMessage(created.sessionId, created.sessionToken, { mode: 'KNOWN_PROBLEM', message: '报价很慢' }, 'message-1');
    assert.equal((result.nextQuestion?.match(/[？?]/g) || []).length, 1);
    assert.deepEqual(result.extractedFacts, ['报价很慢', '报价依赖两名老师傅']);
    assert.deepEqual(result.aiInferences, ['历史订单可能可用于相似匹配']);
    assert.equal(result.canGenerateMap, true);
  });

  it('用户要求直接生成时不在说明文字中残留追问', async () => {
    const created = create();
    const result = await service.addMessage(created.sessionId, created.sessionToken, {
      mode: 'KNOWN_PROBLEM',
      message: '已有足够信息，请直接生成初版地图。',
    }, 'message-direct-map');
    assert.equal(result.nextQuestion, null);
    assert.equal(result.assistantMessage.includes('？'), false);
    assert.match(result.assistantMessage, /停止追问/);
  });

  it('重复消息幂等返回同一响应且不增加消息数', async () => {
    const created = create();
    const input = { mode: 'KNOWN_PROBLEM', message: '报价很慢' };
    const first = await service.addMessage(created.sessionId, created.sessionToken, input, 'message-1');
    const second = await service.addMessage(created.sessionId, created.sessionToken, input, 'message-1');
    assert.deepEqual(second, first);
    assert.equal(db.session(created.sessionId)!.message_count, 1);
    assert.equal(ai.turnCount, 1);
  });

  it('同一幂等键不允许替换成另一条消息', async () => {
    const created = create();
    await service.addMessage(created.sessionId, created.sessionToken, { mode: 'KNOWN_PROBLEM', message: '报价很慢' }, 'message-1');
    await assert.rejects(() => service.addMessage(created.sessionId, created.sessionToken, { mode: 'KNOWN_PROBLEM', message: '客服很慢' }, 'message-1'), LandingServiceError);
  });

  it('错误Token和跨会话Token均不能读取会话', () => {
    const first = create();
    const second = create('CLAWHIVE');
    assert.throws(() => service.getMap(first.sessionId, 'bad-token'), LandingServiceError);
    assert.throws(() => service.getMap(first.sessionId, second.sessionToken), LandingServiceError);
  });

  it('没有任何回答时不能生成地图', async () => {
    const created = create();
    await assert.rejects(() => service.generateMap(created.sessionId, created.sessionToken, 'map-1'), LandingServiceError);
  });

  it('地图使用已保存事实边界并阻止虚构损失数字', async () => {
    const created = await withMessage();
    const result = await service.generateMap(created.sessionId, created.sessionToken, 'map-1');
    assert.equal(result.map.candidateScenarios[0].currentLoss, '待确认');
    assert.deepEqual(result.map.factStatus.confirmedFacts, ['报价依赖两名老师傅，一次需要1至2小时。', '报价依赖两名老师傅']);
    assert.deepEqual(result.map.factStatus.aiInferences, ['历史订单可能可用于相似匹配']);
    assert.match(result.map.validationPlan.stopConditions[0], /建议目标，待确认/);
    assert.ok(result.map.factStatus.unknownItems.some((item: string) => item.includes('验证阈值待人工确认')));
    assert.match(result.markdown, /员工保留职责/);
  });

  it('重复generate-map不重复调用模型', async () => {
    const created = await withMessage();
    const first = await service.generateMap(created.sessionId, created.sessionToken, 'map-1');
    const second = await service.generateMap(created.sessionId, created.sessionToken, 'map-1');
    assert.deepEqual(second, first);
    assert.equal(ai.mapCount, 1);
  });

  it('地图生成前不能请求保存授权', () => {
    const created = create();
    assert.throws(() => service.saveConsent(created.sessionId, created.sessionToken, { consentToStore: true, companyName: '测试企业' }, 'consent-1'), LandingServiceError);
  });

  it('同意联系和同意保存必须分开且联系信息加密存储', async () => {
    const created = await withMessage();
    await service.generateMap(created.sessionId, created.sessionToken, 'map-1');
    assert.throws(() => service.saveConsent(created.sessionId, created.sessionToken, { consentToStore: false, consentToContact: true, companyName: '测试企业', contactName: '李经理', mobile: '13800000000' }, 'consent-bad'), LandingServiceError);
    service.saveConsent(created.sessionId, created.sessionToken, { consentToStore: true, consentToContact: true, companyName: '测试企业', contactName: '李经理', mobile: '13800000000' }, 'consent-1');
    const row = db.session(created.sessionId)!;
    assert.equal(row.consent_to_store, 1);
    assert.equal(row.consent_to_contact, 1);
    assert.notEqual(row.mobile_encrypted, '13800000000');
    assert.equal(JSON.stringify(row).includes('13800000000'), false);
  });

  it('未同意联系时不保存提交的联系方式', async () => {
    const created = await withMessage();
    await service.generateMap(created.sessionId, created.sessionToken, 'map-1');
    service.saveConsent(created.sessionId, created.sessionToken, { consentToStore: true, consentToContact: false, companyName: '测试企业', contactName: '不应保存', mobile: '13800000000' }, 'consent-1');
    const row = db.session(created.sessionId)!;
    assert.equal(row.contact_name_encrypted, null);
    assert.equal(row.mobile_encrypted, null);
  });

  it('危险扩展名在写文件前被拒绝', async () => {
    const created = create();
    await assert.rejects(() => service.addAttachment(created.sessionId, created.sessionToken, { filename: 'attack.sh', mimetype: 'text/plain', buffer: Buffer.from('echo bad') }, 'file-1'), LandingServiceError);
    const count = (db.raw.prepare('SELECT COUNT(*) AS count FROM external_skill_attachment').get() as any).count;
    assert.equal(count, 0);
  });

  it('过期会话拒绝继续使用', () => {
    const created = create();
    db.raw.prepare('UPDATE external_skill_session SET expires_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z', created.sessionId);
    assert.throws(() => service.getMap(created.sessionId, created.sessionToken), LandingServiceError);
  });

  it('用户删除后匿名会话和关联数据不可恢复', async () => {
    const created = await withMessage();
    const result = await service.deleteSession(created.sessionId, created.sessionToken);
    assert.equal(result.deleted, true);
    assert.equal(db.session(created.sessionId), undefined);
    const messages = (db.raw.prepare('SELECT COUNT(*) AS count FROM external_skill_message').get() as any).count;
    assert.equal(messages, 0);
  });

  it('多平台会话共用核心状态机但统计独立', async () => {
    const clawhub = create('CLAWHUB');
    const coze = create('COZE');
    await service.addMessage(clawhub.sessionId, clawhub.sessionToken, { mode: 'KNOWN_PROBLEM', message: '报价慢' }, 'c1');
    await service.addMessage(coze.sessionId, coze.sessionToken, { mode: 'KNOWN_PROBLEM', message: '客服慢' }, 'c2');
    const stats = service.statistics();
    assert.equal(stats.rows.length, 2);
    assert.deepEqual(new Set(stats.rows.map((row) => row.sourcePlatform)), new Set(['CLAWHUB', 'COZE']));
  });

  it('未配置FDE服务密钥时不会假装转换成功', async () => {
    const created = await withMessage();
    await service.generateMap(created.sessionId, created.sessionToken, 'map-1');
    service.saveConsent(created.sessionId, created.sessionToken, { consentToStore: true, companyName: '测试企业' }, 'consent-1');
    await assert.rejects(() => service.convert(created.sessionId, created.sessionToken, 'convert-1'), LandingServiceError);
    assert.equal(db.session(created.sessionId)!.converted_opportunity_id, null);
  });
});
