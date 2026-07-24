# Use the official Node.js 20 lightweight Alpine image
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy the rest of the application files
COPY . .

# Expose the application port (matching the port in config.json)
EXPOSE 3355

# Start the application using the package.json script
# This script launches node with --max-old-space-size=4096 to prevent memory crashes with large CSVs
CMD ["npm", "start"]
