import { consoleStyler } from '../../ui/console-styler.mjs';

/**
 * Handles: get-skills, search-clawhub, install-clawhub-skill, install-npm-skill, uninstall-skill
 */

function getSkillsManager(ctx) {
    const sm = ctx.assistant?.toolExecutor?.skillsManager;
    if (!sm) {
        throw new Error('Skills manager not available');
    }
    return sm;
}

async function handleGetSkills(data, ctx) {
    const { ws } = ctx;
    try {
        const sm = getSkillsManager(ctx);
        await sm.ensureInitialized();
        const skills = sm.listSkills();
        const clawHubAvailable = await sm.isClawHubAvailable();
        ws.send(JSON.stringify({
            type: 'skills-list',
            payload: { skills, clawHubAvailable }
        }));
    } catch (error) {
        consoleStyler.log('error', `Failed to get skills: ${error.message}`);
        ws.send(JSON.stringify({ type: 'skill-error', payload: { message: error.message } }));
    }
}

async function handleSearchClawHub(data, ctx) {
    const { ws } = ctx;
    try {
        const sm = getSkillsManager(ctx);
        const query = data.payload?.query || '';
        if (!query.trim()) {
            ws.send(JSON.stringify({ type: 'clawhub-search-results', payload: [] }));
            return;
        }
        const results = await sm.searchClawHub(query);
        ws.send(JSON.stringify({ type: 'clawhub-search-results', payload: results }));
    } catch (error) {
        consoleStyler.log('error', `ClawHub search failed: ${error.message}`);
        ws.send(JSON.stringify({ type: 'skill-error', payload: { message: error.message } }));
    }
}

async function handleInstallClawHub(data, ctx) {
    const { ws, broadcast } = ctx;
    try {
        const sm = getSkillsManager(ctx);
        const { slug, version } = data.payload || {};
        if (!slug) {
            ws.send(JSON.stringify({ type: 'skill-error', payload: { message: 'No skill slug provided' } }));
            return;
        }

        ws.send(JSON.stringify({
            type: 'skill-install-progress',
            payload: { status: 'installing', message: `Installing '${slug}' from ClawHub...` }
        }));

        const result = await sm.installFromClawHub(slug, version);
        consoleStyler.log('system', result);

        // Broadcast updated skills list to all clients
        const skills = sm.listSkills();
        const clawHubAvailable = await sm.isClawHubAvailable();
        broadcast('skills-list', { skills, clawHubAvailable });
        ws.send(JSON.stringify({
            type: 'skill-installed',
            payload: { name: slug, source: 'clawhub', message: result }
        }));
    } catch (error) {
        consoleStyler.log('error', `ClawHub install failed: ${error.message}`);
        ws.send(JSON.stringify({ type: 'skill-error', payload: { message: error.message } }));
    }
}

async function handleInstallNpm(data, ctx) {
    const { ws, broadcast } = ctx;
    try {
        const sm = getSkillsManager(ctx);
        const { packageName } = data.payload || {};
        if (!packageName) {
            ws.send(JSON.stringify({ type: 'skill-error', payload: { message: 'No package name provided' } }));
            return;
        }

        ws.send(JSON.stringify({
            type: 'skill-install-progress',
            payload: { status: 'installing', message: `Installing npm package '${packageName}'...` }
        }));

        const result = await sm.installNpmGlobal(packageName);
        consoleStyler.log('system', result);

        // Broadcast updated skills list to all clients
        const skills = sm.listSkills();
        const clawHubAvailable = await sm.isClawHubAvailable();
        broadcast('skills-list', { skills, clawHubAvailable });
        ws.send(JSON.stringify({
            type: 'skill-installed',
            payload: { name: packageName, source: 'npm', message: result }
        }));
    } catch (error) {
        consoleStyler.log('error', `NPM skill install failed: ${error.message}`);
        ws.send(JSON.stringify({ type: 'skill-error', payload: { message: error.message } }));
    }
}

async function handleUninstallSkill(data, ctx) {
    const { ws, broadcast } = ctx;
    try {
        const sm = getSkillsManager(ctx);
        const { name } = data.payload || {};
        if (!name) {
            ws.send(JSON.stringify({ type: 'skill-error', payload: { message: 'No skill name provided' } }));
            return;
        }

        const result = await sm.uninstallSkill(name);
        consoleStyler.log('system', result);

        // Broadcast updated skills list to all clients
        const skills = sm.listSkills();
        const clawHubAvailable = await sm.isClawHubAvailable();
        broadcast('skills-list', { skills, clawHubAvailable });
        ws.send(JSON.stringify({
            type: 'skill-uninstalled',
            payload: { name, message: result }
        }));
    } catch (error) {
        consoleStyler.log('error', `Skill uninstall failed: ${error.message}`);
        ws.send(JSON.stringify({ type: 'skill-error', payload: { message: error.message } }));
    }
}

export const handlers = {
    'get-skills': handleGetSkills,
    'search-clawhub': handleSearchClawHub,
    'install-clawhub-skill': handleInstallClawHub,
    'install-npm-skill': handleInstallNpm,
    'uninstall-skill': handleUninstallSkill,
};
