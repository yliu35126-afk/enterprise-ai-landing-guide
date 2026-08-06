import AjvModule, { type ErrorObject } from 'ajv';

export const LANDING_MAP_SCHEMA = {
  $id: 'https://lantuzhigou.com/schemas/enterprise-ai-landing-map-v1.json',
  type: 'object',
  additionalProperties: false,
  required: ['companyProfile', 'factStatus', 'candidateScenarios', 'primaryScenario', 'currentFlow', 'aiEnabledFlow', 'validationPlan', 'budgetSource', 'nextActions'],
  properties: {
    companyProfile: {
      type: 'object', additionalProperties: false,
      required: ['industry', 'companySize', 'userRole', 'currentGoal'],
      properties: {
        industry: { type: 'string', maxLength: 100 }, companySize: { type: 'string', maxLength: 100 },
        userRole: { type: 'string', maxLength: 100 }, currentGoal: { type: 'string', maxLength: 500 },
      },
    },
    factStatus: {
      type: 'object', additionalProperties: false,
      required: ['confirmedFacts', 'fileEvidence', 'aiInferences', 'unknownItems'],
      properties: {
        confirmedFacts: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 500 } },
        fileEvidence: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 500 } },
        aiInferences: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 500 } },
        unknownItems: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 500 } },
      },
    },
    candidateScenarios: {
      type: 'array', minItems: 1, maxItems: 3,
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'currentProblem', 'currentLoss', 'currentOperator', 'aiParticipation', 'humanResponsibilities', 'requiredData', 'businessValueScore', 'implementationDifficultyScore', 'dataReadinessScore', 'sevenDayValidationPossible', 'reason'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 }, currentProblem: { type: 'string', minLength: 1, maxLength: 1000 },
          currentLoss: { type: 'string', minLength: 1, maxLength: 500 }, currentOperator: { type: 'string', minLength: 1, maxLength: 200 },
          aiParticipation: { type: 'string', minLength: 1, maxLength: 1000 },
          humanResponsibilities: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 300 } },
          requiredData: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 300 } },
          businessValueScore: { type: 'integer', minimum: 0, maximum: 100 },
          implementationDifficultyScore: { type: 'integer', minimum: 0, maximum: 100 },
          dataReadinessScore: { type: 'integer', minimum: 0, maximum: 100 },
          sevenDayValidationPossible: { type: 'boolean' }, reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    primaryScenario: {
      type: 'object', additionalProperties: false, required: ['name', 'selectionReason'],
      properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, selectionReason: { type: 'string', minLength: 1, maxLength: 1000 } },
    },
    currentFlow: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 300 } },
    aiEnabledFlow: {
      type: 'array', minItems: 1, maxItems: 30,
      items: {
        type: 'object', additionalProperties: false, required: ['step', 'executor'],
        properties: {
          step: { type: 'string', minLength: 1, maxLength: 300 },
          executor: { enum: ['AI_EXECUTE', 'HUMAN_CONFIRM', 'SYSTEM_EXECUTE', 'ESCALATE_TO_HUMAN'] },
        },
      },
    },
    validationPlan: {
      type: 'object', additionalProperties: false,
      required: ['validationObject', 'requiredMaterials', 'day7Result', 'day30Metrics', 'stopConditions'],
      properties: {
        validationObject: { type: 'string', minLength: 1, maxLength: 500 },
        requiredMaterials: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 300 } },
        day7Result: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 300 } },
        day30Metrics: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 300 } },
        stopConditions: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 300 } },
      },
    },
    budgetSource: {
      type: 'object', additionalProperties: false, required: ['type', 'basis', 'unknownItems'],
      properties: {
        type: { type: 'string', minLength: 1, maxLength: 100 }, basis: { type: 'string', minLength: 1, maxLength: 500 },
        unknownItems: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 300 } },
      },
    },
    nextActions: {
      type: 'array', minItems: 1, uniqueItems: true,
      items: { enum: ['CONTINUE_OPTIMIZATION', 'REQUEST_FDE_REVIEW'] },
    },
  },
} as const;

export type LandingMap = Record<string, any>;

const ajv = new (AjvModule as any)({ allErrors: true, strict: true });
const validate = ajv.compile(LANDING_MAP_SCHEMA);

export function validateLandingMap(input: unknown): { ok: true; value: LandingMap } | { ok: false; errors: ErrorObject[] } {
  if (validate(input)) {
    const value = input as LandingMap;
    const candidateNames = new Set(value.candidateScenarios.map((item: any) => item.name));
    if (!candidateNames.has(value.primaryScenario.name)) {
      return { ok: false, errors: [{ instancePath: '/primaryScenario/name', schemaPath: '#/business-rule', keyword: 'business-rule', params: {}, message: 'must reference one candidate scenario' }] };
    }
    return { ok: true, value };
  }
  return { ok: false, errors: validate.errors || [] };
}

export function enforceEvidencePolicy(map: LandingMap) {
  const confirmed = JSON.stringify(map.factStatus?.confirmedFacts || []);
  for (const scenario of map.candidateScenarios || []) {
    const loss = String(scenario.currentLoss || '').trim();
    if (!loss) scenario.currentLoss = '待确认';
    const numericClaims = loss.match(/(?:¥|￥|元|万|%|\d)/g);
    if (numericClaims?.length && !/[0-9]/.test(confirmed)) scenario.currentLoss = '待确认';
  }
  return map;
}

export function landingMapMarkdown(map: LandingMap) {
  const primary = map.primaryScenario;
  const scenario = map.candidateScenarios.find((item: any) => item.name === primary.name) || map.candidateScenarios[0];
  const bullets = (items: string[]) => items.map((item) => `- ${item}`).join('\n');
  const flow = map.aiEnabledFlow.map((item: any, index: number) => `${index + 1}. ${item.step}（${executorLabel(item.executor)}）`).join('\n');
  return [
    '# 企业AI落地地图',
    '',
    `行业：${map.companyProfile.industry || '待确认'}  `,
    `企业规模：${map.companyProfile.companySize || '待确认'}  `,
    `当前目标：${map.companyProfile.currentGoal || '待确认'}`,
    '',
    '## 第一优先场景',
    '',
    `**${primary.name}**`,
    '',
    primary.selectionReason,
    '',
    `当前问题：${scenario.currentProblem}`,
    '',
    `当前损失：${scenario.currentLoss || '待确认'}`,
    '',
    `AI参与：${scenario.aiParticipation}`,
    '',
    '员工保留职责：', bullets(scenario.humanResponsibilities),
    '',
    '## 当前流程', '', bullets(map.currentFlow),
    '',
    '## AI参与后的流程', '', flow,
    '',
    '## 7天验证', '',
    `验证对象：${map.validationPlan.validationObject}`,
    '',
    '所需真实资料：', bullets(map.validationPlan.requiredMaterials),
    '',
    '第7天可核对结果：', bullets(map.validationPlan.day7Result),
    '',
    '30天观察指标：', bullets(map.validationPlan.day30Metrics),
    '',
    '停止条件：', bullets(map.validationPlan.stopConditions),
    '',
    '## 事实边界', '',
    '已确认事实：', bullets(map.factStatus.confirmedFacts.length ? map.factStatus.confirmedFacts : ['暂无']),
    '',
    '文件证据：', bullets(map.factStatus.fileEvidence.length ? map.factStatus.fileEvidence : ['暂无']),
    '',
    'AI推断：', bullets(map.factStatus.aiInferences.length ? map.factStatus.aiInferences : ['暂无']),
    '',
    '待确认：', bullets(map.factStatus.unknownItems.length ? map.factStatus.unknownItems : ['暂无']),
    '',
    '> 本地图仅用于业务评估，不构成收益保证。正式实施前仍需人工复核。',
  ].join('\n');
}

function executorLabel(value: string) {
  return ({
    AI_EXECUTE: 'AI执行', HUMAN_CONFIRM: '人工确认', SYSTEM_EXECUTE: '系统执行', ESCALATE_TO_HUMAN: '转人工',
  } as Record<string, string>)[value] || value;
}
