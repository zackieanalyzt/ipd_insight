# Use the official Node.js 20 lightweight Alpine image
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY --chown=node:node package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy the rest of the application files
COPY --chown=node:node . .

# Drop privileges — the base image ships an unprivileged "node" user (uid 1000).
# NOTE: bind-mounted config.json and sync_history.log must be writable by uid
# 1000 on the host, otherwise the admin config/sync endpoints will fail with EACCES.
USER node

# Expose the application port (matching the port in config.json)
EXPOSE 3355

# Liveness probe against a cheap in-memory endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3355/api/status || exit 1

# Start the application using the package.json script
# This script launches node with --max-old-space-size=4096 to prevent memory crashes with large CSVs
CMD ["npm", "start"]
