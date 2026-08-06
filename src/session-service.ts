import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { config, getPlatform } from './config.js';
import { type ExternalSessionRow, LandingDatabase, jsonValue } from './db.js';
import { DeepSeekLandingAi, LandingAiError, type ConversationTurnOutput, type LandingAi } from './llm.js';
import { enforceEvidencePolicy, landingMapMarkdown, validateLandingMap } from './landing-map.js';
import { decryptSensitive, encryptSensitive, randomToken, sanitizeText, secureEqual, sha256 } from './security.js';

const SOURCE_APP = 'enterprise-ai-landing-guide';
const CONSENT_VERSION = '2026-08-06-v1';
const ENTRY_MODES = [
  { code: 'KNOWN_PROBLEM', name: '我已经有明确问题' },
  { code: 'OPPORTUNITY_SCAN', name: '我不知道AI该用在哪里' },
];

const MIME_BY_EXTENSION: Record<string, string[]> = {
  '.txt': ['text/plain'], '.md': ['text/markdown', 'text/plain'], '.csv': ['text/csv', 'text/plain', 'application/vnd.ms-excel'],
  '.json': ['application/json', 'text/json', 'text/plain'], '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
  '.png': ['image/png'], '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'],
};
const DANGEROUS_EXTENSIONS = new Set(['.exe', '.dll', '.sh', '.bash', '.zsh', '.bat', '.cmd', '.com', '.msi', '.js', '.mjs', '.cjs', '.jar', '.app', '.dmg', '.pkg', '.ps1', '.php', '.py', '.rb']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json']);

export class ExternalLandingSessionService {
  constructor(
    readonly db: LandingDatabase,
    private readonly ai: LandingAi = new DeepSeekLandingAi(),
  ) {}

  createSession(input: Record<string, any>) {
    const sourcePlatform = sanitizeText(input.sourcePlatform || 'CLAWHIVE', 50).toUpperCase();
    const platform = getPlatform(sourcePlatform);
    if (!platform) throw new LandingServiceError('EXT-40010', '来源平台不受支持或尚未启用', 400);
    const sourceVersion = sanitizeText(input.sourceVersion || '1.0.0', 50);
    if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(sourceVersion)) {
      throw new LandingServiceError('EXT-40011', 'sourceVersion必须使用语义化版本', 400);
    }
    const id = randomUUID();
    const token = randomToken();
    const externalSessionId = sanitizeText(input.externalSessionId || id, 128);
    const mode = input.mode ? this.validMode(input.mode) : null;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.sessionTtlMinutes * 60_000);
    const retentionExpiresAt = new Date(now.getTime() + config.retentionDays * 86_400_000);
    try {
      this.db.raw.prepare(`
        INSERT INTO external_skill_session (
          id, tenant_scope, source_channel, source_platform, source_app, source_version,
          external_session_id, external_user_id, campaign_code, referrer, entry_url, installation_id,
          first_touch_at, mode, stage, conversation_state, retention_expires_at,
          session_token_hash, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)
      `).run(
        id,
        config.fdeEnterpriseId || 'UNCONFIGURED',
        platform.sourceChannel,
        sourcePlatform,
        SOURCE_APP,
        sourceVersion,
        externalSessionId,
        nullable(input.externalUserId, 128),
        nullable(input.campaignCode, 100),
        nullable(input.referrer, 500),
        nullable(input.entryUrl, 1000),
        nullable(input.installationId, 128),
        now.toISOString(),
        mode,
        mode ? 'COLLECTING' : 'AWAITING_MODE',
        retentionExpiresAt.toISOString(),
        sha256(token),
        expiresAt.toISOString(),
        now.toISOString(),
        now.toISOString(),
      );
    } catch (error: any) {
      if (String(error?.message || '').includes('UNIQUE constraint failed')) {
        throw new LandingServiceError('EXT-40910', '该平台外部会话ID已存在，请继续原会话', 409);
      }
      throw error;
    }
    return {
      sessionId: id,
      sessionToken: token,
      expiresAt: expiresAt.toISOString(),
      currentStage: mode ? 'COLLECTING' : 'AWAITING_MODE',
      entryModes: ENTRY_MODES,
      source: { sourceChannel: platform.sourceChannel, sourcePlatform, sourceApp: SOURCE_APP, sourceVersion },
    };
  }

  authenticate(id: string, token: string) {
    const session = this.db.activeSession(id);
    if (!session) {
      const existing = this.db.session(id);
      if (existing?.deleted_at) throw new LandingServiceError('EXT-41000', '匿名会话已删除', 410);
      if (existing) throw new LandingServiceError('EXT-40102', '匿名会话已过期', 401);
      throw new LandingServiceError('EXT-40400', '匿名会话不存在', 404);
    }
    if (!token || !secureEqual(session.session_token_hash, sha256(token))) {
      throw new LandingServiceError('EXT-40100', 'sessionToken无效', 401);
    }
    return session;
  }

  async addMessage(id: string, token: string, input: Record<string, any>, idempotencyKey: string) {
    const session = this.authenticate(id, token);
    const message = sanitizeText(input.message, 4000);
    if (!message) throw new LandingServiceError('EXT-40020', '消息不能为空', 400);
    const mode = input.mode ? this.validMode(input.mode) : session.mode;
    if (!mode) throw new LandingServiceError('EXT-40021', '请先选择入口模式', 400);
    const cached = this.cachedResponse(session.id, 'messages', idempotencyKey, { message, mode });
    if (cached) return cached;

    const state = jsonValue<Record<string, any>>(session.conversation_state, {});
    const confirmedFacts = jsonValue<string[]>(session.confirmed_facts, []);
    const fileEvidence = jsonValue<string[]>(session.file_evidence, []);
    const aiInferences = jsonValue<string[]>(session.ai_inferences, []);
    const unknownItems = jsonValue<string[]>(session.unknown_items, []);
    const questionCount = Number(state.questionCount || 0);
    let turn: ConversationTurnOutput;
    try {
      turn = await this.ai.conversationTurn({
        mode, questionCount, latestMessage: message, state,
        confirmedFacts, fileEvidence, aiInferences, unknownItems,
      });
    } catch (error) {
      if (!(error instanceof LandingAiError)) throw error;
      turn = this.fallbackTurn({ mode, questionCount, message, state });
    }

    const directGenerate = /直接生成|先生成|生成初版|不再回答/.test(message);
    const nextQuestion = directGenerate || questionCount >= 5 ? null : oneQuestion(turn.nextQuestion);
    // 用户亲自提交的当轮原话是用户陈述事实；不应因为模型漏抽取而丢失。
    const extractedFacts = unique([
      ...confirmedFacts,
      sanitizeText(message, 500),
      ...turn.extractedFacts.map((item) => sanitizeText(item, 500)),
    ]);
    const inferences = unique([...aiInferences, ...turn.aiInferences.map((item) => sanitizeText(item, 500))]);
    const explicitUnknown = /待确认|不清楚|不知道|不确定/.test(message)
      ? [`用户明确标记待确认：${sanitizeText(message, 450)}`]
      : [];
    const unknown = unique([...unknownItems, ...explicitUnknown, ...turn.unknownItems.map((item) => sanitizeText(item, 500))]);
    const updates = this.safeUpdates(turn.updates);
    const nextState = {
      ...state,
      ...updates,
      questionCount: nextQuestion ? questionCount + 1 : questionCount,
      askedFields: unique([...(Array.isArray(state.askedFields) ? state.askedFields : []), ...Object.keys(updates)]),
    };
    const assistantMessage = sanitizeText(
      nextQuestion
        ? `${turn.assistantMessage.replace(/[？?]\s*$/, '').trim()}\n\n${nextQuestion}`
        : (turn.assistantMessage || '信息已经足够生成一版企业AI落地地图。'),
      3000,
    );
    const now = new Date().toISOString();
    const canGenerateMap = Boolean(turn.canGenerateMap || session.message_count >= 0);
    const stage = nextQuestion ? 'COLLECTING' : 'READY_FOR_MAP';
    const response = {
      assistantMessage,
      currentStage: stage,
      extractedFacts,
      aiInferences: inferences,
      unknownItems: unknown,
      nextQuestion,
      canGenerateMap,
    };

    this.db.transaction(() => {
      this.db.raw.prepare('INSERT INTO external_skill_message (id, session_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), id, 'user', message, JSON.stringify({ mode }), now);
      this.db.raw.prepare('INSERT INTO external_skill_message (id, session_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), id, 'assistant', assistantMessage, JSON.stringify({ nextQuestion, modelBoundary: 'AI_OR_SAFE_FALLBACK' }), now);
      this.db.raw.prepare(`
        UPDATE external_skill_session SET mode=?, stage=?, industry=?, company_size=?, user_role=?, stated_problem=?, current_goal=?,
          conversation_state=?, confirmed_facts=?, ai_inferences=?, unknown_items=?, conversation_summary=?,
          message_count=message_count+1, updated_at=? WHERE id=?
      `).run(
        mode, stage, nullable(updates.industry || session.industry, 100), nullable(updates.companySize || session.company_size, 100),
        nullable(updates.userRole || session.user_role, 100), nullable(updates.statedProblem || session.stated_problem || message, 2000),
        nullable(updates.currentGoal || session.current_goal, 1000), JSON.stringify(nextState), JSON.stringify(extractedFacts),
        JSON.stringify(inferences), JSON.stringify(unknown), sanitizeText(turn.conversationSummary, 2000), now, id,
      );
      this.storeResponse(id, 'messages', idempotencyKey, { message, mode }, response, 200);
    });
    return response;
  }

  async addAttachment(id: string, token: string, file: { filename: string; mimetype: string; buffer: Buffer }, idempotencyKey: string) {
    const session = this.authenticate(id, token);
    const platform = getPlatform(session.source_platform);
    if (!platform?.supportsAttachments) throw new LandingServiceError('EXT-40031', '当前来源平台不支持附件', 400);
    if (!file?.buffer?.length) throw new LandingServiceError('EXT-40030', '缺少上传文件', 400);
    if (file.buffer.length > config.maxUploadBytes) throw new LandingServiceError('EXT-41300', '文件超过允许大小', 413);
    const extension = extname(file.filename || '').toLowerCase();
    if (!extension || DANGEROUS_EXTENSIONS.has(extension) || !MIME_BY_EXTENSION[extension]) {
      throw new LandingServiceError('EXT-41500', '文件类型不允许', 415);
    }
    const mime = sanitizeText(file.mimetype, 100).toLowerCase();
    if (!MIME_BY_EXTENSION[extension].includes(mime)) {
      throw new LandingServiceError('EXT-41501', '文件扩展名与MIME类型不匹配', 415);
    }
    const requestDescriptor = { extension, mime, size: file.buffer.length, sha256: sha256(file.buffer) };
    const cached = this.cachedResponse(session.id, 'attachments', idempotencyKey, requestDescriptor);
    if (cached) return cached;

    const attachmentCount = Number((this.db.raw.prepare('SELECT COUNT(*) AS count FROM external_skill_attachment WHERE session_id=?').get(id) as any).count || 0);
    const attachmentId = randomUUID();
    const displayName = `资料-${attachmentCount + 1}${extension}`;
    const directory = join(config.uploadDir, id);
    const storedPath = join(directory, `${attachmentId}${extension}`);
    await mkdir(directory, { recursive: true });
    await writeFile(storedPath, file.buffer, { flag: 'wx' });

    let parseStatus = 'FAILED';
    let extractedText = '';
    let parseMessage = '当前文件已安全保存，但解析器暂不支持该格式；会话可以继续。';
    if (TEXT_EXTENSIONS.has(extension)) {
      try {
        extractedText = sanitizeText((await readFile(storedPath)).toString('utf8'), 20000);
        parseStatus = extractedText ? 'PARSED' : 'FAILED';
        parseMessage = extractedText ? '文件解析完成，结果仍需用户确认。' : '文件没有读取到可用文本，会话可以继续。';
      } catch {
        parseMessage = '文件解析失败，会话可以继续。';
      }
    }
    const evidence = parseStatus === 'PARSED' ? `${displayName}：${extractedText.slice(0, 500)}` : null;
    const fileEvidence = unique([...jsonValue<string[]>(session.file_evidence, []), ...(evidence ? [evidence] : [])]);
    const unknownItems = unique([
      ...jsonValue<string[]>(session.unknown_items, []),
      ...(parseStatus === 'PARSED' ? [`${displayName}解析结果未经用户确认`] : [`${displayName}解析失败，内容待确认`]),
    ]);
    const now = new Date().toISOString();
    const response = {
      attachmentId, displayName, fileSize: file.buffer.length, mimeType: mime,
      parseStatus, parseMessage, currentStage: session.stage,
    };
    this.db.transaction(() => {
      this.db.raw.prepare(`
        INSERT INTO external_skill_attachment (
          id, session_id, display_name, stored_path, file_size, mime_type, file_extension, sha256,
          parse_status, extracted_text, parse_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(attachmentId, id, displayName, storedPath, file.buffer.length, mime, extension, requestDescriptor.sha256, parseStatus, extractedText || null, parseMessage, now);
      this.db.raw.prepare('UPDATE external_skill_session SET file_evidence=?, unknown_items=?, updated_at=? WHERE id=?')
        .run(JSON.stringify(fileEvidence), JSON.stringify(unknownItems), now, id);
      this.storeResponse(id, 'attachments', idempotencyKey, requestDescriptor, response, 200);
    });
    return response;
  }

  async generateMap(id: string, token: string, idempotencyKey: string) {
    const session = this.authenticate(id, token);
    if (session.message_count < 1) throw new LandingServiceError('EXT-40040', '请先回答至少一个业务问题', 400);
    const mapRequest = {
      messageCount: session.message_count,
      confirmedFacts: session.confirmed_facts,
      fileEvidence: session.file_evidence,
      aiInferences: session.ai_inferences,
      unknownItems: session.unknown_items,
    };
    const cached = this.cachedResponse(session.id, 'generate-map', idempotencyKey, mapRequest);
    if (cached) return cached;
    const input = this.mapInput(session);
    let candidate = await this.ai.generateMap(input);
    let validation = validateLandingMap(candidate);
    if (!validation.ok) {
      candidate = await this.ai.generateMap(input, validation.errors.map((item) => `${item.instancePath || '/'} ${item.message || item.keyword}`).slice(0, 20));
      validation = validateLandingMap(candidate);
    }
    if (!validation.ok) throw new LandingServiceError('EXT-50220', 'AI结果未通过结构校验，请重试', 502);

    const map = validation.value;
    map.factStatus = {
      confirmedFacts: jsonValue<string[]>(session.confirmed_facts, []),
      fileEvidence: jsonValue<string[]>(session.file_evidence, []),
      aiInferences: jsonValue<string[]>(session.ai_inferences, []),
      unknownItems: jsonValue<string[]>(session.unknown_items, []),
    };
    enforceEvidencePolicy(map);
    map.nextActions = ['CONTINUE_OPTIMIZATION', 'REQUEST_FDE_REVIEW'];
    const postValidation = validateLandingMap(map);
    if (!postValidation.ok) throw new LandingServiceError('EXT-50221', '事实边界合并后结构校验失败，请重试', 502);
    const resultText = landingMapMarkdown(map);
    const opportunityScore = this.opportunityScore(map);
    const completedAt = new Date().toISOString();
    const response = { map, markdown: resultText, opportunityScore, currentStage: 'MAP_READY', generatedAt: completedAt };
    this.db.transaction(() => {
      this.db.raw.prepare(`
        UPDATE external_skill_session SET stage='MAP_READY', result_json=?, result_text=?, opportunity_score=?, map_completed_at=?, updated_at=? WHERE id=?
      `).run(JSON.stringify(map), resultText, opportunityScore, completedAt, completedAt, id);
      this.storeResponse(id, 'generate-map', idempotencyKey, mapRequest, response, 200);
    });
    return response;
  }

  getMap(id: string, token: string) {
    const session = this.authenticate(id, token);
    if (!session.result_json || !session.result_text) throw new LandingServiceError('EXT-40440', '企业AI落地地图尚未生成', 404);
    return {
      map: jsonValue(session.result_json, {}), markdown: session.result_text,
      opportunityScore: session.opportunity_score, currentStage: session.stage, generatedAt: session.map_completed_at,
    };
  }

  saveConsent(id: string, token: string, input: Record<string, any>, idempotencyKey: string) {
    const session = this.authenticate(id, token);
    if (!session.result_json) throw new LandingServiceError('EXT-40050', '请先生成企业AI落地地图', 400);
    const consentToStore = input.consentToStore === true;
    const consentToContact = input.consentToContact === true;
    if (consentToContact && !consentToStore) throw new LandingServiceError('EXT-40051', '同意联系必须同时同意保存本次申请', 400);
    const companyName = sanitizeText(input.companyName, 200);
    if (consentToStore && !companyName) throw new LandingServiceError('EXT-40052', '同意保存并申请复核时需要企业名称', 400);
    const contactName = sanitizeText(input.contactName, 100);
    const mobile = sanitizeText(input.mobile, 20);
    const email = sanitizeText(input.email, 200).toLowerCase();
    if (consentToContact && (!contactName || (!validPhone(mobile) && !validEmail(email)))) {
      throw new LandingServiceError('EXT-40053', '同意联系时需要联系人姓名和有效手机号或邮箱', 400);
    }
    const normalized = { consentToStore, consentToContact, companyName, contactName: consentToContact ? contactName : '', mobile: consentToContact ? mobile : '', email: consentToContact ? email : '' };
    const cached = this.cachedResponse(session.id, 'consent', idempotencyKey, normalized);
    if (cached) return cached;
    const now = new Date().toISOString();
    const response = { consentToStore, consentToContact, consentVersion: CONSENT_VERSION, consentTimestamp: now, canConvert: consentToStore };
    this.db.transaction(() => {
      this.db.raw.prepare(`
        UPDATE external_skill_session SET consent_to_store=?, consent_to_contact=?, consent_version=?, consent_timestamp=?, company_name=?,
          contact_name_encrypted=?, mobile_encrypted=?, email_encrypted=?, stage=?, updated_at=? WHERE id=?
      `).run(
        consentToStore ? 1 : 0, consentToContact ? 1 : 0, CONSENT_VERSION, now, consentToStore ? companyName : null,
        consentToContact ? encryptSensitive(contactName) : null, consentToContact && validPhone(mobile) ? encryptSensitive(mobile) : null,
        consentToContact && validEmail(email) ? encryptSensitive(email) : null,
        consentToStore ? 'CONSENTED' : 'MAP_READY', now, id,
      );
      this.storeResponse(id, 'consent', idempotencyKey, normalized, response, 200);
    });
    return response;
  }

  async convert(id: string, token: string, idempotencyKey: string) {
    let session = this.authenticate(id, token);
    if (session.converted_opportunity_id) return this.conversionFromSession(session, true);
    if (!session.result_json || !session.map_completed_at) throw new LandingServiceError('EXT-40060', '尚未生成企业AI落地地图', 400);
    if (!session.consent_to_store || !session.consent_timestamp || !session.company_name) {
      throw new LandingServiceError('EXT-40061', '尚未明确同意保存并申请人工复核', 400);
    }
    if (!config.fdeEnterpriseId || config.fdeApiKey.length < 32) {
      throw new LandingServiceError('EXT-50360', 'FDE受控转换尚未配置', 503);
    }
    const requestKey = sanitizeText(idempotencyKey, 128) || `convert-${sha256(`${id}:${session.consent_timestamp}`).slice(0, 48)}`;
    const cached = this.cachedResponse(session.id, 'convert', requestKey, { consentTimestamp: session.consent_timestamp });
    if (cached) return cached;
    const resultJson = jsonValue<Record<string, any>>(session.result_json, {});
    const payload = {
      enterpriseId: config.fdeEnterpriseId,
      sourceChannel: session.source_channel,
      sourcePlatform: session.source_platform,
      sourceApp: session.source_app,
      sourceVersion: session.source_version,
      externalSessionId: session.external_session_id,
      externalUserId: session.external_user_id,
      campaignCode: session.campaign_code,
      referrer: session.referrer,
      entryUrl: session.entry_url,
      installationId: session.installation_id,
      firstTouchAt: session.first_touch_at,
      mapCompletedAt: session.map_completed_at,
      consentToStore: true,
      consentToContact: Boolean(session.consent_to_contact),
      consentVersion: session.consent_version,
      consentTimestamp: session.consent_timestamp,
      requestHumanReview: true,
      companyName: session.company_name,
      contactName: session.consent_to_contact ? decryptSensitive(session.contact_name_encrypted) : undefined,
      mobile: session.consent_to_contact ? decryptSensitive(session.mobile_encrypted) : undefined,
      email: session.consent_to_contact ? decryptSensitive(session.email_encrypted) : undefined,
      resultJson,
      resultText: session.result_text,
      opportunityScore: session.opportunity_score,
      conversionIdempotencyKey: requestKey,
    };
    let response: Response;
    try {
      response = await fetch(`${config.fdeApiBase}/integrations/enterprise-ai-landing-guide/v1/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-External-Landing-Key': config.fdeApiKey,
          'Idempotency-Key': requestKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new LandingServiceError('EXT-50361', 'FDE转换服务当前不可达，请稍后重试', 503);
    }
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new LandingServiceError(body?.code || 'EXT-50260', sanitizeText(body?.message || 'FDE转换失败，请稍后重试', 300), response.status >= 500 ? 502 : response.status);
    }
    const converted = body?.data || body;
    if (!converted?.customerId || !converted?.opportunityId || !converted?.visitId || !converted?.taskId) {
      throw new LandingServiceError('EXT-50261', 'FDE转换结果不完整，请稍后重试', 502);
    }
    const now = new Date().toISOString();
    const result = {
      conversionStatus: converted.conversionStatus || 'CONVERTED',
      customerId: converted.customerId,
      contactId: converted.contactId || null,
      opportunityId: converted.opportunityId,
      visitId: converted.visitId,
      taskId: converted.taskId,
      attributionId: converted.attributionId,
      source: converted.source,
    };
    this.db.transaction(() => {
      this.db.raw.prepare(`
        UPDATE external_skill_session SET request_human_review=1, stage='CONVERTED', converted_customer_id=?, converted_contact_id=?,
          converted_opportunity_id=?, converted_visit_id=?, converted_task_id=?, converted_at=?, conversion_idempotency_key=?, updated_at=? WHERE id=?
      `).run(result.customerId, result.contactId, result.opportunityId, result.visitId, result.taskId, now, requestKey, now, id);
      this.storeResponse(id, 'convert', requestKey, { consentTimestamp: session.consent_timestamp }, result, 200);
    });
    session = this.db.session(id)!;
    return this.conversionFromSession(session, false, result.attributionId, result.source);
  }

  async deleteSession(id: string, token: string) {
    const session = this.authenticate(id, token);
    const attachments = this.db.raw.prepare('SELECT stored_path FROM external_skill_attachment WHERE session_id=?').all(id) as Array<{ stored_path: string }>;
    this.db.transaction(() => {
      this.db.raw.prepare('DELETE FROM external_skill_session WHERE id=?').run(id);
    });
    await Promise.allSettled(attachments.map((item) => rm(item.stored_path, { force: true })));
    await rm(join(config.uploadDir, id), { recursive: true, force: true });
    return { deleted: true, convertedBusinessDataRetained: Boolean(session.converted_at) };
  }

  async cleanupExpired() {
    const now = new Date().toISOString();
    const sessions = this.db.raw.prepare('SELECT id FROM external_skill_session WHERE retention_expires_at <= ? OR deleted_at IS NOT NULL').all(now) as Array<{ id: string }>;
    for (const session of sessions) {
      const attachments = this.db.raw.prepare('SELECT stored_path FROM external_skill_attachment WHERE session_id=?').all(session.id) as Array<{ stored_path: string }>;
      this.db.raw.prepare('DELETE FROM external_skill_session WHERE id=?').run(session.id);
      await Promise.allSettled(attachments.map((item) => rm(item.stored_path, { force: true })));
      await rm(join(config.uploadDir, session.id), { recursive: true, force: true });
    }
    return { deletedSessions: sessions.length };
  }

  statistics(filters: Record<string, any> = {}) {
    const clauses = ['deleted_at IS NULL'];
    const values: Array<string> = [];
    for (const [column, value] of [
      ['source_platform', filters.sourcePlatform], ['source_channel', filters.sourceChannel], ['source_app', filters.sourceApp],
      ['source_version', filters.sourceVersion], ['campaign_code', filters.campaignCode], ['industry', filters.industry],
    ]) {
      if (value) { clauses.push(`${column} = ?`); values.push(sanitizeText(value, 100)); }
    }
    if (filters.primaryScenario) {
      clauses.push(`json_extract(result_json, '$.primaryScenario.name') = ?`);
      values.push(sanitizeText(filters.primaryScenario, 200));
    }
    if (filters.dateFrom) { clauses.push('created_at >= ?'); values.push(validIsoDate(filters.dateFrom, 'dateFrom')); }
    if (filters.dateTo) { clauses.push('created_at <= ?'); values.push(validIsoDate(filters.dateTo, 'dateTo')); }
    const rows = this.db.raw.prepare(`
      SELECT source_platform AS sourcePlatform, source_channel AS sourceChannel, source_app AS sourceApp,
        source_version AS sourceVersion, COALESCE(campaign_code, '') AS campaignCode,
        COUNT(*) AS sessionCount,
        COUNT(*) AS platformStarts,
        SUM(message_count) AS validAnswers,
        SUM(CASE WHEN map_completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completedMaps,
        SUM(consent_to_store) AS consentedStore,
        SUM(consent_to_contact) AS consentedContact,
        SUM(CASE WHEN converted_at IS NOT NULL THEN 1 ELSE 0 END) AS convertedOpportunities
      FROM external_skill_session WHERE ${clauses.join(' AND ')}
      GROUP BY source_platform, source_channel, source_app, source_version, campaign_code
      ORDER BY sessionCount DESC
    `).all(...values) as Array<Record<string, any>>;
    return { generatedAt: new Date().toISOString(), rows };
  }

  private mapInput(session: ExternalSessionRow) {
    const messages = this.db.raw.prepare('SELECT role, content FROM external_skill_message WHERE session_id=? ORDER BY created_at ASC').all(session.id);
    const attachments = this.db.raw.prepare('SELECT display_name, parse_status, extracted_text, parse_message FROM external_skill_attachment WHERE session_id=? AND deleted_at IS NULL ORDER BY created_at ASC').all(session.id);
    return {
      mode: session.mode,
      companyProfile: { industry: session.industry || '待确认', companySize: session.company_size || '待确认', userRole: session.user_role || '待确认', currentGoal: session.current_goal || '待确认' },
      statedProblem: session.stated_problem || '待确认',
      conversationState: jsonValue(session.conversation_state, {}),
      confirmedFacts: jsonValue(session.confirmed_facts, []),
      fileEvidence: jsonValue(session.file_evidence, []),
      aiInferences: jsonValue(session.ai_inferences, []),
      unknownItems: jsonValue(session.unknown_items, []),
      messages,
      attachments,
      instruction: '信息不足必须标记待确认。用户已经要求生成地图；不得为了联系方式延迟结果。',
    };
  }

  private fallbackTurn(input: { mode: string; questionCount: number; message: string; state: Record<string, any> }): ConversationTurnOutput {
    const direct = /直接生成|先生成|生成初版|不再回答/.test(input.message);
    const questions = input.mode === 'OPPORTUNITY_SCAN'
      ? [
          ['industry', '贵公司属于什么行业，主要产品或服务是什么？'],
          ['currentGoal', '当前最希望改善的是获客销售、报价、客服、交付、协同、回款，还是知识传承中的哪一项？'],
          ['statedProblem', '这个区域里最明显、最频繁的问题是什么？'],
          ['currentFlow', '这件事目前从开始到结束，员工主要经过哪几个步骤？'],
          ['frequency', '这件事大约每月发生多少次，不清楚时可以给区间？'],
          ['acceptanceOwner', '7天验证结果最终由哪个岗位确认是否有效？'],
        ]
      : [
          ['industry', '贵公司属于什么行业，主要产品或服务是什么？'],
          ['currentFlow', '这个问题目前从开始到结束，员工主要经过哪几个步骤？'],
          ['frequency', '这个问题大约每月发生多少次，不清楚时可以给区间？'],
          ['loss', '目前最容易核对的影响是耗时、错误、成本、损失还是风险？没有数字可以回答待确认。'],
          ['currentTools', '当前会使用哪些软件、Excel、文件或业务数据？'],
          ['acceptanceOwner', '7天验证结果最终由哪个岗位确认是否有效？'],
        ];
    const asked = new Set(Array.isArray(input.state.askedFields) ? input.state.askedFields : []);
    const next = direct ? null : questions.find(([field]) => !asked.has(field));
    return {
      assistantMessage: direct ? '我会基于当前信息生成初版，并把信息不足处标为待确认。' : '已记录这条由你明确提供的信息。',
      extractedFacts: [input.message], aiInferences: [], unknownItems: [],
      updates: input.state.statedProblem ? {} : { statedProblem: input.message },
      nextQuestion: next?.[1] || null, canGenerateMap: true,
      conversationSummary: input.message,
    };
  }

  private cachedResponse(sessionId: string, endpoint: string, idempotencyKey: string, request: unknown) {
    const key = sanitizeText(idempotencyKey, 128);
    if (!key) throw new LandingServiceError('EXT-40070', '写请求必须提供Idempotency-Key', 400);
    const row = this.db.raw.prepare('SELECT request_hash, response_json FROM external_skill_request WHERE session_id=? AND endpoint=? AND idempotency_key=?')
      .get(sessionId, endpoint, key) as { request_hash: string; response_json: string } | undefined;
    if (!row) return null;
    if (!secureEqual(row.request_hash, requestHash(request))) throw new LandingServiceError('EXT-40970', '同一幂等键对应了不同请求内容', 409);
    return jsonValue(row.response_json, {});
  }

  private storeResponse(sessionId: string, endpoint: string, idempotencyKey: string, request: unknown, response: unknown, httpStatus: number) {
    this.db.raw.prepare(`
      INSERT INTO external_skill_request (id, session_id, endpoint, idempotency_key, request_hash, response_json, http_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), sessionId, endpoint, sanitizeText(idempotencyKey, 128), requestHash(request), JSON.stringify(response), httpStatus, new Date().toISOString());
  }

  private safeUpdates(value: Record<string, any>) {
    const allowed = new Set(['industry', 'companySize', 'userRole', 'currentGoal', 'statedProblem', 'currentFlow', 'currentOperator', 'frequency', 'loss', 'currentTools', 'decisionMaker', 'acceptanceOwner']);
    return Object.fromEntries(Object.entries(value || {}).filter(([key, item]) => allowed.has(key) && typeof item === 'string').map(([key, item]) => [key, sanitizeText(item, 1000)]));
  }

  private opportunityScore(map: Record<string, any>) {
    const item = map.candidateScenarios.find((candidate: any) => candidate.name === map.primaryScenario.name) || map.candidateScenarios[0];
    return Math.max(0, Math.min(100, Math.round(item.businessValueScore * 0.45 + item.dataReadinessScore * 0.35 + (100 - item.implementationDifficultyScore) * 0.2)));
  }

  private conversionFromSession(session: ExternalSessionRow, duplicate: boolean, attributionId?: string, source?: unknown) {
    return {
      conversionStatus: duplicate ? 'ALREADY_CONVERTED' : 'CONVERTED', duplicate,
      attributionId: attributionId || null,
      customerId: session.converted_customer_id, contactId: session.converted_contact_id,
      opportunityId: session.converted_opportunity_id, visitId: session.converted_visit_id, taskId: session.converted_task_id,
      source: source || { sourceChannel: session.source_channel, sourcePlatform: session.source_platform, sourceApp: session.source_app, sourceVersion: session.source_version, externalSessionId: session.external_session_id, campaignCode: session.campaign_code },
    };
  }

  private validMode(value: unknown) {
    const mode = sanitizeText(value, 30).toUpperCase();
    if (!ENTRY_MODES.some((item) => item.code === mode)) throw new LandingServiceError('EXT-40012', '入口模式不受支持', 400);
    return mode;
  }
}

export class LandingServiceError extends Error {
  constructor(public code: string, message: string, public statusCode: number) {
    super(message);
  }
}

function nullable(value: unknown, maxLength: number) {
  const text = sanitizeText(value, maxLength);
  return text || null;
}

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean))).slice(0, 100);
}

function oneQuestion(value: unknown) {
  const text = sanitizeText(value, 500).replace(/\s+/g, ' ');
  if (!text) return null;
  return text.match(/^.*?[？?]/)?.[0] || text;
}

function validPhone(value: string) {
  return /^\+?[0-9][0-9\-\s]{5,18}$/.test(value);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validIsoDate(value: unknown, field: string) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) throw new LandingServiceError('EXT-40081', `${field}日期格式不正确`, 400);
  return date.toISOString();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function requestHash(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
