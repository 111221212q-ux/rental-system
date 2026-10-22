FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache su-exec

# Install deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app
COPY backend/ ./backend/
COPY frontend/ ./frontend/

EXPOSE 5000

ENV NODE_ENV=production
ENV SQLITE_PATH=/data/rental.sqlite
ENV BACKUP_DIR=/data/backups

RUN mkdir -p /data && chown node:node /data

COPY backend/docker-entrypoint.sh /usr/local/bin/rental-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/rental-entrypoint && chmod 755 /usr/local/bin/rental-entrypoint

ENTRYPOINT ["/usr/local/bin/rental-entrypoint"]

WORKDIR /app/backend
CMD ["node", "server.js"]
