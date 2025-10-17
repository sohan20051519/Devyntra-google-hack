FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci || npm install

# Copy source and build
COPY . .
RUN npm run build --if-present || echo "No build script found"

# Serve built app on 8080 for Cloud Run
RUN npm i -g serve
EXPOSE 8080
CMD ["serve","-s","dist","-l","8080"]



