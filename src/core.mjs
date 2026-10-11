import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync, readFileSync, fsyncSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';

export class Fault extends Error {
  constructor(code, message, detail = {}) { super(message); this.code = code; this.detail = detail; }
}
export function must(ok, code, message) { if (!ok) throw new Fault(code, message); }
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
export function atomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp';
  const fd = openSync(tmp, 'w', 0o600);
  try { writeFileSync(fd, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
}
export function authEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
export function profileUrl(text) {
  let u;
  try { u = new URL(String(text).trim()); } catch { throw new Fault('INPUT_URL', 'Envie somente o link HTTPS de um perfil público do Instagram.'); }
  const parts = u.pathname.split('/').filter(Boolean);
  const name = parts[0]?.toLowerCase();
  must(u.protocol === 'https:' && ['instagram.com', 'www.instagram.com'].includes(u.hostname) && !u.username && !u.password && !u.port && parts.length === 1 && /^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/.test(name) && !name.includes('..') && !['p','reel','reels','stories','explore','accounts','direct','about','developer','legal','privacy','web','tv'].includes(name), 'INPUT_URL', 'O endereço deve ser de um perfil, não de um post, reel ou domínio semelhante.');
  return { username: name, profile: `https://www.instagram.com/${name}/` };
}
export function jobIdentity(bot, chat, message, secret) {
  must(/^\d+$/.test(String(bot)) && /^-?\d+$/.test(String(chat)) && /^\d+$/.test(String(message)), 'INPUT_EVENT', 'Evento Telegram sem identificadores válidos.');
  return createHmac('sha256', secret).update(`${bot}:${chat}:${message}`).digest('hex').slice(0, 24);
}
export const STAGES = ['preflight','collect','curate','brief','generate','audit','publish'];
export const STAGE_TEXT = {
  preflight: 'Validando configuração e permissões de publicação.', collect: 'Coletando perfil e baixando as imagens.',
  curate: 'Avaliando imagens e comparando finalistas.', brief: 'Preparando direção criativa e textos comprovados.',
  generate: 'Criando o site com a chamada única do Claude.', audit: 'Revisando o site em quatro larguras de tela.', publish: 'Publicando e verificando o GitHub Pages.'
};
export function inside(root, relative) {
  must(typeof relative === 'string' && !relative.includes('\\') && !relative.includes('%') && !relative.startsWith('/') && !relative.split('/').includes('..'), 'PATH', 'Caminho fora do contrato.');
  const out = path.resolve(root, relative);
  must(out.startsWith(path.resolve(root) + path.sep), 'PATH', 'Caminho fora do diretório do trabalho.'); return out;
}
export function safeError(e) {
  return e instanceof Fault ? { code: e.code, message: e.message } : { code: 'INTERNAL', message: 'Falha interna; consulte o relatório privado pelo jobId.' };
}
