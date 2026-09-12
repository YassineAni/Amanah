FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Least-privilege: node:24-alpine ships a pre-created non-root "node" user
# (uid 1000) for exactly this purpose. Without this the process ran as
# root, the default — unnecessary attack surface for an internet-facing
# API. chown before switching user: tts.ts creates its disk cache
# (audio/tts/) at startup via mkdirSync, which needs write access to
# /app/audio under whichever user actually runs the process.
RUN chown -R node:node /app
USER node
ENV NODE_ENV=production
EXPOSE 8787
CMD ["npm", "start"]
