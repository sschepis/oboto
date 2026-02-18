// background.js - RoboDev Chrome Controller Service Worker

let socket = null;
let isConnected = false;
let retryCount = 0;
let reconnectTimer = null;
let shouldBeConnected = false; // User toggle state
const MAX_RETRIES = 10;
const BASE_RETRY_DELAY = 1000;

// Attached debugger sessions: Set<tabId>
const attachedDebuggers = new Set();

// --- WebSocket Management ---

async function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const port = (await chrome.storage.local.get('port')).port || 3000;
  const wsUrl = `ws://localhost:${port}/ws/chrome`;

  console.log(`Connecting to RoboDev at ${wsUrl}...`);
  updateBadge("...");

  try {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log("Connected to RoboDev");
      isConnected = true;
      retryCount = 0;
      updateBadge("ON");
      
      sendEvent("connected", { version: "1.0.0" });
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        handleCommand(message);
      } catch (e) {
        console.error("Failed to parse message:", e);
      }
    };

    socket.onclose = () => {
      console.log("Disconnected from RoboDev");
      isConnected = false;
      updateBadge("OFF");
      cleanupDebuggers(); // Detach all debuggers on disconnect
      
      if (shouldBeConnected) {
        scheduleReconnect();
      }
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
      // onclose will be called
    };

  } catch (e) {
    console.error("Connection failed:", e);
    if (shouldBeConnected) {
      scheduleReconnect();
    }
  }
}

function disconnect() {
  shouldBeConnected = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
  updateBadge("OFF");
}

function scheduleReconnect() {
  if (retryCount >= MAX_RETRIES) {
    console.log("Max retries reached. Stopping reconnection attempts.");
    shouldBeConnected = false; // Stop trying
    updateBadge("ERR");
    return;
  }

  const delay = Math.min(30000, BASE_RETRY_DELAY * Math.pow(2, retryCount));
  console.log(`Reconnecting in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
  
  updateBadge("...");
  reconnectTimer = setTimeout(() => {
    retryCount++;
    connect();
  }, delay);
}

function updateBadge(text) {
  chrome.action.setBadgeText({ text });
  
  let color;
  switch (text) {
    case "ON": color = "#4CAF50"; break; // Green
    case "OFF": color = "#F44336"; break; // Red
    case "...": color = "#FFC107"; break; // Amber
    case "ERR": color = "#000000"; break; // Black
    default: color = "#999999";
  }
  chrome.action.setBadgeBackgroundColor({ color });
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  } else {
    console.warn("Cannot send message, socket not open:", message);
  }
}

function sendResponse(id, success, dataOrError) {
  const response = { id, success };
  if (success) {
    response.data = dataOrError;
  } else {
    response.error = dataOrError;
  }
  send(response);
}

function sendEvent(event, data) {
  send({ event, data });
}

// --- Toggle Logic ---

chrome.action.onClicked.addListener((tab) => {
  shouldBeConnected = !shouldBeConnected;
  if (shouldBeConnected) {
    retryCount = 0;
    connect();
  } else {
    disconnect();
  }
});

// Initialize badge
updateBadge("OFF");

// --- Command Routing ---

async function handleCommand(message) {
  const { id, action, params = {} } = message;
  
  if (!id && !action) return; // Ignore invalid messages

  console.log(`Received command: ${action}`, params);

  try {
    let result;
    
    // Route command
    if (action.startsWith('tabs.')) {
      result = await handleTabsCommand(action, params);
    } else if (action.startsWith('windows.')) {
      result = await handleWindowsCommand(action, params);
    } else if (action === 'navigate') {
      result = await handleNavigate(params);
    } else if (action.startsWith('dom.') || action.startsWith('page.')) {
      result = await handleDomCommand(action, params);
    } else if (action.startsWith('script.') || action.startsWith('css.')) {
      result = await handleScriptCommand(action, params);
    } else if (action.startsWith('cookies.')) {
      result = await handleCookiesCommand(action, params);
    } else if (action.startsWith('downloads.')) {
      result = await handleDownloadsCommand(action, params);
    } else if (action.startsWith('history.')) {
      result = await handleHistoryCommand(action, params);
    } else if (action.startsWith('bookmarks.')) {
      result = await handleBookmarksCommand(action, params);
    } else if (action.startsWith('debugger.')) {
      result = await handleDebuggerCommand(action, params);
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    if (id) {
      sendResponse(id, true, result);
    }
  } catch (error) {
    console.error(`Error executing ${action}:`, error);
    if (id) {
      sendResponse(id, false, error.message || String(error));
    }
  }
}

// --- Command Handlers ---

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ? tab.id : null;
}

async function handleTabsCommand(action, params) {
  switch (action) {
    case 'tabs.query':
      return await chrome.tabs.query(params);
    case 'tabs.create':
      return await chrome.tabs.create(params);
    case 'tabs.close':
      if (params.tabIds) {
        return await chrome.tabs.remove(params.tabIds);
      } else if (params.tabId) {
        return await chrome.tabs.remove(params.tabId);
      }
      throw new Error("tabs.close requires tabIds or tabId");
    case 'tabs.update':
      return await chrome.tabs.update(params.tabId, params);
    case 'tabs.move':
      return await chrome.tabs.move(params.tabIds, { index: params.index, windowId: params.windowId });
    case 'tabs.group':
      return await chrome.tabs.group({ tabIds: params.tabIds, groupId: params.groupId });
    case 'tabs.ungroup':
      return await chrome.tabs.ungroup(params.tabIds);
    case 'tabs.duplicate':
      return await chrome.tabs.duplicate(params.tabId);
    case 'tabs.reload':
      return await chrome.tabs.reload(params.tabId, { bypassCache: params.bypassCache });
    case 'tabs.goBack':
      return await chrome.tabs.goBack(params.tabId);
    case 'tabs.goForward':
      return await chrome.tabs.goForward(params.tabId);
    case 'tabs.screenshot':
      return await chrome.tabs.captureVisibleTab(params.windowId, { 
        format: params.format || 'jpeg', 
        quality: params.quality || 80 
      });
    default:
      throw new Error(`Unknown tabs command: ${action}`);
  }
}

async function handleWindowsCommand(action, params) {
  switch (action) {
    case 'windows.getAll':
      return await chrome.windows.getAll({ populate: true });
    case 'windows.create':
      return await chrome.windows.create(params);
    case 'windows.close':
      return await chrome.windows.remove(params.windowId);
    case 'windows.update':
      return await chrome.windows.update(params.windowId, params);
    default:
      throw new Error(`Unknown windows command: ${action}`);
  }
}

async function handleNavigate(params) {
  const tabId = params.tabId || await getActiveTabId();
  if (!tabId) throw new Error("No active tab found");

  const updatePromise = chrome.tabs.update(tabId, { url: params.url });
  
  if (params.waitForLoad) {
    await new Promise((resolve, reject) => {
      // Set a timeout for navigation
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Navigation timed out"));
      }, 30000);

      const listener = (details) => {
        if (details.tabId === tabId && details.frameId === 0) {
          cleanup();
          resolve();
        }
      };

      const cleanup = () => {
        chrome.webNavigation.onCompleted.removeListener(listener);
        clearTimeout(timeout);
      };

      chrome.webNavigation.onCompleted.addListener(listener);
    });
  }
  
  return await updatePromise;
}

async function handleDomCommand(action, params) {
  // Delegate DOM interactions to content script
  const tabId = params.tabId || await getActiveTabId();
  if (!tabId) throw new Error("No target tab specified or active");
  
  // Clean up params for message
  const messageParams = { ...params };
  delete messageParams.tabId;
  
  // For dom.evaluate, we use debugger protocol if needed, but per specs:
  // "dom.evaluate → attach debugger if needed, chrome.debugger.sendCommand..."
  if (action === 'dom.evaluate') {
    return await executeRuntimeEvaluate(tabId, params.expression, params.awaitPromise);
  }

  // All other dom.* and page.* commands go to content script
  // action matches the type expected by content script
  try {
    const response = await chrome.tabs.sendMessage(tabId, { 
      type: action, 
      params: messageParams 
    });
    return response;
  } catch (err) {
    throw new Error(`Content script error: ${err.message}. (Ensure page is loaded and not a chrome:// URL)`);
  }
}

async function handleScriptCommand(action, params) {
  const tabId = params.tabId || await getActiveTabId();
  if (!tabId) throw new Error("No target tab specified");

  if (action === 'script.execute') {
    return await chrome.scripting.executeScript({
      target: { tabId },
      func: params.func, // Note: params.func won't work over JSON. Must be string code or files
      // If params has 'code', use 'func' wrapper or 'files'
      // Since JSON can't pass functions, we assume 'files' or 'args' + predefined func, 
      // or raw 'func' string injection is not what chrome.scripting.executeScript expects directly from JSON.
      // However, typical usage from a server might be passing files.
      // Let's assume params structure matches chrome.scripting.executeScript requirements roughly.
      // But standard executeScript takes a function object or files. 
      // If we receive code string, we can't easily use 'func'. 
      // We might need to handle raw code injection? 
      // Manifest V3 removed executeScript({code}). We need to use func or files.
      // Assuming the server knows to send 'files'.
      // If the server sends 'expression' (string), we might need to wrap it?
      // For now, pass params as is, assuming server complies with chrome.scripting API
      ...params
    });
  } else if (action === 'css.inject') {
    return await chrome.scripting.insertCSS({
      target: { tabId },
      css: params.css
    });
  }
  throw new Error(`Unknown script command: ${action}`);
}

async function handleCookiesCommand(action, params) {
  switch (action) {
    case 'cookies.get':
      return await chrome.cookies.getAll({ 
        url: params.url, 
        name: params.name, 
        domain: params.domain 
      });
    case 'cookies.set':
      return await chrome.cookies.set(params);
    case 'cookies.remove':
      return await chrome.cookies.remove({ url: params.url, name: params.name });
    default:
      throw new Error(`Unknown cookies command: ${action}`);
  }
}

async function handleDownloadsCommand(action, params) {
  if (action === 'downloads.start') {
    return await chrome.downloads.download(params);
  }
  throw new Error(`Unknown downloads command: ${action}`);
}

async function handleHistoryCommand(action, params) {
  if (action === 'history.search') {
    return await chrome.history.search(params);
  }
  throw new Error(`Unknown history command: ${action}`);
}

async function handleBookmarksCommand(action, params) {
  if (action === 'bookmarks.search') {
    return await chrome.bookmarks.search(params);
  }
  throw new Error(`Unknown bookmarks command: ${action}`);
}

async function handleDebuggerCommand(action, params) {
  const tabId = params.tabId || await getActiveTabId();
  
  if (action === 'debugger.attach') {
    const target = { tabId };
    if (!attachedDebuggers.has(tabId)) {
      await chrome.debugger.attach(target, '1.3');
      attachedDebuggers.add(tabId);
    }
    return true;
  } else if (action === 'debugger.sendCommand') {
    const target = { tabId };
    // Auto-attach if not attached
    if (!attachedDebuggers.has(tabId)) {
      await chrome.debugger.attach(target, '1.3');
      attachedDebuggers.add(tabId);
    }
    return await chrome.debugger.sendCommand(target, params.method, params.params);
  } else if (action === 'debugger.detach') {
    const target = { tabId };
    if (attachedDebuggers.has(tabId)) {
      await chrome.debugger.detach(target);
      attachedDebuggers.delete(tabId);
    }
    return true;
  }
  throw new Error(`Unknown debugger command: ${action}`);
}

async function executeRuntimeEvaluate(tabId, expression, awaitPromise) {
  const target = { tabId };
  if (!attachedDebuggers.has(tabId)) {
    await chrome.debugger.attach(target, '1.3');
    attachedDebuggers.add(tabId);
  }
  const result = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { 
    expression, 
    awaitPromise,
    returnByValue: true 
  });
  return result;
}

function cleanupDebuggers() {
  for (const tabId of attachedDebuggers) {
    chrome.debugger.detach({ tabId }).catch(() => {});
  }
  attachedDebuggers.clear();
}

// --- Event Listeners ---

// Debugger detach listener
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId) {
    attachedDebuggers.delete(source.tabId);
  }
});

// Tab events
chrome.tabs.onActivated.addListener((activeInfo) => {
  if (isConnected) {
    sendEvent('tab.activated', activeInfo);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only send if URL or title changed
  if (isConnected && (changeInfo.url || changeInfo.title || changeInfo.status)) {
    sendEvent('tab.updated', { 
      tabId, 
      url: tab.url, 
      title: tab.title, 
      status: tab.status, 
      changeInfo 
    });
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (isConnected) {
    sendEvent('tab.created', tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (isConnected) {
    sendEvent('tab.removed', { tabId, ...removeInfo });
  }
  // Cleanup debugger if attached
  if (attachedDebuggers.has(tabId)) {
    attachedDebuggers.delete(tabId);
  }
});

// Window events
chrome.windows.onCreated.addListener((window) => {
  if (isConnected) {
    sendEvent('window.created', window);
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (isConnected) {
    sendEvent('window.removed', { windowId });
  }
});

// Navigation events
chrome.webNavigation.onCompleted.addListener((details) => {
  if (isConnected) {
    sendEvent('navigation.completed', { 
      tabId: details.tabId, 
      url: details.url, 
      frameId: details.frameId 
    });
  }
});
