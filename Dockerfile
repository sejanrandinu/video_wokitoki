# Use Node.js LTS
FROM node:20-slim

# Create app directory
WORKDIR /app

# Install build tools for native modules (sqlite3, bcrypt)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies (postinstall is now removed, so this won't trigger build yet)
RUN npm install

# Copy the rest of the source code
COPY . .

# IMPORTANT: Remove local Windows node_modules if they were copied
RUN rm -rf server/node_modules


# NOW build the React frontend (all files like index.html are now present)
RUN npm run build

# Expose the port HF Spaces expects (7860)
EXPOSE 7860

# Set environment variable for PORT
ENV PORT=7860

# Command to run the server
CMD ["npm", "start"]
