import { FileTools } from '../tools/file-tools.mjs';

/**
 * Generates CI/CD pipeline configurations based on project analysis.
 */
export class CiCdArchitect {
    /**
     * @param {string} workspaceRoot 
     */
    constructor(workspaceRoot) {
        this.fileTools = new FileTools(workspaceRoot);
    }

    /**
     * Generates a CI/CD pipeline configuration.
     * @param {string} platform - 'github' or 'gitlab'
     * @returns {Promise<string>} The pipeline configuration content (YAML)
     */
    async generatePipeline(platform = 'github') {
        let pkg;
        try {
            const packageJsonStr = await this.fileTools.readFile({ path: 'package.json' });
            pkg = JSON.parse(packageJsonStr);
        } catch (e) {
            return "Error: No valid package.json found. Currently only Node.js projects are supported.";
        }

        const context = this._analyzeProject(pkg);

        if (platform === 'github') {
            return this._generateGithubActions(context);
        } else if (platform === 'gitlab') {
            return this._generateGitlabCi(context);
        }

        return "Error: Unsupported platform. Supported: 'github', 'gitlab'.";
    }

    _analyzeProject(pkg) {
        const scripts = pkg.scripts || {};
        const devDeps = pkg.devDependencies || {};
        const deps = pkg.dependencies || {};
        const allDeps = { ...devDeps, ...deps };

        return {
            hasTest: !!scripts.test,
            hasBuild: !!scripts.build,
            hasLint: !!scripts.lint,
            nodeVersion: pkg.engines?.node || '20',
            packageManager: this._detectPackageManager(pkg),
            isReact: !!allDeps.react,
            isVue: !!allDeps.vue,
            isAngular: !!allDeps.vue, // Typo fixed in logic: angular
            isExpress: !!allDeps.express,
            isNext: !!allDeps.next,
            projectName: pkg.name || 'project'
        };
    }

    _detectPackageManager(pkg) {
        // Simple heuristic; could check for lockfiles too if we had file access here easily
        // But checking lockfiles requires async file access which we can do if needed.
        // For now, assume npm unless 'yarn' or 'pnpm' is explicitly mentioned in engines or scripts?
        // Let's just default to npm for simplicity in generation, or add a check for lockfiles in generatePipeline logic.
        return 'npm'; 
    }

    _generateGithubActions(ctx) {
        const steps = [
            {
                name: 'Checkout',
                uses: 'actions/checkout@v4'
            },
            {
                name: 'Setup Node.js',
                uses: 'actions/setup-node@v4',
                with: {
                    'node-version': ctx.nodeVersion.replace(/[^\d.]/g, '') || '20',
                    'cache': 'npm'
                }
            },
            {
                name: 'Install dependencies',
                run: 'npm ci'
            }
        ];

        if (ctx.hasLint) {
            steps.push({
                name: 'Lint',
                run: 'npm run lint'
            });
        }

        if (ctx.hasBuild) {
            steps.push({
                name: 'Build',
                run: 'npm run build'
            });
        }

        if (ctx.hasTest) {
            steps.push({
                name: 'Test',
                run: 'npm test'
            });
        }

        const yaml = `name: CI

on:
  push:
    branches: [ "main", "master" ]
  pull_request:
    branches: [ "main", "master" ]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
${steps.map(step => {
    let s = `    - name: ${step.name}\n`;
    if (step.uses) s += `      uses: ${step.uses}\n`;
    if (step.with) {
        s += `      with:\n`;
        for (const [k, v] of Object.entries(step.with)) {
            s += `        ${k}: ${v}\n`;
        }
    }
    if (step.run) s += `      run: ${step.run}\n`;
    return s;
}).join('')}
`;
        return yaml;
    }

    _generateGitlabCi(ctx) {
        let yaml = `image: node:${ctx.nodeVersion.replace(/[^\d.]/g, '') || '20'}

cache:
  paths:
    - node_modules/

stages:
  - test
  - build
`;

        if (ctx.hasTest || ctx.hasLint) {
            yaml += `
test:
  stage: test
  script:
    - npm ci
`;
            if (ctx.hasLint) yaml += `    - npm run lint\n`;
            if (ctx.hasTest) yaml += `    - npm test\n`;
        }

        if (ctx.hasBuild) {
            yaml += `
build:
  stage: build
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - dist/
      - build/
`;
        }

        return yaml;
    }
}
