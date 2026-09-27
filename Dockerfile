FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY douyu-engine.js probe.js ./
CMD ["node", "probe.js"]
