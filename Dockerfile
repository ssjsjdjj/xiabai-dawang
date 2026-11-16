FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8765
COPY --chown=node:node package.json preview.html ./
COPY --chown=node:node src ./src
COPY --chown=node:node server ./server
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data
USER node
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node -e "require('http').get('http://127.0.0.1:8765/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server/index.js"]
