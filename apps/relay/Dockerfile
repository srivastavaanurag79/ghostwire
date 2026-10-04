FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-package-lock
COPY relay.mjs server.mjs ./
ENV HOST=0.0.0.0
EXPOSE 8787
CMD ["node", "server.mjs", "--port", "8787", "--host", "0.0.0.0"]
