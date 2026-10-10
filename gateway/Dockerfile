# Gateway de WhatsApp do CRM da mentoria.
#   docker compose up -d --build     (ver LEIA-ME.md)

FROM node:22-bookworm-slim AS dependencias
WORKDIR /app
# A libsignal do Baileys vem do GitHub (git+ssh no lock). Sem chave SSH no build, vai por https.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim
# 512 MB por processo: o primeiro histórico de uma conta grande não cabe em menos (revisão V1).
# Vale para o supervisor e para cada sessão (os filhos herdam). Medir no piloto e baixar se sobrar.
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=512 \
    SESSAO_MEMORIA_MB=512 \
    DADOS_DIR=/dados \
    GATEWAY_HOST=0.0.0.0 \
    GATEWAY_PORTA=8080
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY package.json *.mjs ./
RUN mkdir -p /dados && chown node:node /dados && chmod 700 /dados
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
CMD ["node", "gateway.mjs"]
