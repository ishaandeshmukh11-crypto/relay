FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx next build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
RUN apk add --no-cache wget \
  && addgroup -S relay && adduser -S relay -G relay
COPY --from=build /app ./
USER relay
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ | head -c 1 || exit 1
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
