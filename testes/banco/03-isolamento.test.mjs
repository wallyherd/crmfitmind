// RLS e permissões com o JWT do usuário (o que o navegador faz com supabase-js).
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { novoBanco, MIGRACOES, FASE1, comoUsuario, comoPapel, tentar, criarUsuario, popularEmpresa } from './pg.mjs';

const NEGADO = /permission denied/;

// Funções de ação: não checam quem chama, então só o servidor executa.
const REVOGADAS = [
  [`SELECT public.bootstrap_empresa_completa(NULL, 'Invasora')`, []],
  [`SELECT public.bot_registrar_no_cartao($1, 'texto injetado', 'entrada')`, ['conversaId']],
  [`SELECT public.bot_vincular_cartao($1)`, ['conversaId']],
  [`SELECT public.bot_bloquear_conexao($1, 'bloqueio alheio')`, ['conexaoId']],
  [`SELECT public.bot_escolher_conexao('parceiro', $1)`, ['partnerId']],
  [`SELECT public.bot_contar_envio($1)`, ['conexaoId']],
  [`SELECT * FROM public.bot_confirmar_verificacao('TOKEN', '5565999999999')`, []],
];

for (const [cenario, extras] of [['instalador', []], ['instalador + 001', MIGRACOES], ['instalador + 001 + 002', FASE1]]) {
  describe(`isolamento entre empresas (${cenario})`, () => {
    let db, A, B, admin, vencido, suspenso;

    before(async () => {
      db = await novoBanco({ extras });
      A = await popularEmpresa(db, await criarUsuario(db, { email: 'a@x.com', empresa: 'Empresa A' }), '5565900000001');
      B = await popularEmpresa(db, await criarUsuario(db, { email: 'b@x.com', empresa: 'Empresa B' }), '5565900000002');
      admin = await criarUsuario(db, { email: 'admin@x.com', admin: true });
      vencido = await criarUsuario(db, { email: 'vencido@x.com', expiraEm: '2020-01-01T00:00:00Z' });
      suspenso = await criarUsuario(db, { email: 'suspenso@x.com', status: 'suspenso' });
      for (const u of [vencido, suspenso]) {
        await db.query(
          `INSERT INTO public.partner_members (partner_id, profile_id, papel, permissoes) VALUES ($1, $2, 'membro', '{robo,crm}')`,
          [A.partnerId, u.profileId]);
      }
    });

    // Quantas linhas de cada tabela o usuário enxerga da empresa E.
    const visiveis = (uid, E) => comoUsuario(db, uid, async () => {
      const n = async (sql, v) => (await db.query(sql, [v])).rows.length;
      return {
        bot_conexoes: await n(`SELECT id FROM public.bot_conexoes WHERE id = $1`, E.conexaoId),
        bot_conversas: await n(`SELECT id FROM public.bot_conversas WHERE id = $1`, E.conversaId),
        bot_mensagens: await n(`SELECT id FROM public.bot_mensagens WHERE conversa_id = $1`, E.conversaId),
        crm_cartoes: await n(`SELECT id FROM public.crm_cartoes WHERE id = $1`, E.cartaoId),
        ia_relatorios_diarios: await n(`SELECT id FROM public.ia_relatorios_diarios WHERE partner_id = $1`, E.partnerId),
        partners: await n(`SELECT id FROM public.partners WHERE id = $1`, E.partnerId),
      };
    });
    const TUDO = { bot_conexoes: 1, bot_conversas: 1, bot_mensagens: 1, crm_cartoes: 1, ia_relatorios_diarios: 1, partners: 1 };
    const NADA = { bot_conexoes: 0, bot_conversas: 0, bot_mensagens: 0, crm_cartoes: 0, ia_relatorios_diarios: 0, partners: 0 };

    test('cada usuário lê só a própria empresa', async () => {
      assert.deepEqual(await visiveis(A.uid, A), TUDO);
      assert.deepEqual(await visiveis(A.uid, B), NADA);
      assert.deepEqual(await visiveis(B.uid, B), TUDO);
      assert.deepEqual(await visiveis(B.uid, A), NADA);
    });

    test('admin ativo lê as duas; conta vencida ou suspensa não lê nada', async () => {
      assert.deepEqual(await visiveis(admin.uid, A), TUDO);
      assert.deepEqual(await visiveis(admin.uid, B), TUDO);
      assert.deepEqual(await visiveis(vencido.uid, A), NADA);
      assert.deepEqual(await visiveis(suspenso.uid, A), NADA);
    });

    test('sem login (anon) não lê tabela nenhuma', async () => {
      await comoPapel(db, 'anon', null, async () => {
        for (const t of ['bot_conexoes', 'bot_conversas', 'bot_mensagens', 'crm_cartoes', 'profiles', 'partners', 'ia_relatorios_diarios']) {
          const r = await tentar(db, `SELECT id FROM public.${t} LIMIT 1`);
          assert.match(r.erro || '', NEGADO, `anon leu ${t}`);
        }
      });
    });

    test('ninguém do navegador lê webhook_segredo nem a config com tokens', async () => {
      await comoUsuario(db, A.uid, async () => {
        assert.match((await tentar(db, `SELECT webhook_segredo FROM public.bot_conexoes`)).erro || '', NEGADO);
        assert.match((await tentar(db, `SELECT * FROM public.bot_conexoes`)).erro || '', NEGADO);
        const ok = await tentar(db, `SELECT id, nome, status, owner_id FROM public.bot_conexoes`);
        assert.equal(ok.linhas?.length, 1);
        assert.match((await tentar(db, `SELECT github_token FROM public.ia_retroalimentacao_config`)).erro || '', NEGADO);
      });
      await comoUsuario(db, admin.uid, async () => {
        assert.match((await tentar(db, `SELECT webhook_segredo FROM public.bot_conexoes`)).erro || '', NEGADO);
      });
      await comoPapel(db, 'anon', null, async () => {
        assert.match((await tentar(db, `SELECT webhook_segredo FROM public.bot_conexoes`)).erro || '', NEGADO);
      });
    });

    test('authenticated e anon não executam as funções de ação', async () => {
      for (const papel of ['authenticated', 'anon']) {
        await comoPapel(db, papel, papel === 'anon' ? null : A.uid, async () => {
          for (const [sql, args] of REVOGADAS) {
            const r = await tentar(db, sql, args.map((k) => B[k]));
            assert.match(r.erro || '', NEGADO, `${papel} executou: ${sql}`);
          }
        });
      }
      const { rows: [c] } = await db.query(`SELECT bloqueado_em FROM public.bot_conexoes WHERE id = $1`, [B.conexaoId]);
      assert.equal(c.bloqueado_em, null);
    });

    test('as funções das policies continuam executáveis pelo usuário', async () => {
      await comoUsuario(db, A.uid, async () => {
        const r = await tentar(db, `SELECT public.partner_pode($1, 'crm') AS minha, public.partner_pode($2, 'crm') AS alheia,
                                           public.crm_acesso_quadro($3) AS quadro, public.bot_acesso_conexao($4) AS conexao`,
          [A.partnerId, B.partnerId, A.quadroId, A.conexaoId]);
        assert.deepEqual(r.linhas, [{ minha: true, alheia: false, quadro: true, conexao: true }]);
      });
    });

    test('escrita respeita a empresa e os gatilhos continuam disparando', async () => {
      await comoUsuario(db, A.uid, async () => {
        const novo = await tentar(db, `INSERT INTO public.crm_cartoes (quadro_id, coluna_id, titulo) VALUES ($1, $2, 'Meu') RETURNING id`,
          [A.quadroId, A.colunaId]);
        assert.equal(novo.linhas?.length, 1, novo.erro);
        const alheio = await tentar(db, `INSERT INTO public.crm_cartoes (quadro_id, coluna_id, titulo) VALUES ($1, $2, 'Invasor')`,
          [B.quadroId, B.colunaId]);
        assert.match(alheio.erro || '', /row-level security/);

        // gatilhos com função sem EXECUTE para o authenticated: precisam rodar mesmo assim
        // (com a 002 o navegador não grava mais "entrada": só enfileira campanha, ver 04-fase1)
        const msg = await tentar(db, `INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo) VALUES ($1, 'entrada', 'nova')`, [A.conversaId]);
        if (cenario.includes('002')) assert.match(msg.erro || '', /so enfileira mensagem de campanha/);
        else assert.equal(msg.erro, undefined);
        const { rows: cols } = await db.query(`SELECT id FROM public.crm_colunas WHERE quadro_id = $1 ORDER BY posicao`, [A.quadroId]);
        const mov = await tentar(db, `UPDATE public.crm_cartoes SET coluna_id = $1 WHERE id = $2`, [cols[1].id, A.cartaoId]);
        assert.equal(mov.erro, undefined);

        // o usuário não se promove nem mexe no cadastro
        assert.match((await tentar(db, `UPDATE public.profiles SET role = 'admin' WHERE user_id = $1`, [A.uid])).erro || '', NEGADO);
        assert.match((await tentar(db, `INSERT INTO public.partner_members (partner_id, profile_id) VALUES ($1, $2)`,
          [B.partnerId, A.profileId])).erro || '', NEGADO);
      });
      const { rows: [hist] } = await db.query(
        `SELECT count(*)::int AS n FROM public.crm_atividades WHERE cartao_id = $1 AND tipo = 'mudanca_coluna'`, [A.cartaoId]);
      assert.equal(hist.n, 1);
    });
  });
}
