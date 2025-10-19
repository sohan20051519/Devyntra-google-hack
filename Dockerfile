FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci || npm install

# Copy source and build
COPY . .
RUN npm run build --if-present || echo "No build script found"

# Expose the port the app runs on
EXPOSE 8080

# Start the production server
CMD ["node", "server.js"]
