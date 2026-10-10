import { useEffect, useState } from "react";

export function useInstalarApp() {
  const [evento, setEvento] = useState<any>(null);
  const [instalado, setInstalado] = useState(
    () => matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true,
  );

  useEffect(() => {
    const antes = (e: Event) => {
      e.preventDefault();
      setEvento(e);
    };
    const depois = () => {
      setInstalado(true);
      setEvento(null);
    };
    addEventListener("beforeinstallprompt", antes);
    addEventListener("appinstalled", depois);
    return () => {
      removeEventListener("beforeinstallprompt", antes);
      removeEventListener("appinstalled", depois);
    };
  }, []);

  return {
    instalado,
    podeInstalar: !!evento,
    instalar: async () => {
      await evento?.prompt();
      await evento?.userChoice;
      setEvento(null);
    },
    dicaIos: !instalado && /iphone|ipad|ipod/i.test(navigator.userAgent),
  };
}
