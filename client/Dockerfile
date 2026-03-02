FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
COPY client/package.json client/package.json
COPY shared/package.json shared/package.json
RUN npm ci --workspaces --include-workspace-root=false

FROM node:20-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=shared && npm run build --workspace=client

FROM nginx:1.27-alpine AS runtime

COPY client/nginx.client.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html

EXPOSE 8080
