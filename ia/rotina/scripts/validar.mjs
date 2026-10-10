#!/usr/bin/env node
// Uso: node scripts/validar.mjs <analise.json> [--lote <lote.txt>]
// Sem dependencias (a rotina roda com rede "None"). Sai com codigo 1 se houver erro.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(aqui, '..', 'contrato', 'schema.json'), 'utf8'));
const erros = [];
const err = (p, m) => erros.push(`${p || '$'}: ${m}`);

const FORMATOS = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^\d{4}-\d{2}-\d{2}$/,
};
const tipoDe = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const casaTipo = (v, t) => tipoDe(v) === t || (t === 'number' && tipoDe(v) === 'integer');
const resolver = (s) => (s.$ref ? resolver(s.$ref.replace('#/', '').split('/').reduce((o, k) => o[k], schema)) : s);

function validar(v, s, p, saida = erros) {
  s = resolver(s);
  const e = (m) => saida.push(`${p || '$'}: ${m}`);
  if (s.anyOf) {
    if (!s.anyOf.some((alt) => { const t = []; validar(v, alt, p, t); return t.length === 0; })) e('nao casa com nenhuma alternativa');
    return;
  }
  if ('const' in s && v !== s.const) return e(`deve ser ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(v)) return e(`valor ${JSON.stringify(v)} fora de [${s.enum.join(', ')}]`);
  if (s.type) {
    const tipos = [].concat(s.type);
    if (!tipos.some((t) => casaTipo(v, t))) return e(`tipo ${tipoDe(v)}, esperado ${tipos.join('|')}`);
  }
  if (typeof v === 'string') {
    if (s.maxLength !== undefined && [...v].length > s.maxLength) e(`texto com ${[...v].length} caracteres (max ${s.maxLength})`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) e(`nao casa com ${s.pattern}`);
    if (s.format && FORMATOS[s.format] && !FORMATOS[s.format].test(v)) e(`formato ${s.format} invalido`);
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) e(`menor que ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) e(`maior que ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.maxItems !== undefined && v.length > s.maxItems) e(`${v.length} itens (max ${s.maxItems})`);
    if (s.items) v.forEach((x, i) => validar(x, s.items, `${p}[${i}]`, saida));
  }
  if (tipoDe(v) === 'object') {
    for (const k of s.required || []) if (!(k in v)) e(`falta o campo "${k}"`);
    for (const [k, x] of Object.entries(v)) {
      if (s.properties?.[k]) validar(x, s.properties[k], p ? `${p}.${k}` : k, saida);
      else if (s.additionalProperties === false) e(`campo nao previsto "${k}"`);
    }
  }
}

// Regras de coerencia (o servidor aplica as mesmas no zod)
const COMERCIAIS = new Set(['cliente', 'lead']);
function coerencia(a) {
  const vistos = new Set();
  (a.contatos || []).forEach((c, i) => {
    const p = `contatos[${i}]`;
    if (vistos.has(c.ref)) err(p, `ref ${c.ref} repetida`);
    vistos.add(c.ref);
    const daConversa = (r) => r === null || r.startsWith(`${c.ref}.`);
    if (!COMERCIAIS.has(c.categoria)) {
      if (c.etapa_funil !== 'nao_se_aplica') err(p, `categoria ${c.categoria} exige etapa_funil=nao_se_aplica`);
      if (c.status_comercial !== 'sem_interesse_comercial') err(p, `categoria ${c.categoria} exige status_comercial=sem_interesse_comercial`);
      if (c.venda?.houve) err(p, `categoria ${c.categoria} nao pode ter venda`);
    }
    const v = c.venda || {};
    if (v.houve) {
      if (!v.evidencia_ref || !v.evidencia_trecho) err(`${p}.venda`, 'venda exige evidencia_ref e evidencia_trecho');
      if (!daConversa(v.evidencia_ref)) err(`${p}.venda`, `evidencia_ref ${v.evidencia_ref} nao e desta conversa`);
      if (!v.tipo_evidencia) err(`${p}.venda`, 'venda exige tipo_evidencia');
      if (v.confirmada && v.tipo_evidencia !== 'confirmacao_do_vendedor') err(`${p}.venda`, 'confirmada=true so com confirmacao_do_vendedor');
    } else if (v.valor !== null || v.forma !== null || v.produto !== null || v.tipo_evidencia !== null || v.confirmada || v.evidencia_ref !== null || v.evidencia_trecho !== null) {
      err(`${p}.venda`, 'houve=false exige valor, forma, produto, tipo_evidencia, evidencia_ref e evidencia_trecho = null e confirmada=false');
    }
    if ((c.status_comercial === 'venda_ganha') !== Boolean(v.houve)) err(p, 'status venda_ganha <=> venda.houve=true');
    if (c.status_comercial === 'perda_venda' && !c.motivo_perda) err(p, 'perda_venda exige motivo_perda');
    if (c.status_comercial !== 'perda_venda' && c.motivo_perda) err(p, 'motivo_perda so com perda_venda');
    if (['trafego_pago', 'indicacao'].includes(c.origem?.tipo) && !c.origem.evidencia_ref) err(`${p}.origem`, `${c.origem.tipo} exige evidencia_ref`);
    if (!daConversa(c.origem?.evidencia_ref ?? null)) err(`${p}.origem`, 'evidencia_ref nao e desta conversa');
    const pa = c.proxima_acao || {};
    if ((pa.tipo === 'nenhuma') !== (pa.em_dias === null)) err(`${p}.proxima_acao`, 'tipo=nenhuma <=> em_dias=null');
  });
}

// Conferencia contra o arquivo do lote (pega ref, trecho e valor inventados)
const norm = (t) => (t || '').toLowerCase().replace(/\s+/g, ' ').trim();
const numeros = (t) => [...(t || '').matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?/g)]
  .map((m) => Number(m[0].replace(/\./g, '').replace(',', '.')));
function conferirLote(a, txt) {
  const cab = (k) => (txt.match(new RegExp(`^#@ ${k}: (.+)$`, 'm')) || [])[1]?.trim();
  for (const k of ['lote_id', 'partner_id', 'dia']) {
    if (!cab(k)) err('lote', `cabecalho #@ ${k} nao encontrado`);
    else if (a[k] !== cab(k)) err(k, `difere do cabecalho do lote (${cab(k)})`);
  }
  // ref -> Map(refMsg -> corpo). O corpo e o que vem depois do ': ' que fecha o prefixo
  // "[c01.m02] 10:04 EU{sinais}": hora, ref e sinais nunca entram na conferencia.
  const conversas = new Map();
  let atual = null;
  for (const linha of txt.split(/\r?\n/)) {
    const h = linha.match(/^=== (?:CONVERSA|PENDENTE) ([cp]\d+)\b.*===$/);
    if (h) { atual = new Map(); conversas.set(h[1], atual); continue; }
    const m = linha.match(/^\[([cp]\d+\.m\d+)\] \d{1,2}:\d{2} [^:]*?: ?(.*)$/);
    if (m && atual) atual.set(m[1], m[2]);
  }
  const usados = new Set(a.contatos.map((c) => c.ref));
  for (const ref of conversas.keys()) if (!usados.has(ref)) err('contatos', `faltou analisar a conversa ${ref}`);
  a.contatos.forEach((c, i) => {
    const p = `contatos[${i}]`;
    const linhas = conversas.get(c.ref);
    if (!linhas) return err(p, `ref ${c.ref} nao existe no lote`);
    const checar = (refMsg, trecho, campo) => {
      if (!refMsg) return;
      const corpo = linhas.get(refMsg);
      if (corpo === undefined) return err(`${p}.${campo}`, `mensagem ${refMsg} nao existe no lote`);
      if (trecho && !norm(corpo).includes(norm(trecho))) err(`${p}.${campo}`, `evidencia_trecho nao aparece literalmente no texto de ${refMsg}`);
    };
    checar(c.origem.evidencia_ref, c.origem.evidencia_trecho, 'origem');
    if (c.venda.houve) {
      checar(c.venda.evidencia_ref, c.venda.evidencia_trecho, 'venda');
      const todos = [...linhas.values()].flatMap(numeros);
      if (c.venda.valor !== null && !todos.includes(c.venda.valor)) err(`${p}.venda`, `valor ${c.venda.valor} nao esta escrito nas mensagens da conversa: use null`);
    }
  });
}

const args = process.argv.slice(2);
const arq = args[0];
const loteArq = args.includes('--lote') ? args[args.indexOf('--lote') + 1] : null;
let analise;
try { analise = JSON.parse(readFileSync(arq, 'utf8')); } catch (e) { console.error(`JSON invalido: ${e.message}`); process.exit(1); }
validar(analise, schema, '');
if (erros.length === 0) coerencia(analise);
if (erros.length === 0 && loteArq) conferirLote(analise, readFileSync(loteArq, 'utf8'));
if (erros.length) { console.error(`${erros.length} erro(s):\n- ${erros.slice(0, 40).join('\n- ')}`); process.exit(1); }
console.log(`OK: ${analise.contatos.length} contatos, contrato v${analise.versao_contrato}`);
