import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";

const UMA_HORA = 3_600_000;

export function AtualizacaoApp() {
  const {
    needRefresh: [precisa],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, registro) => {
      if (registro) setInterval(() => registro.update(), UMA_HORA);
    },
  });

  useEffect(() => {
    if (!precisa) return;
    toast("Nova versão do app", {
      duration: Infinity,
      action: { label: "Atualizar", onClick: () => updateServiceWorker(true) },
    });
  }, [precisa]);

  return null;
}
