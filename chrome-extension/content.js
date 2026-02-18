// content.js - RoboDev Chrome Controller Content Script

console.log("RoboDev content script loaded");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // message format: { type, params }
  const { type, params } = message;

  handleMessage(type, params)
    .then(data => {
      sendResponse({ success: true, data });
    })
    .catch(error => {
      sendResponse({ success: false, error: error.message || String(error) });
    });

  return true; // Keep the message channel open for async response
});

async function handleMessage(type, params) {
  switch (type) {
    case 'dom.click':
      return await handleClick(params);
    case 'dom.type':
      return await handleType(params);
    case 'dom.querySelector':
      return await handleQuerySelector(params);
    case 'dom.querySelectorAll':
      return await handleQuerySelectorAll(params);
    case 'dom.getPageInfo':
      return await handleGetPageInfo(params);
    case 'dom.scrollTo':
      return await handleScrollTo(params);
    case 'dom.fillForm':
      return await handleFillForm(params);
    case 'dom.extractText':
      return await handleExtractText(params);
    case 'dom.extractLinks':
      return await handleExtractLinks(params);
    case 'dom.extractStructure':
      return await handleExtractStructure(params);
    case 'page.waitForSelector':
      return await handleWaitForSelector(params);
    default:
      throw new Error(`Unknown content command: ${type}`);
  }
}

// --- Handlers ---

async function handleClick(params) {
  const el = document.querySelector(params.selector);
  if (!el) throw new Error(`Element not found: ${params.selector}`);
  
  el.click();
  return { 
    clicked: true, 
    tagName: el.tagName, 
    textContent: el.textContent?.trim().substring(0, 50) 
  };
}

async function handleType(params) {
  const el = document.querySelector(params.selector);
  if (!el) throw new Error(`Element not found: ${params.selector}`);
  
  if (params.clearFirst) {
    el.value = '';
  }
  
  el.value = params.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  
  return { typed: true };
}

async function handleQuerySelector(params) {
  const el = document.querySelector(params.selector);
  return el ? serializeElement(el) : null;
}

async function handleQuerySelectorAll(params) {
  const elements = document.querySelectorAll(params.selector);
  const limit = params.limit || 20;
  return [...elements].slice(0, limit).map(serializeElement);
}

async function handleGetPageInfo(params) {
  const info = {
    title: document.title,
    url: window.location.href,
    visibleText: document.body.innerText.substring(0, params.maxTextLength || 5000),
    meta: {
      description: document.querySelector('meta[name="description"]')?.content,
      keywords: document.querySelector('meta[name="keywords"]')?.content,
      ogTitle: document.querySelector('meta[property="og:title"]')?.content,
      ogDescription: document.querySelector('meta[property="og:description"]')?.content,
      ogImage: document.querySelector('meta[property="og:image"]')?.content,
    }
  };

  if (params.includeLinks) {
    info.links = [...document.links].map(l => ({ href: l.href, text: l.innerText }));
  }

  if (params.includeForms) {
    info.forms = [...document.forms].map(f => ({
      action: f.action,
      method: f.method,
      fields: [...f.elements].filter(e => e.name).map(e => ({
        name: e.name,
        type: e.type,
        id: e.id,
        placeholder: e.placeholder,
        value: e.value,
        required: e.required
      }))
    }));
  }
  
  // Basic headings
  info.headings = [...document.querySelectorAll('h1, h2, h3')].map(h => ({
    level: parseInt(h.tagName.substring(1)),
    text: h.innerText
  }));

  return info;
}

async function handleScrollTo(params) {
  if (params.selector) {
    const el = document.querySelector(params.selector);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (params.direction === 'top') {
    window.scrollTo(0, 0);
  } else if (params.direction === 'bottom') {
    window.scrollTo(0, document.body.scrollHeight);
  } else if (params.direction === 'up') {
    window.scrollBy(0, -(params.amount || 500));
  } else if (params.direction === 'down') {
    window.scrollBy(0, params.amount || 500);
  } else if (params.x !== undefined || params.y !== undefined) {
    window.scrollTo(params.x || window.scrollX, params.y || window.scrollY);
  }

  return { 
    scrollY: window.scrollY, 
    scrollHeight: document.body.scrollHeight, 
    clientHeight: window.innerHeight 
  };
}

async function handleFillForm(params) {
  let filledCount = 0;
  for (const field of params.fields) {
    const el = document.querySelector(field.selector);
    if (el) {
      el.value = field.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      filledCount++;
    }
  }

  let submitted = false;
  if (params.submit) {
    // Try to find a form related to the first field
    const firstField = document.querySelector(params.fields[0]?.selector);
    if (firstField && firstField.form) {
      firstField.form.requestSubmit(); // Better than submit() as it validates and fires events
      submitted = true;
    }
  }

  return { filled: filledCount, submitted };
}

async function handleExtractText(params) {
  return document.body.innerText.substring(0, params.maxLength || 50000);
}

async function handleExtractLinks(params) {
  return [...document.querySelectorAll('a[href]')].map(a => ({
    href: a.href,
    text: a.innerText.trim(),
    isExternal: a.hostname !== window.location.hostname
  }));
}

async function handleExtractStructure(params) {
  function buildTree(node, depth) {
    if (depth > (params.maxDepth || 5)) return null;
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    if (['SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT'].includes(node.tagName)) return null;

    const children = [...node.children]
      .map(child => buildTree(child, depth + 1))
      .filter(Boolean);

    return {
      tag: node.tagName.toLowerCase(),
      id: node.id || undefined,
      className: node.className || undefined,
      textPreview: node.childNodes.length === 1 && node.childNodes[0].nodeType === Node.TEXT_NODE 
        ? node.textContent.trim().substring(0, 50) 
        : undefined,
      children: children.length > 0 ? children : undefined
    };
  }

  return buildTree(document.body, 0);
}

async function handleWaitForSelector(params) {
  return new Promise((resolve, reject) => {
    const timeout = params.timeout || 5000;
    const intervalTime = 200;
    let elapsed = 0;

    const check = () => {
      const el = document.querySelector(params.selector);
      if (el) {
        resolve(serializeElement(el));
      } else if (elapsed >= timeout) {
        reject(new Error(`Timeout waiting for selector: ${params.selector}`));
      } else {
        elapsed += intervalTime;
        setTimeout(check, intervalTime);
      }
    };

    check();
  });
}

// --- Helpers ---

function serializeElement(el) {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    tagName: el.tagName.toLowerCase(),
    id: el.id || '',
    className: typeof el.className === 'string' ? el.className : '', // Handle SVGAnimatedString
    textContent: el.textContent?.trim().substring(0, 200) || '',
    attributes: el.attributes ? Object.fromEntries([...el.attributes].map(a => [a.name, a.value])) : {},
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right
    },
    isVisible: (el.offsetParent !== null || el.tagName === 'BODY') && rect.width > 0 && rect.height > 0,
    childCount: el.children.length,
    selector: generateSelector(el)
  };
}

function generateSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.dataset.testid) return `[data-testid="${CSS.escape(el.dataset.testid)}"]`;
  
  let path = [];
  while (el && el.nodeType === Node.ELEMENT_NODE) {
    let selector = el.tagName.toLowerCase();
    if (el.id) {
      selector += `#${CSS.escape(el.id)}`;
      path.unshift(selector);
      break;
    } else {
      let sibling = el;
      let nth = 1;
      while (sibling = sibling.previousElementSibling) {
        if (sibling.tagName.toLowerCase() === selector) nth++;
      }
      if (nth !== 1) selector += `:nth-of-type(${nth})`;
    }
    path.unshift(selector);
    el = el.parentElement;
  }
  return path.join(" > ");
}
