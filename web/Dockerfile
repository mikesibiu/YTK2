FROM node:18-alpine

WORKDIR /app
COPY web/package*.json ./
RUN npm install --omit=dev
COPY web/ ./

EXPOSE 8080
CMD ["node", "server.js"]
