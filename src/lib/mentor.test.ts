// Roda com: node --test src/lib/mentor.test.ts  (Node >= 23.6 executa TypeScript direto)
import { test } from "node:test";
import assert from "node:assert/strict";
import { ordenarPorAtencao, resumoDeContagens, situacaoDaLinha, textoSinal } from "./mentor.ts";
import { abaDoCaminho, ABAS_SO_ADMIN } from "./rotas.ts";

const linha = (empresa: string, alertas: string[], esperando = 0) =>
  ({ empresa, alertas, numeros: { esperando_voce: esperando } }) as any;

test("sem alerta é tudo certo; só alerta âmbar é vale olhar; qualquer vermelho é precisa de ajuda", () => {
  assert.equal(situacaoDaLinha(linha("A", [])), "ok");
  assert.equal(situacaoDaLinha(linha("A", ["vendas_a_confirmar", "acesso_vencendo"])), "olhar");
  assert.equal(situacaoDaLinha(linha("A", ["acesso_vencendo", "conexao_sem_sinal"])), "ajuda");
});

test("quem precisa de ajuda vem primeiro; empate: mais clientes esperando, depois o nome", () => {
  const ordem = ordenarPorAtencao([
    linha("Zeta", []),
    linha("Beta", ["acesso_vencendo"]),
    linha("Alfa", []),
    linha("Gama", ["conexao_sem_sinal", "sem_conversa_2_dias"]),
    linha("Delta", [], 4),
  ]).map((l) => l.empresa);
  assert.deepEqual(ordem, ["Gama", "Beta", "Delta", "Alfa", "Zeta"]);
});

test("a ordenação não muda a lista original e o resumo conta cada grupo", () => {
  const lista = [linha("B", []), linha("A", ["analise_com_erro"])];
  ordenarPorAtencao(lista);
  assert.equal(lista[0].empresa, "B");
  assert.deepEqual(resumoDeContagens(lista), { ajuda: 1, olhar: 0, ok: 1 });
});

test("alerta desconhecido não quebra", () => {
  assert.equal(situacaoDaLinha(linha("A", ["novo_alerta"])), "olhar");
});

test("texto do sinal da conexão", () => {
  assert.equal(textoSinal(null), "nunca deu sinal");
  assert.equal(textoSinal(0), "sinal agora");
  assert.equal(textoSinal(12), "sinal há 12 min");
  assert.equal(textoSinal(180), "sinal há 3 h");
  assert.equal(textoSinal(60 * 24 * 5), "sinal há 5 dias");
});

test("a tela Mentoria tem endereço próprio e é só do admin", () => {
  assert.equal(abaDoCaminho("/admin/mentoria"), "mentoria");
  assert.ok(ABAS_SO_ADMIN.includes("mentoria"));
});
