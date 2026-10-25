FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json *.mjs ./
COPY --chown=node:node public ./public
COPY --chown=node:node extensions/1688-collector ./extensions/1688-collector
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3080
CMD ["node", "server.mjs"]
