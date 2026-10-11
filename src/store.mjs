import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { must, Fault } from './core.mjs';

// Single local durable volume; WAL + FULL. Never put this DB on NFS/OneDrive.
export class Store {
  constructor(root) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(root, 'jobs.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, chat TEXT NOT NULL, username TEXT NOT NULL, profile TEXT NOT NULL, created INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS stages(job TEXT, stage TEXT, state TEXT, result TEXT, started INTEGER, ended INTEGER, PRIMARY KEY(job,stage));
      CREATE TABLE IF NOT EXISTS claude(job TEXT PRIMARY KEY, state TEXT NOT NULL, response TEXT, status INTEGER, request_id TEXT, calls INTEGER NOT NULL CHECK(calls=1), reserved INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoints(job TEXT, key TEXT, value TEXT, PRIMARY KEY(job,key));
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, job TEXT, at INTEGER, kind TEXT, data TEXT);`);
  }
  create(job) {
    this.db.prepare('INSERT OR IGNORE INTO jobs VALUES(?,?,?,?,?,?)').run(job.id, job.chat, job.username, job.profile, Date.now(), JSON.stringify(job));
    const actual = this.get(job.id);
    must(actual.profile === job.profile && actual.chat === job.chat, 'EVENT_CHANGED', 'O evento já existe com outro perfil. Envie uma nova mensagem para criar outro trabalho.');
    return actual;
  }
  get(id) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    must(row, 'JOB_NOT_FOUND', 'Trabalho não encontrado.'); return { ...JSON.parse(row.data), created: row.created };
  }
  event(id, kind, data = {}) { this.db.prepare('INSERT INTO events(job,at,kind,data) VALUES(?,?,?,?)').run(id, Date.now(), kind, JSON.stringify(data)); }
  checkpoint(id, key, value) {
    if (arguments.length === 3) this.db.prepare('INSERT INTO checkpoints VALUES(?,?,?) ON CONFLICT(job,key) DO UPDATE SET value=excluded.value').run(id, key, JSON.stringify(value));
    const row = this.db.prepare('SELECT value FROM checkpoints WHERE job=? AND key=?').get(id,key);
    return row ? JSON.parse(row.value) : undefined;
  }
  stage(id, stage) { return this.db.prepare('SELECT * FROM stages WHERE job=? AND stage=?').get(id,stage); }
  claimStage(id, stage) {
    return this.db.prepare("INSERT INTO stages VALUES(?,?,'running',NULL,?,NULL) ON CONFLICT(job,stage) DO UPDATE SET state='running',result=NULL,started=excluded.started,ended=NULL WHERE stages.state='interrupted'").run(id,stage,Date.now()).changes === 1;
  }
  finish(id, stage, state, result) { this.db.prepare('UPDATE stages SET state=?,result=?,ended=? WHERE job=? AND stage=?').run(state,JSON.stringify(result),Date.now(),id,stage); }
  recover() { this.db.exec("UPDATE stages SET state='interrupted' WHERE state='running'"); }
  reserveClaude(id) {
    return this.db.prepare("INSERT OR IGNORE INTO claude(job,state,calls,reserved) VALUES(?,'reserved',1,?)").run(id,Date.now()).changes === 1;
  }
  claude(id) { return this.db.prepare('SELECT * FROM claude WHERE job=?').get(id); }
  sentClaude(id) { this.db.prepare("UPDATE claude SET state='sent' WHERE job=? AND state='reserved'").run(id); }
  saveClaude(id, response, status, requestId) {
    this.db.prepare("UPDATE claude SET state='responded',response=?,status=?,request_id=? WHERE job=?").run(response,status,requestId || null,id);
  }
  resetStage(id, stage) {
    must(stage !== 'generate' || this.claude(id)?.response, 'CLAUDE_AMBIGUOUS', 'Reserva do Claude sem resposta recuperável. A geração não será repetida.');
    must(this.stage(id,stage)?.state !== 'running', 'BUSY', 'A etapa ainda está em execução.');
    this.db.prepare("UPDATE stages SET state='interrupted' WHERE job=? AND stage=? AND state IN ('failed','interrupted')").run(id,stage);
  }
  close() { this.db.close(); }
}

export async function invokeClaudeOnce(store, job, send) {
  let saved = store.claude(job);
  if (saved?.response) return saved;
  if (!store.reserveClaude(job)) throw new Fault('CLAUDE_AMBIGUOUS', 'A chamada do Claude já foi reservada/enviada e não há resposta persistida. Nenhuma segunda geração será feita.');
  store.sentClaude(job);
  // The sole provider POST. No SDK, transport retry, proxy or automatic redirect.
  const response = await send();
  store.saveClaude(job,response.text,response.status,response.requestId);
  return store.claude(job);
}
