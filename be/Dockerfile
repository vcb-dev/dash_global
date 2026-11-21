FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib ./lib

ENV PORT=3847
EXPOSE 3847
CMD ["node", "server.js"]
