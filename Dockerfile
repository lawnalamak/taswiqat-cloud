FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY . .
RUN node build-ui.mjs
EXPOSE 3000
CMD ["node", "backend/app.mjs"]
