# syntax=docker/dockerfile:1
#
# Imagen solo OpenRouter: sin Ollama, sin Whisper local, sin CUDA/GPU.
# Chat, embeddings y STT se resuelven contra https://openrouter.ai.

FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
# LanceDB trae transformers/onnx como opcionales para embeddings locales;
# esta imagen solo usa OpenRouter, así que no hacen falta (~800 MB).
RUN npm run build \
  && npm prune --omit=dev \
  && rm -rf node_modules/@huggingface node_modules/onnxruntime-node node_modules/onnxruntime-web

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    LLM_PREFERENCE=remote_only \
    EMBEDDING_PROVIDER=openrouter \
    WHISPER_API_URL=https://openrouter.ai/api \
    USAGE_FILE=/data/usage.json

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY seed ./seed
COPY docker/entrypoint.sh /usr/local/bin/idearium-entrypoint

RUN chmod +x /usr/local/bin/idearium-entrypoint \
  && mkdir -p /vault /data \
  && chown -R node:node /app /vault /data

USER node

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/idearium-entrypoint"]
