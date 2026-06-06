FROM node:20-alpine

WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm install --production

# Copy app
COPY backend/ ./backend/
COPY frontend/ ./frontend/

EXPOSE 5000

WORKDIR /app/backend
CMD ["node", "server.js"]
