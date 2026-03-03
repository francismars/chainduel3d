FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci --workspaces --include-workspace-root=false

FROM node:20-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=shared && npm run build --workspace=server

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci --omit=dev --workspace=server --include-workspace-root=false

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/data ./server/dist/server/data

EXPOSE 3000
CMD ["node", "--experimental-specifier-resolution=node", "server/dist/server/src/server.js"]
