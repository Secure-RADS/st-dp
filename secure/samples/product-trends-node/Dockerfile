FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY main.js ./
COPY gen ./gen

ENTRYPOINT ["node", "/app/main.js"]
