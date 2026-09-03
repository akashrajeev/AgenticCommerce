FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/service/package.json apps/service/package.json
RUN npm ci --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY apps/service/package.json apps/service/package.json
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/service/tsconfig.json apps/service/tsconfig.json
COPY apps/service/src apps/service/src
RUN npm --prefix apps/service run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/service/package.json apps/service/package.json
COPY --from=builder /app/apps/service/dist apps/service/dist
EXPOSE 4021
CMD ["npm", "run", "start", "--prefix", "apps/service"]
