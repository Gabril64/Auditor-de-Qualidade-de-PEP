FROM node:22-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/producer/package*.json ./
RUN npm install

COPY services/producer/tsconfig.json ./
COPY services/producer/src ./src
RUN npm run build && npm prune --omit=dev

COPY db ./db

RUN mkdir -p /app/data

EXPOSE 3001

CMD ["node", "dist/server.js"]
