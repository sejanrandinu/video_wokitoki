# Use Node.js LTS
FROM node:20-slim

# Create app directory
WORKDIR /app

# Install build tools for sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm install

# Copy all files
COPY . .

# Build the React frontend
RUN npm run build

# Expose the port HF Spaces expects (7860)
EXPOSE 7860

# Set environment variable for PORT
ENV PORT=7860

# Command to run the server
CMD ["npm", "start"]
