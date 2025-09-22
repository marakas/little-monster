# Small, fast Bun image
FROM oven/bun:latest

WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --ci

COPY . .
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "start"]