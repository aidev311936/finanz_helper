FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack prepare pnpm@9.12.2 --activate
RUN pnpm install
COPY . .
EXPOSE 5173
CMD ["pnpm","dev"]
