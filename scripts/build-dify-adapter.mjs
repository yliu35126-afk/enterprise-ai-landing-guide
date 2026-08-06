import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = resolve(root, 'distribution/dify/enterprise-ai-landing-guide-plugin');
const toolsDir = resolve(plugin, 'tools');
await mkdir(toolsDir, { recursive: true });
await mkdir(resolve(plugin, '_assets'), { recursive: true });

const common = {
  session_id: p('session_id', 'string', true, '匿名会话ID', '使用创建会话工具返回的sessionId'),
  session_token: p('session_token', 'string', true, '短期会话Token', '仅使用创建会话返回的sessionToken，不写入日志'),
  idempotency_key: p('idempotency_key', 'string', false, '幂等键', '同一请求重试时复用；新操作使用新键'),
};

const definitions = [
  {
    name: 'create_ai_landing_session', className: 'CreateAiLandingSessionTool',
    label: '创建企业AI落地会话',
    description: '创建Dify来源的匿名会话，不写入FDE客户或商机。',
    parameters: [
      p('external_session_id', 'string', true, 'Dify会话ID', '当前Dify对话的稳定唯一ID'),
      select('mode', false, '入口模式', ['KNOWN_PROBLEM', 'OPPORTUNITY_SCAN']),
      p('campaign_code', 'string', false, '活动码', '可选渠道活动码'),
    ],
    body: `yield from self.emit(lambda: self.api().create(\n            self.text(tool_parameters, "external_session_id"),\n            self.text(tool_parameters, "mode"),\n            self.text(tool_parameters, "campaign_code"),\n        ))`,
  },
  {
    name: 'answer_ai_landing_question', className: 'AnswerAiLandingQuestionTool',
    label: '回答一轮落地问题', description: '提交一条用户回答，每轮只获取一个主要问题。',
    parameters: [common.session_id, common.session_token, p('message', 'string', true, '用户回答', '用户亲自提交的当轮业务事实'), select('mode', false, '入口模式', ['KNOWN_PROBLEM', 'OPPORTUNITY_SCAN']), common.idempotency_key],
    body: `yield from self.emit(lambda: self.api().message(\n            self.text(tool_parameters, "session_id"), self.text(tool_parameters, "session_token"),\n            self.text(tool_parameters, "message"), self.text(tool_parameters, "mode"), self.key(tool_parameters),\n        ))`,
  },
  {
    name: 'upload_ai_landing_attachment', className: 'UploadAiLandingAttachmentTool',
    label: '添加文本资料', description: '上传Dify流程已安全提取的文本，不读取本地路径或任意URL。',
    parameters: [common.session_id, common.session_token, p('filename', 'string', true, '显示文件名', '只用于展示的.txt文件名'), p('text_content', 'string', true, '资料文本', '已经Dify安全提取的文本，最多20000字符'), common.idempotency_key],
    body: `content = self.text(tool_parameters, "text_content")[:20000]\n        yield from self.emit(lambda: self.api().upload_text(\n            self.text(tool_parameters, "session_id"), self.text(tool_parameters, "session_token"),\n            self.text(tool_parameters, "filename", "dify-note.txt"), content, self.key(tool_parameters),\n        ))`,
  },
  {
    name: 'generate_ai_landing_map', className: 'GenerateAiLandingMapTool',
    label: '生成企业AI落地地图', description: '根据已确认事实生成JSON与Markdown地图。',
    parameters: [common.session_id, common.session_token, common.idempotency_key],
    body: `yield from self.emit(lambda: self.api().generate(\n            self.text(tool_parameters, "session_id"), self.text(tool_parameters, "session_token"), self.key(tool_parameters),\n        ))`,
  },
  {
    name: 'get_ai_landing_map', className: 'GetAiLandingMapTool',
    label: '读取企业AI落地地图', description: '读取已生成的地图，不产生新写入。',
    parameters: [common.session_id, common.session_token],
    body: `yield from self.emit(lambda: self.api().get_map(\n            self.text(tool_parameters, "session_id"), self.text(tool_parameters, "session_token"),\n        ))`,
  },
  {
    name: 'request_fde_human_review', className: 'RequestFdeHumanReviewTool',
    label: '申请FDE人工复核', description: '用户已获得地图且明确同意保存后才可调用；联系授权单独处理。',
    parameters: [common.session_id, common.session_token, p('consent_to_store', 'boolean', true, '同意保存', '只有用户明确同意时为true'), p('consent_to_contact', 'boolean', true, '同意联系', '独立授权；默认false'), p('company_name', 'string', true, '企业名称', '用户授权后亲自提供'), p('contact_name', 'string', false, '联系人', '仅同意联系时传入'), p('mobile', 'string', false, '手机', '仅同意联系时传入'), p('email', 'string', false, '邮箱', '仅同意联系时传入'), common.idempotency_key],
    body: `contact = bool(tool_parameters.get("consent_to_contact", False))\n        consent = {\n            "consentToStore": bool(tool_parameters.get("consent_to_store", False)),\n            "consentToContact": contact,\n            "companyName": self.text(tool_parameters, "company_name"),\n            "contactName": self.text(tool_parameters, "contact_name") if contact else "",\n            "mobile": self.text(tool_parameters, "mobile") if contact else "",\n            "email": self.text(tool_parameters, "email") if contact else "",\n        }\n        yield from self.emit(lambda: self.api().consent_and_convert(\n            self.text(tool_parameters, "session_id"), self.text(tool_parameters, "session_token"), consent, self.key(tool_parameters),\n        ))`,
  },
  {
    name: 'delete_ai_landing_session', className: 'DeleteAiLandingSessionTool',
    label: '删除匿名会话', description: '删除匿名会话和临时资料；已授权FDE正式业务数据按FDE规则保留。',
    parameters: [common.session_id, common.session_token],
    body: `yield from self.emit(lambda: self.api().delete(\n            self.text(tool_parameters, "session_id"), self.text(tool_parameters, "session_token"),\n        ))`,
  },
];

for (const definition of definitions) {
  const yaml = {
    identity: { name: definition.name, author: 'blueprint-fde', label: { en_US: titleCase(definition.name), zh_Hans: definition.label } },
    description: { human: { en_US: definition.description, zh_Hans: definition.description }, llm: definition.description },
    parameters: definition.parameters,
    extra: { python: { source: `tools/${definition.name}.py` } },
  };
  await writeFile(resolve(toolsDir, `${definition.name}.yaml`), YAML.stringify(yaml, { lineWidth: 0 }), 'utf8');
  const source = `from collections.abc import Generator\nfrom typing import Any\n\nfrom dify_plugin.entities.tool import ToolInvokeMessage\n\nfrom tools.base import LandingGuideTool\n\n\nclass ${definition.className}(LandingGuideTool):\n    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:\n        ${definition.body}\n`;
  await writeFile(resolve(toolsDir, `${definition.name}.py`), source, 'utf8');
}

const logo = resolve(root, 'distribution/openclaw/enterprise-ai-landing-guide/assets/logo.svg');
await copyFile(logo, resolve(plugin, '_assets/icon.svg'));
await copyFile(logo, resolve(plugin, '_assets/icon-dark.svg'));

function p(name, type, required, label, description) {
  return { name, type, required, label: { en_US: label, zh_Hans: label }, human_description: { en_US: description, zh_Hans: description }, llm_description: description, form: 'llm' };
}

function select(name, required, label, values) {
  return { ...p(name, 'select', required, label, label), options: values.map((value) => ({ value, label: { en_US: value, zh_Hans: value } })) };
}

function titleCase(value) {
  return value.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}
