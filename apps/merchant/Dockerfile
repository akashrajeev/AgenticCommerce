FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/merchant/package.json apps/merchant/package.json
COPY apps/buyer/package.json apps/buyer/package.json
COPY apps/gateway/package.json apps/gateway/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/schemas/package.json packages/schemas/package.json
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build -w @mandate/types && npm run build -w @mandate/shared && npm run build -w @mandate/schemas && npm run build -w @mandate/merchant

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/merchant ./apps/merchant
COPY --from=builder /app/packages ./packages
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@mandate/merchant"]
