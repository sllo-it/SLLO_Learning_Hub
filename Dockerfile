FROM node:20-alpine

# Create directory space inside the isolated container layer
WORKDIR /usr/src/app

# Copy dependency mappings over first to take advantage of Docker caching speeds
COPY package*.json ./

# Run clean production installation command sequence
RUN npm ci --only=production

# Bundle all remaining workspace scripts, game files, and sheets assets
COPY . .

# Match the port runtime parameter requested for host broadcasting
EXPOSE 8082

# Ignition trigger
CMD [ "node", "server.js" ]