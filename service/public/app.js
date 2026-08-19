const api = '/api/public/clawhive/v1';
const $ = (id) => document.getElementById(id);
let sessionId = '';
let sessionToken = '';
let mode = '';
let mapData = null;

const show = (id) => $(id)?.classList.remove('hidden');
const hide = (id) => $(id)?.classList.add('hidden');
const key = () => crypto.randomUUID();

function setText(id, value, fallback = '待确认') {
  const element = $(id);
  if (element) element.textContent = String(value || fallback);
}

function listItems(id, values, fallback = '待确认') {
  const element = $(id);
  if (!element) return;
  element.replaceChildren();
  const items = Array.isArray(values) && values.length ? values : [fallback];
  for (const value of items) {
    const item = document.createElement('li');
    item.textContent = String(value);
    element.append(item);
  }
}

function bubble(role, text, options = {}) {
  const empty = document.querySelector('.empty-message');
  empty?.remove();
  const element = document.createElement('div');
  element.className = `bubble ${role}${options.loading ? ' loading-bubble' : ''}`;
  element.textContent = text;
  $('messages').append(element);
  element.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return element;
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  if (options.method && options.method !== 'GET' && options.method !== 'DELETE' && !headers['Idempotency-Key']) headers['Idempotency-Key'] = key();
  if (options.body && !headers['Content-Type'] && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${api}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({ message: '服务响应无法读取，请稍后重试。' }));
  if (!response.ok) throw new Error(body.message || '请求没有完成，请稍后重试。');
  return body;
}

function explainError(error) {
  return error instanceof Error ? error.message : '服务暂时不可用，请稍后重试。';
}

document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', async () => {
  document.querySelectorAll('[data-mode]').forEach((item) => { item.disabled = true; });
  try {
    mode = button.dataset.mode;
    const sourcePlatform='FDE_WEBSITE';
    const campaignCode = new URLSearchParams(location.search).get('campaignCode') || undefined;
    const result = await request('/sessions', { method: 'POST', body: JSON.stringify({ mode, sourcePlatform, sourceVersion: '1.0.0', campaignCode, entryUrl: location.href, referrer: document.referrer || undefined }) });
    sessionId = result.sessionId;
    sessionToken = result.sessionToken;
    hide('start');
    show('chat');
    bubble('assistant', mode === 'KNOWN_PROBLEM' ? '请先用一句话描述最想解决的业务问题。' : '请先告诉我贵公司属于什么行业，主要产品或服务是什么？');
    $('message').focus();
    $('chat').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    document.querySelectorAll('[data-mode]').forEach((item) => { item.disabled = false; });
    showChatError(explainError(error));
  }
}));

function showChatError(message) {
  setText('chat-error', message);
  show('chat-error');
}

function clearChatError() {
  hide('chat-error');
}

$('message-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('message');
  const send = $('send');
  const message = input.value.trim();
  if (!message || !sessionId) return;
  clearChatError();
  bubble('user', message);
  input.value = '';
  input.disabled = true;
  send.disabled = true;
  send.innerHTML = '正在梳理 <span class="button-spinner"></span>';
  const loading = bubble('assistant', '正在理解你的现状…', { loading: true });
  try {
    const result = await request(`/sessions/${sessionId}/messages`, { method: 'POST', body: JSON.stringify({ message, mode }) });
    loading.remove();
    bubble('assistant', result.assistantMessage || '信息已经记录，可以继续补充，或生成一版初步判断。');
    $('generate').disabled = false;
  } catch (error) {
    loading.remove();
    bubble('assistant', `这次没有记录成功：${explainError(error)}`);
    input.value = message;
  } finally {
    input.disabled = false;
    send.disabled = false;
    send.innerHTML = '继续梳理 <span>→</span>';
    input.focus();
  }
});

$('attachment').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file || !sessionId) return;
  const status = $('upload-status');
  status.textContent = `正在上传「${file.name}」…`;
  status.className = 'status-line is-loading';
  const data = new FormData();
  data.append('file', file);
  try {
    const result = await request(`/sessions/${sessionId}/attachments`, { method: 'POST', headers: { 'Idempotency-Key': key() }, body: data });
    status.textContent = `${result.displayName}已加入本次判断。${result.parseMessage || ''}`;
    status.className = 'status-line is-success';
    bubble('assistant', `${result.displayName}已收到，我会把它作为资料证据使用。`);
  } catch (error) {
    status.textContent = `资料没有上传成功：${explainError(error)}`;
    status.className = 'status-line is-error';
  } finally {
    event.target.value = '';
  }
});

$('generate').addEventListener('click', async () => {
  const button = $('generate');
  button.disabled = true;
  button.innerHTML = '<span class="button-spinner"></span> 正在生成落地判断';
  hide('map-error');
  show('map-section');
  hide('map-content');
  hide('map-empty');
  show('map-loading');
  $('map-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const result = await request(`/sessions/${sessionId}/generate-map`, { method: 'POST' });
    mapData = result.map;
    renderMap(mapData);
    hide('map-loading');
    show('map-content');
  } catch (error) {
    hide('map-loading');
    setText('map-error', `暂时没有生成成功：${explainError(error)} 请稍后再试。`);
    show('map-error');
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>✦</span> 重新生成落地判断';
  }
});

function renderMap(map) {
  const primary = map?.primaryScenario || {};
  const scenario = (map?.candidateScenarios || []).find((item) => item.name === primary.name) || map?.candidateScenarios?.[0] || {};
  const profile = map?.companyProfile || {};
  const validation = map?.validationPlan || {};
  setText('result-context', [profile.industry, profile.userRole, profile.currentGoal].filter(Boolean).join(' · ') || '基于你刚刚提供的企业现状');
  setText('primary-name', primary.name);
  setText('primary-reason', primary.selectionReason);
  setText('current-problem', scenario.currentProblem);
  setText('current-loss', `经营影响：${scenario.currentLoss || '待确认'}`);
  setText('ai-participation', scenario.aiParticipation);
  listItems('human-responsibilities', scenario.humanResponsibilities);
  setText('validation-object', validation.validationObject);
  listItems('required-materials', validation.requiredMaterials);
  listItems('day7-result', validation.day7Result);
  listItems('confirmed-facts', map?.factStatus?.confirmedFacts, '暂未确认');
  listItems('unknown-items', map?.factStatus?.unknownItems, '暂无新增待确认项');
  const flow = $('ai-flow');
  flow.replaceChildren();
  for (const [index, item] of (map?.aiEnabledFlow || []).entries()) {
    const row = document.createElement('div');
    row.className = 'flow-item';
    const number = document.createElement('span');
    number.className = 'flow-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('div');
    const step = document.createElement('strong');
    step.textContent = item.step || '待确认';
    const executor = document.createElement('span');
    executor.className = `executor ${item.executor === 'HUMAN_CONFIRM' || item.executor === 'ESCALATE_TO_HUMAN' ? 'human' : 'ai'}`;
    executor.textContent = item.executor === 'HUMAN_CONFIRM' || item.executor === 'ESCALATE_TO_HUMAN' ? '需要人工确认' : 'AI先处理';
    copy.append(step, executor);
    row.append(number, copy);
    flow.append(row);
  }
}

$('open-consent').addEventListener('click', () => { show('consent'); $('consent').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('consent-contact').addEventListener('change', (event) => event.target.checked ? show('contact-fields') : hide('contact-fields'));

$('consent-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide('consent-error');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const contact = $('contact-method').value.trim();
  button.disabled = true;
  button.innerHTML = '<span class="button-spinner"></span> 正在提交';
  const payload = { consentToStore: $('consent-store').checked, consentToContact: $('consent-contact').checked, companyName: $('company-name').value.trim(), contactName: $('contact-name').value.trim(), mobile: /^\+?[0-9][0-9\-\s]{5,18}$/.test(contact) ? contact : undefined, email: contact.includes('@') ? contact : undefined };
  try {
    await request(`/sessions/${sessionId}/consent`, { method: 'POST', body: JSON.stringify(payload) });
    const result = await request(`/sessions/${sessionId}/convert`, { method: 'POST' });
    hide('consent');
    show('done');
    setText('done-text', `已创建人工复核任务。复核团队会基于本次判断联系你。${result.opportunityId ? `参考编号：${result.opportunityId}` : ''}`);
    $('done').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    setText('consent-error', explainError(error));
    show('consent-error');
  } finally {
    button.disabled = false;
    button.innerHTML = '确认授权并提交复核 <span>→</span>';
  }
});

$('delete').addEventListener('click', async () => {
  if (!sessionId || !confirm('确认删除本次内容和临时资料？已授权转换的正式业务数据不会自动删除。')) return;
  const button = $('delete');
  button.disabled = true;
  button.textContent = '正在删除…';
  try {
    await request(`/sessions/${sessionId}`, { method: 'DELETE' });
    sessionId = '';
    sessionToken = '';
    location.reload();
  } catch (error) {
    button.disabled = false;
    button.textContent = '删除本次内容';
    showChatError(`删除没有完成：${explainError(error)}`);
  }
});
