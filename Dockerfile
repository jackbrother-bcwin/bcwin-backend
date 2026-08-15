FROM oven/bun:latest AS base
WORKDIR /usr/src/app

USER root

RUN apt-get update && apt-get install -y openssl --no-install-recommends

COPY package.json ./

RUN bun install --frozen-lockfile

COPY . .

RUN DATABASE_URL=postgresql://root:root@db:5432/bcwin bunx prisma generate --schema=packages/db/schema.prisma

RUN chmod +x scripts/entrypoint.sh

EXPOSE 3000

# Migrate then start — prevents schema drift (works-local/fails-prod)
ENTRYPOINT ["./scripts/entrypoint.sh"]
CMD [ "bun", "run", "apps/api/src/index.ts" ]