# Setup

## Install dependencies
```sh
bun install
```

## Running api services
```sh
bun run dev-api
bun run dev-engine
```

## Scripts
```sh
# Run docker compose services
bun run dev-services

# Apply migrations to database
bun run prisma:migrate:deploy

# Generate code
bun run prisma:generate

# Prisma studio
bun run prisma:studio
```

visit http://localhost:3000/studio to access web api documentation

## Deployment

To keep things simple when running everything (frontend and backend) on single vps, just use pm2 for deployment and setup reverse proxy such as nginx on host level. But if there are multiple servers, use one server just for backend and use docker compose for deployment. ***further traefik (reverse proxy) configuration will be needed in docker compose file for this approach***

**Always migrate before serving traffic.** Docker `ENTRYPOINT` runs `scripts/entrypoint.sh` (`prisma migrate deploy`). PM2 API app uses `bun run start:api` (migrate then API).

### Test-prod DB reset (DESTROYS ALL DATA)

When prod is empty/test-only and schema drift causes `P2022 ColumnNotFound`:

```sh
# stop api/engine first
bun run prisma:reset:prod-test   # migrate reset --force
bun run prisma:seed
# restart pm2 / docker compose
```

Without full reset (migration already applied but columns missing):

```sh
bun run prisma:migrate:deploy    # applies fix_wager_requirement_columns
bun run prisma:migrate:status
```

See `notes/docs/adr/ADR-0011-schema-migrate-deploy-discipline.md`.

## Notes

To disable cache layer uncomment or set `DISABLE_CACHE=1` in **.env** file and restart development server
