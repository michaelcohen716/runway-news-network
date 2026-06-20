# Runway News Network — single image, two processes (web + worker).
# ffmpeg is installed natively for the Step 7 stitching stage.
FROM node:20-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ffmpeg ca-certificates fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── deps ─────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── build (Next.js) ──────────────────────────────────────────────────────────
FROM base AS build
# NEXT_PUBLIC_* values are inlined at build time, so they must be present here.
# Railway passes service variables as build args when declared with ARG.
ARG NEXT_PUBLIC_RNN_FINAL_ONLY
ENV NEXT_PUBLIC_RNN_FINAL_ONLY=$NEXT_PUBLIC_RNN_FINAL_ONLY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=build /app/.next ./.next

# Deployed as TWO services off this one image, overriding the command:
#   web    →  npm run start          (next start)
#   worker →  npm run worker         (tsx worker/index.ts)
EXPOSE 3000
CMD ["npm", "run", "start"]
