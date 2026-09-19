FROM node:22-bookworm-slim AS build
WORKDIR /app/companion
COPY companion/package.json companion/package-lock.json ./
RUN npm ci --ignore-scripts --registry=https://registry.npmjs.org
COPY companion/index.html companion/vite.config.js ./
COPY companion/src ./src
COPY companion/shared ./shared
COPY companion/public ./public
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts --registry=https://registry.npmjs.org

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3210 BIND_HOST=0.0.0.0 DEPLOYMENT_MODE=private
WORKDIR /app/companion
COPY --from=build /app/companion/node_modules ./node_modules
COPY --from=build /app/companion/dist ./dist
COPY companion/package.json ./
COPY companion/server ./server
COPY companion/shared ./shared
COPY output/Skye_Animated.glb output/Skye_Preview.png /app/output/
COPY companion/assets ./assets
RUN mkdir -p /app/companion/data && chown node:node /app/companion/data
USER node
EXPOSE 3210
CMD ["node", "server/index.js", "--production"]
