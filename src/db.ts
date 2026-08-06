import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface ExternalSessionRow {
  id: string;
  tenant_scope: string;
  source_channel: string;
  source_platform: string;
  source_app: string;
  source_version: string;
  external_session_id: string;
  external_user_id: string | null;
  campaign_code: string | null;
  referrer: string | null;
  entry_url: string | null;
  installation_id: string | null;
  first_touch_at: string;
  mode: string | null;
  stage: string;
  industry: string | null;
  company_size: string | null;
  user_role: string | null;
  stated_problem: string | null;
  current_goal: string | null;
  conversation_state: string;
  confirmed_facts: string;
  file_evidence: string;
  ai_inferences: string;
  unknown_items: string;
  conversation_summary: string | null;
  result_json: string | null;
  result_text: string | null;
  opportunity_score: number | null;
  consent_to_store: number;
  consent_to_contact: number;
  consent_version: string | null;
  consent_timestamp: string | null;
  request_human_review: number;
  company_name: string | null;
  contact_name_encrypted: string | null;
  mobile_encrypted: string | null;
  email_encrypted: string | null;
  retention_expires_at: string;
  converted_customer_id: string | null;
  converted_contact_id: string | null;
  converted_opportunity_id: string | null;
  converted_visit_id: string | null;
  converted_task_id: string | null;
  converted_at: string | null;
  conversion_idempotency_key: string | null;
  session_token_hash: string;
  expires_at: string;
  message_count: number;
  map_completed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export class LandingDatabase {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  close() {
    this.raw.close();
  }

  session(id: string) {
    return this.raw.prepare('SELECT * FROM external_skill_session WHERE id = ?').get(id) as ExternalSessionRow | undefined;
  }

  activeSession(id: string) {
    return this.raw.prepare(`
      SELECT * FROM external_skill_session
      WHERE id = ? AND deleted_at IS NULL AND expires_at > ? AND retention_expires_at > ?
    `).get(id, new Date().toISOString(), new Date().toISOString()) as ExternalSessionRow | undefined;
  }

  transaction<T>(handler: () => T) {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = handler();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  private migrate() {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS external_skill_session (
        id TEXT PRIMARY KEY,
        tenant_scope TEXT NOT NULL,
        source_channel TEXT NOT NULL,
        source_platform TEXT NOT NULL,
        source_app TEXT NOT NULL,
        source_version TEXT NOT NULL,
        external_session_id TEXT NOT NULL,
        external_user_id TEXT,
        campaign_code TEXT,
        referrer TEXT,
        entry_url TEXT,
        installation_id TEXT,
        first_touch_at TEXT NOT NULL,
        mode TEXT,
        stage TEXT NOT NULL,
        industry TEXT,
        company_size TEXT,
        user_role TEXT,
        stated_problem TEXT,
        current_goal TEXT,
        conversation_state TEXT NOT NULL DEFAULT '{}',
        confirmed_facts TEXT NOT NULL DEFAULT '[]',
        file_evidence TEXT NOT NULL DEFAULT '[]',
        ai_inferences TEXT NOT NULL DEFAULT '[]',
        unknown_items TEXT NOT NULL DEFAULT '[]',
        conversation_summary TEXT,
        result_json TEXT,
        result_text TEXT,
        opportunity_score INTEGER,
        consent_to_store INTEGER NOT NULL DEFAULT 0,
        consent_to_contact INTEGER NOT NULL DEFAULT 0,
        consent_version TEXT,
        consent_timestamp TEXT,
        request_human_review INTEGER NOT NULL DEFAULT 0,
        company_name TEXT,
        contact_name_encrypted TEXT,
        mobile_encrypted TEXT,
        email_encrypted TEXT,
        retention_expires_at TEXT NOT NULL,
        converted_customer_id TEXT,
        converted_contact_id TEXT,
        converted_opportunity_id TEXT,
        converted_visit_id TEXT,
        converted_task_id TEXT,
        converted_at TEXT,
        conversion_idempotency_key TEXT UNIQUE,
        session_token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        map_completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE(source_platform, source_app, external_session_id)
      );

      CREATE TABLE IF NOT EXISTS external_skill_message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES external_skill_session(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS external_skill_message_session_created_idx
      ON external_skill_message(session_id, created_at);

      CREATE TABLE IF NOT EXISTS external_skill_attachment (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        file_extension TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        parse_status TEXT NOT NULL,
        extracted_text TEXT,
        parse_message TEXT,
        created_at TEXT NOT NULL,
        deleted_at TEXT,
        FOREIGN KEY(session_id) REFERENCES external_skill_session(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS external_skill_attachment_session_idx
      ON external_skill_attachment(session_id, created_at);

      CREATE TABLE IF NOT EXISTS external_skill_request (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        http_status INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES external_skill_session(id) ON DELETE CASCADE,
        UNIQUE(session_id, endpoint, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS external_skill_session_source_created_idx
      ON external_skill_session(source_platform, source_channel, created_at);

      CREATE INDEX IF NOT EXISTS external_skill_session_retention_idx
      ON external_skill_session(retention_expires_at, deleted_at);
    `);
  }
}

export function jsonValue<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}
