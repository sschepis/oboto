import { wsSend, wsHandler } from '../../lib/ws-utils.mjs';

/**
 * Handles: get-skills, search-clawhub, install-clawhub-skill, install-npm-skill, uninstall-skill
 */

const SK = 'toolExecutor.skillsManager';
const SK_LABEL = 'Skills manager';

const handleGetSkills = wsHandler(async (data, ctx, svc) => {
    await svc.ensureInitialized();
    const skills = svc.listSkills();
    const clawHubAvailable = await svc.isClawHubAvailable();
    wsSend(ctx.ws, 'skills-list', { skills, clawHubAvailable });
}, { require: SK, requireLabel: SK_LABEL, errorType: 'skill-error', errorPrefix: 'Failed to get skills' });

const handleSearchClawHub = wsHandler(async (data, ctx, svc) => {
    const query = data.payload?.query || '';
    if (!query.trim()) {
        wsSend(ctx.ws, 'clawhub-search-results', []);
        return;
    }
    const results = await svc.searchClawHub(query);
    wsSend(ctx.ws, 'clawhub-search-results', results);
}, { require: SK, requireLabel: SK_LABEL, errorType: 'skill-error', errorPrefix: 'ClawHub search failed' });

const handleInstallClawHub = wsHandler(async (data, ctx, svc) => {
    const { slug, version } = data.payload || {};
    if (!slug) {
        wsSend(ctx.ws, 'skill-error', { message: 'No skill slug provided' });
        return;
    }

    wsSend(ctx.ws, 'skill-install-progress', { status: 'installing', message: `Installing '${slug}' from ClawHub...` });

    const result = await svc.installFromClawHub(slug, version);

    // Broadcast updated skills list to all clients
    const skills = svc.listSkills();
    const clawHubAvailable = await svc.isClawHubAvailable();
    ctx.broadcast('skills-list', { skills, clawHubAvailable });
    wsSend(ctx.ws, 'skill-installed', { name: slug, source: 'clawhub', message: result });
}, { require: SK, requireLabel: SK_LABEL, errorType: 'skill-error', errorPrefix: 'ClawHub install failed' });

const handleInstallNpm = wsHandler(async (data, ctx, svc) => {
    const { packageName } = data.payload || {};
    if (!packageName) {
        wsSend(ctx.ws, 'skill-error', { message: 'No package name provided' });
        return;
    }

    wsSend(ctx.ws, 'skill-install-progress', { status: 'installing', message: `Installing npm package '${packageName}'...` });

    const result = await svc.installNpmGlobal(packageName);

    const skills = svc.listSkills();
    const clawHubAvailable = await svc.isClawHubAvailable();
    ctx.broadcast('skills-list', { skills, clawHubAvailable });
    wsSend(ctx.ws, 'skill-installed', { name: packageName, source: 'npm', message: result });
}, { require: SK, requireLabel: SK_LABEL, errorType: 'skill-error', errorPrefix: 'NPM skill install failed' });

const handleUninstallSkill = wsHandler(async (data, ctx, svc) => {
    const { name } = data.payload || {};
    if (!name) {
        wsSend(ctx.ws, 'skill-error', { message: 'No skill name provided' });
        return;
    }

    const result = await svc.uninstallSkill(name);

    const skills = svc.listSkills();
    const clawHubAvailable = await svc.isClawHubAvailable();
    ctx.broadcast('skills-list', { skills, clawHubAvailable });
    wsSend(ctx.ws, 'skill-uninstalled', { name, message: result });
}, { require: SK, requireLabel: SK_LABEL, errorType: 'skill-error', errorPrefix: 'Skill uninstall failed' });

export const handlers = {
    'get-skills': handleGetSkills,
    'search-clawhub': handleSearchClawHub,
    'install-clawhub-skill': handleInstallClawHub,
    'install-npm-skill': handleInstallNpm,
    'uninstall-skill': handleUninstallSkill,
};
