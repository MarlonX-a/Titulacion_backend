# syntax=docker/dockerfile:1
# Imagen del backend. Sin secretos: la configuración llega por variables de entorno y los
# archivos de claves se montan en tiempo de ejecución (JWT_*_PATH, OUTBOX_ENCRYPTION_KEY_PATH).

# node:22-alpine (digest resuelto con `docker buildx imagetools inspect node:22-alpine`)
ARG NODE_IMAGE=node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
# /healthz es público, devuelve un cuerpo constante y pasa por el límite global de solicitudes,
# que falla abierto: refleja la salud del proceso, no la de Redis (una caída de Redis no reinicia
# el contenedor; el login y las rutas con @RateLimit responden 503 mientras dure).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main"]
