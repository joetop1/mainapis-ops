FROM node:22-alpine
RUN apk add --no-cache python3
WORKDIR /app
COPY --chown=node:node package.json *.mjs ./
COPY --chown=node:node public ./public
COPY --chown=node:node scripts/parse-supplier-xlsx.py scripts/supplier_grid.py scripts/supplier_capacity.py ./scripts/
COPY --chown=node:node extensions/1688-collector ./extensions/1688-collector
COPY --chown=node:node integrations/yunzhong/ops-bridge ./integrations/yunzhong/ops-bridge
COPY --chown=node:node integrations/shopxo/bridge ./integrations/shopxo/bridge
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3080
CMD ["node", "server.mjs"]
