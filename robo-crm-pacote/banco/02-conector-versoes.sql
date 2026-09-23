-- ============================================================
-- Auto-atualizacao do conector (o programa que roda no PC do cliente).
--
-- O conector pergunta a cada 10 minutos em GET /api/bot/atualizacao se
-- existe versao maior que a dele. Se existir, grava os arquivos que vierem
-- em `arquivos` e reinicia. So conector.mjs e painel.html sao aceitos --
-- a lista fica no proprio conector, para uma resposta adulterada nao
-- conseguir escrever outra coisa no PC do cliente.
--
-- A comparacao de versao e TEXTUAL: use sempre dois digitos em cada parte
-- (1.03.00, 1.10.00). "1.9.0" pareceria maior que "1.10.0".
--
-- Estrutura identica a do banco do FitMind em 11/09/2026.
-- ============================================================

CREATE TABLE public.conector_versoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  versao text NOT NULL,
  arquivos jsonb NOT NULL,
  notas text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.conector_versoes ADD CONSTRAINT conector_versoes_pkey PRIMARY KEY (id);
ALTER TABLE public.conector_versoes ADD CONSTRAINT conector_versoes_versao_key UNIQUE (versao);

-- RLS ligada e nenhuma policy, de proposito: so a service role (a rota do
-- servidor) le. O navegador nao tem o que fazer aqui.
ALTER TABLE public.conector_versoes ENABLE ROW LEVEL SECURITY;
