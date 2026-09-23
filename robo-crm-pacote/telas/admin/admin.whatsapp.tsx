import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, MessageCircle, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createPlatformNumber,
  listPlatformNumbers,
  setPlatformNumberStatus,
  updatePlatformNumber,
  type PlatformNumber,
} from "@/lib/admin-whatsapp.functions";

export const Route = createFileRoute("/_authenticated/admin/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp da plataforma — Admin FitMind Club" },
      {
        name: "description",
        content: "Cadastre e acompanhe os números de WhatsApp usados na confirmação de conta e nos avisos da plataforma.",
      },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "WhatsApp da plataforma — Admin FitMind Club" },
      {
        property: "og:description",
        content: "Números de plantão para confirmação de conta por WhatsApp.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminWhatsapp,
});

const STATUS_LABEL: Record<string, string> = {
  conectado: "conectado",
  desconectado: "desconectado",
  aguardando_qr: "aguardando pareamento",
};

function AdminWhatsapp() {
  const carregar = useServerFn(listPlatformNumbers);
  const criar = useServerFn(createPlatformNumber);
  const atualizar = useServerFn(updatePlatformNumber);
  const mudarStatus = useServerFn(setPlatformNumberStatus);

  const [numeros, setNumeros] = useState<PlatformNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [numero, setNumero] = useState("");
  const [prioridade, setPrioridade] = useState("100");
  const [limite, setLimite] = useState("500");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await carregar({ data: {} } as never)) as { numeros: PlatformNumber[] };
      setNumeros(res.numeros);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, [carregar]);

  useEffect(() => {
    void load();
  }, [load]);

  const adicionar = async () => {
    if (nome.trim().length < 2) {
      toast.error("Dê um nome para o número.");
      return;
    }
    setBusy("novo");
    try {
      await criar({
        data: {
          nome,
          numero: numero || undefined,
          prioridade: Number(prioridade) || 100,
          limiteDiario: Number(limite) || 500,
        },
      });
      setNome("");
      setNumero("");
      toast.success("Número cadastrado.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao cadastrar");
    } finally {
      setBusy(null);
    }
  };

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  const ativos = numeros.filter((n) => !n.arquivado_em);
  const arquivados = numeros.filter((n) => n.arquivado_em);
  const temPlantao = ativos.some((n) => n.status === "conectado" && n.numero);

  return (
    <div className="space-y-6 p-4">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <MessageCircle className="h-5 w-5 text-primary" />
          WhatsApp da plataforma
        </h1>
        <p className="text-xs text-muted-foreground">
          Estes números atendem a confirmação de conta por WhatsApp. Sem nenhum número conectado, o
          cadastro segue apenas por e-mail.
        </p>
      </header>

      <div
        className={`rounded-lg border p-3 text-xs ${
          temPlantao ? "border-primary/40 bg-primary/5 text-foreground" : "border-destructive/40 bg-destructive/5 text-foreground"
        }`}
      >
        {temPlantao
          ? "Há número de plantão conectado — a confirmação por WhatsApp está disponível."
          : "Nenhum número de plantão conectado. A confirmação por WhatsApp fica indisponível até conectar um número."}
      </div>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-bold text-foreground">Novo número</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Plantão FitMind" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Número (com DDI)</Label>
            <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="5566999999999" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Prioridade</Label>
            <Input value={prioridade} onChange={(e) => setPrioridade(e.target.value)} inputMode="numeric" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Limite diário</Label>
            <Input value={limite} onChange={(e) => setLimite(e.target.value)} inputMode="numeric" />
          </div>
        </div>
        <Button size="sm" onClick={() => void adicionar()} disabled={busy === "novo"}>
          {busy === "novo" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Cadastrar
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Depois de cadastrar, use o ID e a chave de conexão no programa conector que fica pareado
          com o celular. Ele envia o status e o número passa a aparecer como conectado.
        </p>
      </section>

      <section className="space-y-2 rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-bold text-foreground">Como deixar o número conectado</p>
        <p className="text-xs text-muted-foreground">
          Quem lê as mensagens do WhatsApp é um programa (o conector) que roda num computador
          ligado e fica pareado com o celular, igual ao WhatsApp Web. Sem ele no ar, a confirmação
          por WhatsApp nem aparece no cadastro.
        </p>
        <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
          <li>
            Copie a pasta <span className="font-mono">conector-whatsapp</span> do projeto para esse computador,
            <b> fora do OneDrive</b> (ex.: <span className="font-mono">C:\conector-whatsapp</span>) — dentro do
            OneDrive a instalação falha com erro <span className="font-mono">EPERM</span>.
          </li>
          <li>
            Instale o Node.js (nodejs.org, versão LTS) e o Google Chrome. No PowerShell, dentro da pasta,
            rode <span className="font-mono">powershell -NoProfile -ExecutionPolicy Bypass -File
            .\instalar-windows.ps1</span>. O reparador limpa instalações incompletas e usa o Chrome já
            instalado — não baixa navegador.
          </li>
          <li>Cadastre o número aqui em cima e copie o <b>ID da conexão</b> e a <b>chave de conexão</b>.</li>
          <li>
            Preencha o arquivo <span className="font-mono">.env</span> com esses dois valores. No Windows,
            crie-o pelo PowerShell com <span className="font-mono">Copy-Item .env.example .env</span> —
            renomear pelo Explorer costuma gerar <span className="font-mono">.env.txt</span>. Se preferir,
            pode preencher o próprio <span className="font-mono">.env.example</span>: o conector também lê dele.
          </li>

          <li>Rode <span className="font-mono">npm start</span>: aparece um QR Code no terminal.</li>
          <li>No celular: WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho → leia o QR.</li>
        </ol>
        <p className="text-[11px] text-muted-foreground">
          Se o número cair, basta rodar <span className="font-mono">npm start</span> de novo — o pareamento fica
          salvo. Não use o mesmo número em outro WhatsApp Web: isso derruba a sessão. Instruções completas
          no arquivo <span className="font-mono">LEIAME.md</span> dentro da pasta.
        </p>
      </section>


      <section className="space-y-3">
        <p className="text-sm font-bold text-foreground">Números cadastrados</p>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
          </div>
        ) : ativos.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum número cadastrado ainda.</p>
        ) : (
          ativos.map((n) => (
            <div key={n.id} className="space-y-2 rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-foreground">{n.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {n.numero ? `+${n.numero}` : "número ainda não informado"} · prioridade {n.prioridade} ·{" "}
                    {n.enviadas_hoje ?? 0}/{n.limite_diario ?? "∞"} hoje
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    n.status === "conectado"
                      ? "bg-primary/15 text-primary"
                      : n.status === "aguardando_qr"
                        ? "bg-muted text-muted-foreground"
                        : "bg-destructive/15 text-destructive"
                  }`}
                >
                  {STATUS_LABEL[n.status] ?? n.status}
                </span>
              </div>
              {n.status_detalhe && <p className="text-[11px] text-muted-foreground">{n.status_detalhe}</p>}
              <p className="text-[11px] text-muted-foreground">
                último sinal: {n.visto_em ? new Date(n.visto_em).toLocaleString("pt-BR") : "nunca"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void copiar(n.id)}>
                  <Copy className="mr-2 h-3.5 w-3.5" /> ID da conexão
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copiar(n.webhook_segredo ?? "")}
                  disabled={!n.webhook_segredo}
                >
                  <Copy className="mr-2 h-3.5 w-3.5" /> Chave de conexão
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setBusy(n.id);
                    try {
                      await mudarStatus({
                        data: { id: n.id, status: n.status === "conectado" ? "desconectado" : "conectado" },
                      });
                      await load();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Falha ao atualizar");
                    } finally {
                      setBusy(null);
                    }
                  }}
                  disabled={busy === n.id}
                >
                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                  {n.status === "conectado" ? "Marcar desconectado" : "Marcar conectado"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    setBusy(n.id);
                    try {
                      await atualizar({ data: { id: n.id, arquivado: true } });
                      await load();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Falha ao arquivar");
                    } finally {
                      setBusy(null);
                    }
                  }}
                  disabled={busy === n.id}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Arquivar
                </Button>
              </div>
            </div>
          ))
        )}
      </section>

      {arquivados.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-bold text-muted-foreground">Arquivados</p>
          {arquivados.map((n) => (
            <div key={n.id} className="flex items-center justify-between rounded-lg border border-border p-2">
              <span className="text-xs text-muted-foreground">{n.nome}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await atualizar({ data: { id: n.id, arquivado: false } });
                  await load();
                }}
              >
                Reativar
              </Button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
