ARG VARIANT=24-alpine
FROM node:${VARIANT}

WORKDIR /app-server

COPY package.container.json ./package.json
COPY package-lock.json ./package-lock.json
COPY ./dist ./dist

# Install only production dependencies
RUN npm install --omit=dev

EXPOSE 8080

#CMD [ "node", "-r", "tsconfig-paths/register", "dist/index.js"]
CMD [ "node", "dist/index.js"]
