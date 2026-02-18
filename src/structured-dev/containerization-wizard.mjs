import { FileTools } from '../tools/file-tools.mjs';

/**
 * Generates Docker configurations for the project.
 */
export class ContainerizationWizard {
    /**
     * @param {string} workspaceRoot 
     */
    constructor(workspaceRoot) {
        this.fileTools = new FileTools(workspaceRoot);
    }

    /**
     * Generates Dockerfile, .dockerignore, and docker-compose.yml.
     * @returns {Promise<{dockerfile: string, dockerIgnore: string, dockerCompose: string}>}
     */
    async generateConfig() {
        let pkg;
        try {
            const packageJsonStr = await this.fileTools.readFile({ path: 'package.json' });
            pkg = JSON.parse(packageJsonStr);
        } catch (e) {
            return { error: "No valid package.json found. Currently only Node.js projects are supported." };
        }

        const nodeVersion = pkg.engines?.node?.replace(/[^\d.]/g, '') || '20';
        const isBuildRequired = !!(pkg.scripts && pkg.scripts.build);
        const startCommand = pkg.scripts && pkg.scripts.start ? 'npm start' : 'node index.js';

        const dockerfile = this._generateDockerfile(nodeVersion, isBuildRequired, startCommand);
        const dockerIgnore = this._generateDockerIgnore();
        const dockerCompose = this._generateDockerCompose(pkg.name || 'app');

        return {
            dockerfile,
            dockerIgnore,
            dockerCompose
        };
    }

    _generateDockerfile(nodeVersion, isBuildRequired, startCommand) {
        let content = `# Stage 1: Build
FROM node:${nodeVersion}-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
`;

        if (isBuildRequired) {
            content += `RUN npm run build\n\n`;
        } else {
            content += `\n`;
        }

        content += `# Stage 2: Production
FROM node:${nodeVersion}-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
RUN npm ci --only=production
`;

        if (isBuildRequired) {
            content += `COPY --from=builder /app/dist ./dist\n`;
            // Assuming build output is in dist/ - this is a heuristic
        } else {
            content += `COPY --from=builder /app/src ./src\n`;
            // Copy src if no build step, assuming source is needed at runtime
            // Or copy everything from builder if structure is complex, but let's be safe:
            content += `COPY --from=builder /app .\n`; 
        }

        content += `
USER node
EXPOSE 3000
CMD [${startCommand.split(' ').map(s => `"${s}"`).join(', ')}]
`;
        return content;
    }

    _generateDockerIgnore() {
        return `node_modules
npm-debug.log
Dockerfile
.dockerignore
.git
.gitignore
README.md
dist
build
coverage
`;
    }

    _generateDockerCompose(serviceName) {
        return `version: '3.8'
services:
  ${serviceName}:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    restart: always
`;
    }
}
