# WTPM OEE — production image (Next.js standalone server)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
# runtime server
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# migrations, seed data and CLI scripts (npm run db:migrate / db:seed / db:import / db:backup)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/db ./db
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/lib ./src/lib
COPY --from=build /app/tests/fixtures ./tests/fixtures
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /data/uploads /data/backups
ENV UPLOAD_DIR=/data/uploads BACKUP_DIR=/data/backups
EXPOSE 3000
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && node server.js"]
