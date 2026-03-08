FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
ENV PROOF_PORT=7000
EXPOSE 7000
CMD ["node", "src/index.js"]
