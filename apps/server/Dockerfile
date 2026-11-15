# syntax=docker/dockerfile:1.7
# apps/server imajı. Build bağlamı: repo kökü (`docker build -f apps/server/Dockerfile .`).
# Hedefler:
#   migrate -> tek seferlik `migrate` / `seed` servisi (prisma CLI + tsx; devDependencies dahil)
#   runtime -> `server` servisi (yalnız prod bağımlılıkları, root olmayan `node` kullanıcısı)
ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d

FROM ${NODE_IMAGE} AS base
# pnpm sürümü kök package.json `packageManager` alanıyla aynı; corepack önbelleği imajın içinde
# (çalışma anında, internetsiz `db` ağında indirme denemesi olmasın).
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@9.15.9 --activate \
 && chmod -R a+rX /opt/corepack
WORKDIR /repo

# Bağımlılıklar + Prisma client üretimi (kaynak değişince yalnız alt katmanlar yenilenir).
FROM base AS tooling
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@remote/server..."
RUN pnpm --filter @remote/server db:generate

# Tek seferlik migration/seed: `pnpm --filter @remote/server db:migrate` (docs/db-notlari.md).
FROM tooling AS migrate
ENV NODE_ENV=production
USER node
CMD ["pnpm", "--filter", "@remote/server", "db:migrate"]

# Yalnız prod bağımlılıkları. Server derlenmez: Node 22 tip ayıklamayla `node src/server.ts`
# çalıştırır (apps/server package.json "start"). Bu yüzden `pnpm deploy` KULLANILMAZ: workspace
# paketleri (packages/contracts, .ts) node_modules altına kopyalanırsa Node .ts'yi reddeder;
# symlink'li workspace yapısı korunur.
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile --prod
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --prod --filter "@remote/server..."
COPY --from=tooling /repo/apps/server/src/generated apps/server/src/generated
# Geliştirme/test betikleri (e2e-real-users.ts, test-db.sh) prod imajına girmez (S-P4-T2-2).
# Ara aşamada silinir; runtime yalnız bu aşamadan kopyaladığı için katmanda da iz kalmaz.
# migrate/seed hedefi (`tooling`) etkilenmez: seed `prisma/seed.ts` kullanır, scripts/ değil.
RUN rm -rf apps/server/scripts

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app
# Dosyalar root'a ait ve salt okunur; süreç `node` (uid 1000) olarak çalışır.
COPY --from=prod-deps /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/packages ./packages
COPY --from=prod-deps /repo/apps/server ./apps/server
# P12 yükleme kökü (UPLOADS_DIR). Kök dosya sistemi salt okunur (compose read_only); yazılabilir tek kalıcı yer
# `uploads` named volume'u. Docker boş named volume'u ilk bağlamada imajdaki bu dizinden doldurur ve sahiplik/izni
# (node:node 0700) kopyalar → ayrı chown/init adımı gerekmez. sharp (libvips) bu taban imajda (Debian bookworm, glibc
# 2.36) npm'deki hazır @img/sharp-linux-{x64,arm64} ikilileriyle çalışır; apt paketi gerekmez (alpine/musl'a geçilirse
# lockfile'daki linuxmusl paketleri kullanılır, yeniden doğrulayın: runbook §16.4).
# P16 imha defteri dizini (`ledger` volume'u, /var/lib/remote; aynı ilk-bağlama kopyası ile node:node 0700).
RUN mkdir -p /data/uploads /var/lib/remote && chown node:node /data/uploads /var/lib/remote \
 && chmod 0700 /data/uploads /var/lib/remote
WORKDIR /app/apps/server
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "src/server.ts"]
