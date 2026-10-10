#!/usr/bin/env bash
# Chamadas ao CRM. NAO ponha Authorization aqui: o ambiente da rotina injeta o token crmia_.
set -euo pipefail
BASE="https://crm-fitmind-whatsapp.vercel.app/api/ia"
cmd="${1:-}"; shift || true

reserva_de() { grep -m1 '^#@ reserva_id: ' "/tmp/lote-$1.txt" 2>/dev/null | cut -d' ' -f3 | tr -d '\r' || true; }

case "$cmd" in
  pendentes)
    curl -sS -w '\nHTTP %{http_code}\n' "$BASE/pendentes?limite=3" ;;
  reservar)
    id="$1"; out="/tmp/lote-$id.txt"
    code=$(curl -sS -o "$out" -w '%{http_code}' -X POST "$BASE/lotes/$id/reservar")
    if [ "$code" != 200 ]; then echo "HTTP $code"; cat "$out"; exit 1; fi
    if [ -z "$(reserva_de "$id")" ]; then echo "lote sem #@ reserva_id"; exit 1; fi
    echo "OK $out ($(wc -l <"$out") linhas)" ;;
  enviar)
    id="$1"; json="$2"; reserva=$(reserva_de "$id")
    curl -sS -w '\nHTTP %{http_code}\n' -X POST "$BASE/resultado" \
      -H 'Content-Type: application/json' -H "X-Reserva-Id: $reserva" --data-binary "@$json" ;;
  falha)
    id="$1"; motivo=$(printf '%s' "${2:-sem motivo}" | head -c 300); reserva=$(reserva_de "$id")
    body=$(node -e 'console.log(JSON.stringify({motivo: process.argv[1]}))' "$motivo")
    curl -sS -w '\nHTTP %{http_code}\n' -X POST "$BASE/lotes/$id/falha" \
      -H 'Content-Type: application/json' -H "X-Reserva-Id: $reserva" --data "$body" ;;
  *) echo "uso: crm.sh pendentes | reservar <id> | enviar <id> <json> | falha <id> <motivo>"; exit 2 ;;
esac
