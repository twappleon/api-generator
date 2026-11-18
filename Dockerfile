# Dedicated root Dockerfile for the grok paper-only feature branch.
FROM node:22-alpine
WORKDIR /app
COPY grok_paper_auto/engine.mjs grok_paper_auto/server.mjs ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node","server.mjs"]
