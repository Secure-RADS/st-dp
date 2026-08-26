FROM node:24-alpine

COPY main.ts /app/main.ts

# Node 24 strips TypeScript types natively - no build step or tsc needed.
ENTRYPOINT ["node", "/app/main.ts"]
