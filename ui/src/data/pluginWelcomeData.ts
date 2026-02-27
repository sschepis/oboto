/**
 * Welcome page data for each plugin.
 *
 * Each entry describes the plugin's purpose, key features, available tools,
 * usage examples, and optional configuration requirements.
 */

export interface PluginFeature {
  icon: string;   // Lucide icon name or emoji
  title: string;
  description: string;
}

export interface PluginTool {
  name: string;
  description: string;
  example?: string;
}

export interface PluginWelcomeInfo {
  displayName: string;
  tagline: string;
  description: string;
  category: 'automation' | 'ai' | 'media' | 'development' | 'productivity' | 'data' | 'integration' | 'utility' | 'debugging';
  features: PluginFeature[];
  tools: PluginTool[];
  usageExamples?: string[];
  requiresConfig?: { key: string; label: string }[];
  iconEmoji: string;
}

export const pluginWelcomeData: Record<string, PluginWelcomeInfo> = {
  browser: {
    displayName: 'Browser Automation',
    tagline: 'Headless browser control with Puppeteer',
    description:
      'Automate web browsing tasks using a headless Chromium browser. Navigate pages, take screenshots, click elements, fill forms, and extract data — all controlled by the AI agent.',
    category: 'automation',
    iconEmoji: '🌐',
    features: [
      { icon: '🔗', title: 'Page Navigation', description: 'Open URLs, follow links, and navigate between pages with configurable wait strategies.' },
      { icon: '📸', title: 'Screenshots', description: 'Capture full-page or viewport screenshots to visually inspect page state.' },
      { icon: '🖱️', title: 'DOM Interaction', description: 'Click buttons, fill inputs, select dropdowns, scroll, and interact with page elements.' },
      { icon: '⚙️', title: 'Configurable Viewport', description: 'Set custom viewport dimensions, timeouts, and headless mode preferences.' },
    ],
    tools: [
      { name: 'browse_open', description: 'Open a URL in the headless browser with configurable viewport and wait strategy.', example: '"Open https://example.com and wait for the page to load"' },
      { name: 'browse_act', description: 'Perform an action on the page — click, type, select, scroll, or wait.', example: '"Click the login button"' },
      { name: 'browse_screenshot', description: 'Take a screenshot of the current page state.', example: '"Take a screenshot of the current page"' },
      { name: 'browse_close', description: 'Close the browser session and release resources.' },
    ],
    usageExamples: [
      'Open https://news.ycombinator.com and screenshot the front page',
      'Navigate to a form, fill in the fields, and submit it',
      'Scrape product prices from an e-commerce page',
    ],
  },

  'canvas-viz': {
    displayName: 'Canvas Visualization',
    tagline: 'Interactive visual diagrams from descriptions',
    description:
      'Generate interactive HTML5 canvas visualizations from natural language descriptions. Create flowcharts, network graphs, mind maps, and custom diagrams that can be viewed directly in the chat.',
    category: 'media',
    iconEmoji: '🎨',
    features: [
      { icon: '✨', title: 'Natural Language Input', description: 'Describe what you want to visualize and the plugin generates interactive canvas code.' },
      { icon: '🔄', title: 'Auto-Capture', description: 'Automatically captures DSN observations as graph nodes for knowledge visualization.' },
      { icon: '📊', title: 'Interactive Canvas', description: 'Generated visualizations are interactive HTML5 canvas elements with zoom and pan.' },
    ],
    tools: [
      { name: 'generate_canvas_viz', description: 'Generate an interactive canvas visualization based on a text description.', example: '"Create a flowchart showing the user registration process"' },
    ],
    usageExamples: [
      'Create a mind map of project architecture',
      'Visualize the relationship between system components',
      'Generate a flowchart for the deployment pipeline',
    ],
  },

  'chrome-ext': {
    displayName: 'Chrome Extension Bridge',
    tagline: 'Control real Chrome tabs and windows via WebSocket',
    description:
      'Bridge to a real Chrome browser instance via the companion Chrome extension. Control tabs, windows, and DOM elements in your actual browser — not a headless one. Perfect for browser-based workflows that need to interact with authenticated sessions.',
    category: 'automation',
    iconEmoji: '🔌',
    features: [
      { icon: '📑', title: 'Tab Management', description: 'List, create, close, and navigate browser tabs programmatically.' },
      { icon: '🪟', title: 'Window Control', description: 'Create, list, and close browser windows.' },
      { icon: '🖱️', title: 'DOM Interaction', description: 'Click elements, type text, and interact with page content in your real browser.' },
      { icon: '📋', title: 'Page Content', description: 'Read page text, extract DOM elements, and get page metadata.' },
      { icon: '🔐', title: 'Authenticated Sessions', description: 'Works with your existing login sessions and cookies.' },
    ],
    tools: [
      { name: 'chrome_list_tabs', description: 'List all open browser tabs with URLs and titles.' },
      { name: 'chrome_create_tab', description: 'Open a new browser tab with a URL.' },
      { name: 'chrome_close_tab', description: 'Close one or more browser tabs.' },
      { name: 'chrome_navigate', description: 'Navigate a tab to a new URL.' },
      { name: 'chrome_list_windows', description: 'List all open browser windows.' },
      { name: 'chrome_create_window', description: 'Open a new browser window.' },
      { name: 'chrome_click', description: 'Click an element on the page using a CSS selector.' },
    ],
    usageExamples: [
      'List all my open tabs and close duplicates',
      'Open Gmail in a new tab and check for unread emails',
      'Click the submit button on the current page',
    ],
  },

  'code-interpreter': {
    displayName: 'Code Interpreter',
    tagline: 'Sandboxed Python & JavaScript execution',
    description:
      'Execute Python and JavaScript code in a secure sandboxed environment. Supports Docker-based isolation for maximum security, with a fallback host mode. Create sessions, run code, install packages, and upload files.',
    category: 'development',
    iconEmoji: '💻',
    features: [
      { icon: '🐍', title: 'Python Execution', description: 'Run Python code with full standard library access and optional package installation.' },
      { icon: '📦', title: 'Node.js Execution', description: 'Execute JavaScript/Node.js code with npm package support.' },
      { icon: '🐳', title: 'Docker Isolation', description: 'Code runs in isolated Docker containers with configurable memory and CPU limits.' },
      { icon: '📁', title: 'File Upload', description: 'Upload files into the session workspace for processing.' },
      { icon: '📦', title: 'Package Management', description: 'Install pip/npm packages within sessions for extended functionality.' },
    ],
    tools: [
      { name: 'code_create_session', description: 'Create a new code execution session (Python or Node.js).', example: '"Create a Python session for data analysis"' },
      { name: 'code_execute', description: 'Run code in an existing session and get stdout/stderr output.', example: '"Run: import pandas as pd; print(pd.__version__)"' },
      { name: 'code_install_package', description: 'Install a package in the session (fallback mode only).', example: '"Install numpy in my session"' },
      { name: 'code_upload_file', description: 'Upload a file into the session workspace.' },
      { name: 'code_end_session', description: 'End a session and clean up resources.' },
    ],
    usageExamples: [
      'Create a Python session and run a data analysis script',
      'Execute JavaScript to parse and transform JSON data',
      'Install matplotlib and generate a chart',
    ],
  },

  'document-reader': {
    displayName: 'Document Reader',
    tagline: 'Ingest and analyze PDFs, DOCX, XLSX, images, and text',
    description:
      'Read and analyze documents in various formats including PDF, DOCX, XLSX, images, and plain text. Extract text content, generate summaries, and make document contents available for AI analysis.',
    category: 'data',
    iconEmoji: '📄',
    features: [
      { icon: '📑', title: 'Multi-Format Support', description: 'Handles PDF, DOCX, XLSX, common image formats, and text files.' },
      { icon: '📝', title: 'Text Extraction', description: 'Extracts readable text content from binary document formats.' },
      { icon: '📋', title: 'Document Listing', description: 'Track and list all ingested documents for easy reference.' },
      { icon: '🔍', title: 'Auto-Summary', description: 'Generates AI-powered summaries of document content.' },
    ],
    tools: [
      { name: 'ingest_document', description: 'Ingest a document from a file path and extract its text content.', example: '"Read the report at ./docs/quarterly-report.pdf"' },
      { name: 'list_documents', description: 'List all previously ingested documents.' },
    ],
    usageExamples: [
      'Read and summarize a PDF report',
      'Extract data from an Excel spreadsheet',
      'Analyze the contents of a Word document',
    ],
  },

  embed: {
    displayName: 'Rich Media Embed',
    tagline: 'YouTube, Spotify, maps, and more inline in chat',
    description:
      'Embed rich media content directly in chat messages. Support for YouTube videos, Spotify tracks, maps, and other embeddable content. Makes conversations more interactive and visual.',
    category: 'media',
    iconEmoji: '🎬',
    features: [
      { icon: '▶️', title: 'YouTube Embeds', description: 'Embed YouTube videos directly in chat for inline viewing.' },
      { icon: '🎵', title: 'Spotify Embeds', description: 'Share Spotify tracks and playlists with playable embeds.' },
      { icon: '🗺️', title: 'Map Embeds', description: 'Embed interactive maps for location-based content.' },
      { icon: '🔗', title: 'Generic OEmbed', description: 'Support for any OEmbed-compatible service.' },
    ],
    tools: [
      { name: 'embed_media', description: 'Embed rich media content inline in the chat.', example: '"Embed this YouTube video: https://youtube.com/watch?v=..."' },
    ],
    usageExamples: [
      'Embed a YouTube tutorial in the conversation',
      'Share a Spotify playlist link with an inline player',
      'Show a map location for a meeting point',
    ],
  },

  firecrawl: {
    displayName: 'Firecrawl',
    tagline: 'Web scraping and intelligent crawling',
    description:
      'Powerful web scraping and crawling powered by the Firecrawl API. Extract structured content from web pages, crawl entire websites, and convert pages to clean markdown for AI consumption.',
    category: 'data',
    iconEmoji: '🔥',
    features: [
      { icon: '🕷️', title: 'Web Scraping', description: 'Extract clean, structured content from any web page.' },
      { icon: '🔄', title: 'Site Crawling', description: 'Crawl entire websites and extract content from multiple pages.' },
      { icon: '📝', title: 'Markdown Conversion', description: 'Convert web pages to clean markdown format for AI processing.' },
      { icon: '🎯', title: 'Targeted Extraction', description: 'Extract specific content using CSS selectors and patterns.' },
    ],
    tools: [
      { name: 'firecrawl_scrape', description: 'Scrape content from a single URL.', example: '"Scrape the documentation at https://docs.example.com"' },
      { name: 'firecrawl_crawl', description: 'Crawl a website starting from a URL.' },
    ],
    usageExamples: [
      'Scrape a documentation page and summarize it',
      'Crawl a blog and extract all article titles',
      'Get the clean text content of a news article',
    ],
    requiresConfig: [
      { key: 'apiKey', label: 'Firecrawl API Key' },
    ],
  },

  'hello-world': {
    displayName: 'Hello World',
    tagline: 'Example plugin for the Oboto plugin system',
    description:
      'A demonstration plugin showing how to build Oboto plugins. Includes examples of tool registration, WebSocket events, UI tabs, and the complete plugin lifecycle. Use this as a template for creating your own plugins.',
    category: 'development',
    iconEmoji: '👋',
    features: [
      { icon: '🔧', title: 'Tool Example', description: 'Demonstrates how to register custom tools with the plugin API.' },
      { icon: '📡', title: 'WebSocket Events', description: 'Shows how to listen for and emit WebSocket events.' },
      { icon: '🖥️', title: 'UI Tab', description: 'Includes a sample UI tab component (HelloTab.jsx).' },
      { icon: '📖', title: 'Plugin Lifecycle', description: 'Covers activate, deactivate, and configuration hooks.' },
    ],
    tools: [
      { name: 'hello_world', description: 'A simple greeting tool that demonstrates the plugin tool API.' },
    ],
    usageExamples: [
      'Use as a reference when building custom plugins',
      'Test the plugin system with a minimal working example',
    ],
  },

  'html-artifacts': {
    displayName: 'HTML Artifacts',
    tagline: 'Generate, preview, and edit HTML/React artifacts',
    description:
      'Create, save, and preview HTML and React code artifacts. Generate interactive UI components, mini-applications, and visual previews that can be rendered directly in the workspace.',
    category: 'development',
    iconEmoji: '🧩',
    features: [
      { icon: '💾', title: 'Save Artifacts', description: 'Store HTML or React code as named artifacts for later retrieval.' },
      { icon: '👁️', title: 'Live Preview', description: 'Preview artifacts with instant rendering in the UI.' },
      { icon: '⚛️', title: 'React Support', description: 'Supports both plain HTML and React JSX artifacts.' },
      { icon: '📡', title: 'WS Broadcast', description: 'Broadcasts events when artifacts are saved for real-time updates.' },
    ],
    tools: [
      { name: 'save_artifact', description: 'Save an HTML or React artifact for preview.', example: '"Save a React component that shows a counter"' },
      { name: 'load_artifact', description: 'Load a previously saved artifact by ID.' },
    ],
    usageExamples: [
      'Create an interactive chart component',
      'Build a mini calculator as an HTML artifact',
      'Generate a React dashboard widget',
    ],
  },

  image: {
    displayName: 'Image Generation & Manipulation',
    tagline: 'AI image generation (DALL-E) and processing (Sharp)',
    description:
      'Generate images using DALL-E AI models, create image variations, and manipulate existing images with a powerful image processing pipeline. Supports resize, crop, rotate, blur, text overlay, watermarks, and more.',
    category: 'media',
    iconEmoji: '🖼️',
    features: [
      { icon: '🎨', title: 'AI Image Generation', description: 'Generate images from text descriptions using DALL-E 3.' },
      { icon: '🔄', title: 'Image Variations', description: 'Create variations of existing images using DALL-E 2.' },
      { icon: '✂️', title: 'Image Manipulation', description: 'Resize, crop, rotate, blur, sharpen, and apply effects to images.' },
      { icon: '📝', title: 'Text Overlay', description: 'Add text, watermarks, and composite overlays to images.' },
      { icon: '📊', title: 'Metadata Inspection', description: 'Read image dimensions, format, color space, and EXIF data.' },
    ],
    tools: [
      { name: 'generate_image', description: 'Generate an image from a text prompt using DALL-E 3.', example: '"Generate an image of a sunset over mountains"' },
      { name: 'create_image_variation', description: 'Create variations of an existing image.' },
      { name: 'manipulate_image', description: 'Apply transformations: resize, crop, rotate, blur, text overlay, etc.' },
    ],
    usageExamples: [
      'Generate a logo concept for a tech startup',
      'Resize all images in a folder to 800px width',
      'Add a watermark to a batch of photos',
    ],
    requiresConfig: [
      { key: 'openaiApiKey', label: 'OpenAI API Key' },
    ],
  },

  'knowledge-graph': {
    displayName: 'Knowledge Graph',
    tagline: 'Semantic knowledge storage and exploration',
    description:
      'Build and query a knowledge graph of entities and relationships. Store structured knowledge as subject-predicate-object triples, explore entity connections, and perform semantic reasoning over accumulated knowledge.',
    category: 'data',
    iconEmoji: '🧠',
    features: [
      { icon: '🔗', title: 'Triple Store', description: 'Store knowledge as subject-predicate-object triples with confidence scores.' },
      { icon: '🔍', title: 'Graph Queries', description: 'Query the graph by subject, predicate, object patterns.' },
      { icon: '🌐', title: 'Entity Exploration', description: 'Traverse the graph to discover related entities across multiple hops.' },
      { icon: '💭', title: 'Semantic Thinking', description: 'Use semantic_think for AI-assisted reasoning over the knowledge graph.' },
      { icon: '💾', title: 'Memory Field', description: 'Holographic memory projection for persistent knowledge storage.' },
    ],
    tools: [
      { name: 'query_knowledge', description: 'Query the knowledge graph using subject/predicate/object patterns.' },
      { name: 'add_knowledge', description: 'Add new knowledge triples to the graph.' },
      { name: 'get_related_entities', description: 'Explore entities related to a given entity with configurable depth.' },
      { name: 'search_knowledge', description: 'Full-text search across entity names and properties.' },
      { name: 'semantic_think', description: 'AI-assisted reasoning and inference over the knowledge graph.' },
    ],
    usageExamples: [
      'Add knowledge: "React is_a JavaScript_library"',
      'Find all entities related to "machine learning"',
      'Query: what concepts are connected to "neural networks"?',
    ],
  },

  logger: {
    displayName: 'System Logger',
    tagline: 'View and analyze system log files',
    description:
      'Access and inspect system log files from the central log directory. Read log contents, filter by lines, and monitor application behavior through its log output.',
    category: 'debugging',
    iconEmoji: '📋',
    features: [
      { icon: '📂', title: 'Log Directory Access', description: 'Browse and list all available log files.' },
      { icon: '📖', title: 'Log Reading', description: 'Read trailing lines from log files with configurable line counts.' },
      { icon: '🔍', title: 'Log Filtering', description: 'Filter logs by minimum severity level.' },
    ],
    tools: [
      { name: 'read_system_logs', description: 'Read system log files, or list available log files if no filename given.', example: '"Show me the last 50 lines of ai.log"' },
    ],
    usageExamples: [
      'List all available log files',
      'Read the last 100 lines of the main log',
      'Check for errors in recent log entries',
    ],
  },

  math: {
    displayName: 'Math Engine',
    tagline: 'Mathematical evaluation, units, and equation solving',
    description:
      'A powerful mathematical computation engine supporting arithmetic, algebra, calculus, matrix operations, unit conversions, and equation solving. Powered by math.js for precise symbolic and numerical computation.',
    category: 'utility',
    iconEmoji: '🔢',
    features: [
      { icon: '➕', title: 'Expression Evaluation', description: 'Evaluate complex mathematical expressions including trig, logarithms, and calculus.' },
      { icon: '📐', title: 'Unit Conversion', description: 'Convert between units of measurement (length, weight, temperature, etc.).' },
      { icon: '🔣', title: 'Equation Solving', description: 'Solve algebraic equations for specified variables.' },
      { icon: '📊', title: 'Matrix Operations', description: 'Perform determinant, inverse, eigenvalue, and other matrix computations.' },
    ],
    tools: [
      { name: 'evaluate_math', description: 'Evaluate a mathematical expression.', example: '"Calculate sqrt(16) + log(100)"' },
      { name: 'unit_conversion', description: 'Convert between units of measurement.', example: '"Convert 72 degrees Fahrenheit to Celsius"' },
      { name: 'solve_equation', description: 'Solve an equation for a variable.', example: '"Solve 2x + 5 = 15 for x"' },
    ],
    usageExamples: [
      'Calculate the determinant of a 3x3 matrix',
      'Convert 5 miles to kilometers',
      'Solve the quadratic equation x² - 4x + 3 = 0',
    ],
  },

  'note-taker': {
    displayName: 'Note Taker',
    tagline: 'Create, retrieve, and manage notes',
    description:
      'A simple but effective note-taking system. Save notes with titles and content, list all notes, retrieve specific notes by ID, and delete notes when no longer needed. Notes persist across sessions.',
    category: 'productivity',
    iconEmoji: '📝',
    features: [
      { icon: '💾', title: 'Save Notes', description: 'Create new notes or update existing ones with title and content.' },
      { icon: '📋', title: 'List Notes', description: 'Browse all saved notes at a glance.' },
      { icon: '🔍', title: 'Retrieve Notes', description: 'Get the full content of any note by its ID.' },
      { icon: '🗑️', title: 'Delete Notes', description: 'Remove notes that are no longer needed.' },
    ],
    tools: [
      { name: 'save_note', description: 'Save a new note or update an existing one.', example: '"Save a note titled \'Meeting Notes\' with today\'s discussion points"' },
      { name: 'list_notes', description: 'List all available notes.' },
      { name: 'get_note', description: 'Retrieve the content of a specific note.' },
      { name: 'delete_note', description: 'Delete a note by its ID.' },
    ],
    usageExamples: [
      'Save meeting notes from today\'s standup',
      'List all my saved notes',
      'Find and display the note about project requirements',
    ],
  },

  'notification-center': {
    displayName: 'Notification Center',
    tagline: 'Alerts and notifications for the user',
    description:
      'Send alerts and notifications to the user through multiple channels. Supports different notification types (info, success, warning, error) and priority levels. Features sound effects, do-not-disturb mode, and optional desktop OS notifications.',
    category: 'utility',
    iconEmoji: '🔔',
    features: [
      { icon: '📢', title: 'Multi-Type Notifications', description: 'Send info, success, warning, and error notifications.' },
      { icon: '🔊', title: 'Sound Effects', description: 'Optional audio alerts with configurable volume.' },
      { icon: '🔕', title: 'Do Not Disturb', description: 'Suppress notifications when you need to focus.' },
      { icon: '💻', title: 'Desktop Notifications', description: 'Optional native OS desktop notification support.' },
      { icon: '📜', title: 'Notification History', description: 'Maintains a history of past notifications.' },
    ],
    tools: [
      { name: 'send_notification', description: 'Send a notification to the user with title, message, type, and priority.', example: '"Send a success notification: Build completed successfully!"' },
    ],
    usageExamples: [
      'Notify when a long-running task completes',
      'Send a warning about low disk space',
      'Alert the user about a critical error',
    ],
  },

  openclaw: {
    displayName: 'OpenClaw Integration',
    tagline: 'Delegate tasks to OpenClaw AI agents',
    description:
      'Connect to an OpenClaw AI agent gateway for task delegation. Send tasks to remote OpenClaw sessions, manage multiple agent sessions, and orchestrate complex multi-agent workflows.',
    category: 'integration',
    iconEmoji: '🦞',
    features: [
      { icon: '🤖', title: 'Task Delegation', description: 'Send tasks and messages to OpenClaw AI agent sessions.' },
      { icon: '📡', title: 'Session Management', description: 'List and manage active OpenClaw sessions.' },
      { icon: '🔗', title: 'WebSocket Bridge', description: 'Real-time communication with the OpenClaw gateway.' },
      { icon: '⚙️', title: 'Configurable Thinking', description: 'Set thinking level (low/medium/high) for delegated tasks.' },
    ],
    tools: [
      { name: 'delegate_to_openclaw', description: 'Send a task or message to an OpenClaw agent session.', example: '"Delegate: review this pull request for security issues"' },
      { name: 'openclaw_status', description: 'Check the status of the OpenClaw connection.' },
      { name: 'openclaw_sessions', description: 'List all active OpenClaw sessions.' },
    ],
    usageExamples: [
      'Delegate a code review task to OpenClaw',
      'Check the status of all running agent sessions',
      'Send a research task with high thinking level',
    ],
    requiresConfig: [
      { key: 'openClawApiKey', label: 'OpenClaw API Key' },
      { key: 'openClawBaseUrl', label: 'OpenClaw WebSocket URL' },
    ],
  },

  personas: {
    displayName: 'AI Personas',
    tagline: 'Create and switch AI personality profiles',
    description:
      'Define and switch between different AI personas. Each persona has its own identity, voice, mission priorities, and behavioral directives. Customize how the AI communicates and what it prioritizes.',
    category: 'ai',
    iconEmoji: '🎭',
    features: [
      { icon: '🔄', title: 'Persona Switching', description: 'Instantly switch between different AI personality profiles.' },
      { icon: '✏️', title: 'Custom Personas', description: 'Create entirely new personas with custom identity and directives.' },
      { icon: '🎯', title: 'Mission Priorities', description: 'Each persona can have different mission objectives and priorities.' },
      { icon: '🗣️', title: 'Voice & Style', description: 'Configure communication style — formal, casual, technical, creative, etc.' },
    ],
    tools: [
      { name: 'switch_persona', description: 'Switch to a different AI persona.', example: '"Switch to the-architect persona"' },
      { name: 'list_personas', description: 'List all available personas with descriptions.' },
      { name: 'get_active_persona', description: 'Get full configuration of the current persona.' },
      { name: 'create_persona', description: 'Create a new custom persona configuration.' },
    ],
    usageExamples: [
      'Switch to a technical architect persona for system design',
      'Create a creative writing persona',
      'List all available personas and their descriptions',
    ],
  },

  'poorman-alpha': {
    displayName: 'Poorman Alpha (CAS)',
    tagline: 'Computational math: symbolic algebra, SymPy, matrices',
    description:
      'Advanced computational mathematics plugin with symbolic algebra (via nerdamer), a Python SymPy bridge for complex symbolic computation, matrix operations, and computation caching. A lightweight alternative to Wolfram Alpha.',
    category: 'utility',
    iconEmoji: '∑',
    features: [
      { icon: '🔣', title: 'Symbolic Algebra', description: 'Native symbolic math with nerdamer for fast algebraic computations.' },
      { icon: '🐍', title: 'SymPy Bridge', description: 'Full Python SymPy integration for advanced symbolic math, calculus, and plotting.' },
      { icon: '📊', title: 'Matrix Operations', description: 'Determinants, inverses, eigenvalues, and more for matrices.' },
      { icon: '📈', title: 'Plot Generation', description: 'Generate mathematical plots as base64 PNG images via SymPy.' },
      { icon: '💾', title: 'Result Caching', description: 'Cache computation results for faster repeated evaluations.' },
    ],
    tools: [
      { name: 'compute', description: 'Evaluate mathematical expressions using the native nerdamer engine.', example: '"Compute: integrate(x^2, x)"' },
      { name: 'sympy_compute', description: 'Run complex symbolic computation via Python SymPy.', example: '"SymPy: solve x^3 - 6x^2 + 11x - 6 = 0"' },
      { name: 'matrix_compute', description: 'Perform matrix operations (determinant, inverse, eigenvalues).', example: '"Find the eigenvalues of [[2,1],[1,2]]"' },
      { name: 'compute_cache_stats', description: 'View or clear the computation cache.' },
    ],
    usageExamples: [
      'Integrate sin(x)*cos(x) with respect to x',
      'Find the eigenvalues of a 3x3 matrix',
      'Solve a system of differential equations',
    ],
  },

  'prompt-editor': {
    displayName: 'Prompt Editor',
    tagline: 'Manage and execute prompt chains',
    description:
      'Create, manage, and execute multi-step prompt chains. Build reusable sequences of AI prompts that can be chained together with variable substitution, enabling sophisticated prompt engineering workflows.',
    category: 'ai',
    iconEmoji: '📋',
    features: [
      { icon: '🔗', title: 'Prompt Chaining', description: 'Link multiple prompts in sequence with output flowing to the next step.' },
      { icon: '📝', title: 'CRUD Operations', description: 'Create, read, update, and delete prompt chain configurations.' },
      { icon: '▶️', title: 'Chain Execution', description: 'Execute prompt chains with input variables and get combined results.' },
      { icon: '📡', title: 'Execution Broadcast', description: 'Real-time WebSocket events during chain execution for monitoring.' },
    ],
    tools: [
      { name: 'list_prompt_chains', description: 'List all saved prompt chains.' },
      { name: 'read_prompt_chain', description: 'Read the configuration of a prompt chain.' },
      { name: 'write_prompt_chain', description: 'Create or update a prompt chain configuration.' },
      { name: 'execute_prompt_chain', description: 'Execute a prompt chain with input variables.', example: '"Run the code-review chain on this function"' },
    ],
    usageExamples: [
      'Create a prompt chain for code review: analyze → suggest → summarize',
      'Build a content generation pipeline: outline → draft → edit',
      'Execute a multi-step research workflow',
    ],
  },

  'secure-backup': {
    displayName: 'Secure Backup',
    tagline: 'Encrypted backup and restore of application data',
    description:
      'Create encrypted backups of your application state and data using AES-256 encryption with PBKDF2 key derivation. Protect your conversations, settings, and workspace data with passphrase-based encryption.',
    category: 'utility',
    iconEmoji: '🔒',
    features: [
      { icon: '🔐', title: 'AES-256 Encryption', description: 'Backups are encrypted with AES-256-GCM for maximum security.' },
      { icon: '🔑', title: 'PBKDF2 Key Derivation', description: 'Passphrase-based key derivation with configurable iterations.' },
      { icon: '📦', title: 'Full State Backup', description: 'Backs up conversations, settings, and workspace data.' },
      { icon: '♻️', title: 'Easy Restore', description: 'Restore from any backup with the original passphrase.' },
    ],
    tools: [
      { name: 'create_backup', description: 'Create an encrypted backup with a passphrase.', example: '"Create a backup named \'weekly-backup\'"' },
      { name: 'restore_backup', description: 'Restore data from an encrypted backup.' },
      { name: 'list_backups', description: 'List all available backups.' },
    ],
    usageExamples: [
      'Create a backup before making major changes',
      'List all available backups',
      'Restore from the most recent backup',
    ],
  },

  'semantic-search': {
    displayName: 'Semantic Search',
    tagline: 'Store and search information using semantic queries',
    description:
      'A knowledge base with semantic (meaning-based) search capabilities. Store documents and information, then search using natural language queries. The AI ranks results by conceptual relevance rather than simple keyword matching.',
    category: 'data',
    iconEmoji: '🔍',
    features: [
      { icon: '💾', title: 'Document Storage', description: 'Store text documents with unique IDs for later retrieval.' },
      { icon: '🧠', title: 'Semantic Ranking', description: 'AI-powered ranking finds conceptually related content, not just keyword matches.' },
      { icon: '🔤', title: 'Keyword Fallback', description: 'Falls back to keyword search if AI ranking is unavailable.' },
      { icon: '📊', title: 'Configurable Results', description: 'Set result limits and snippet lengths for optimal output.' },
    ],
    tools: [
      { name: 'store_content', description: 'Store a document in the knowledge base.', example: '"Store this architecture document for future reference"' },
      { name: 'search_content', description: 'Search the knowledge base with a semantic query.', example: '"Search for information about authentication patterns"' },
    ],
    usageExamples: [
      'Store project documentation for quick reference',
      'Search for "how to handle authentication" across stored docs',
      'Find all content related to "database optimization"',
    ],
  },

  'temporal-voyager': {
    displayName: 'Temporal Voyager',
    tagline: 'Time-travel debugging through agent loop history',
    description:
      'Record and navigate through agent loop execution steps. Jump to any point in the agent\'s reasoning timeline to inspect decisions, tool calls, and state changes. Essential for understanding and debugging complex agent behaviors.',
    category: 'debugging',
    iconEmoji: '⏰',
    features: [
      { icon: '📜', title: 'Timeline Recording', description: 'Automatically records every agent loop step with full state.' },
      { icon: '⏪', title: 'Time Travel', description: 'Jump to any recorded step to inspect the agent\'s state at that moment.' },
      { icon: '🗂️', title: 'Timeline Browsing', description: 'List and browse recorded steps with metadata.' },
      { icon: '🧹', title: 'Auto Cleanup', description: 'Automatically prunes old entries to manage storage.' },
    ],
    tools: [
      { name: 'list_timeline_steps', description: 'List recorded agent loop steps.', example: '"Show me the last 20 agent steps"' },
      { name: 'jump_to_timeline_step', description: 'Jump to a specific step in the timeline.', example: '"Go back to step abc123 where the error occurred"' },
    ],
    usageExamples: [
      'Review the agent\'s reasoning for the last task',
      'Jump back to where an error first occurred',
      'Inspect what tools were called and in what order',
    ],
  },

  'thought-stream-debugger': {
    displayName: 'Thought Stream Debugger',
    tagline: 'Inspect agent reasoning traces and tool executions',
    description:
      'Debug and inspect the AI agent\'s reasoning process. Records agent sessions, tracks reasoning steps, and tool execution details. Provides a detailed audit trail for understanding how the agent arrives at its conclusions.',
    category: 'debugging',
    iconEmoji: '🔬',
    features: [
      { icon: '📝', title: 'Session Recording', description: 'Records complete agent sessions with all reasoning steps.' },
      { icon: '🔧', title: 'Tool Tracking', description: 'Tracks every tool execution with inputs, outputs, and timing.' },
      { icon: '🧵', title: 'Step-by-Step Traces', description: 'View the complete execution trace for any recorded session.' },
      { icon: '⚙️', title: 'Configurable Tracking', description: 'Toggle tracking of agent steps, loop steps, and tool executions.' },
    ],
    tools: [
      { name: 'list_agent_sessions', description: 'List all recorded agent reasoning sessions.' },
      { name: 'inspect_agent_session', description: 'View the detailed execution trace for a session.', example: '"Inspect session abc123 to see what went wrong"' },
    ],
    usageExamples: [
      'List recent agent sessions',
      'Inspect why the agent chose a particular approach',
      'Debug a session where the agent made an error',
    ],
  },

  tts: {
    displayName: 'Text-to-Speech (ElevenLabs)',
    tagline: 'Convert text to natural-sounding speech',
    description:
      'Convert text to speech using the ElevenLabs API. Generate high-quality, natural-sounding audio from text content. Supports multiple voices and configurable speech parameters.',
    category: 'media',
    iconEmoji: '🔊',
    features: [
      { icon: '🎙️', title: 'Natural Speech', description: 'High-quality text-to-speech powered by ElevenLabs AI voices.' },
      { icon: '🗣️', title: 'Multiple Voices', description: 'Choose from a variety of voices or use custom voice IDs.' },
      { icon: '⚙️', title: 'Voice Parameters', description: 'Adjust stability and similarity boost for fine-tuned output.' },
      { icon: '💾', title: 'Audio Output', description: 'Generated audio saved as files for playback or download.' },
    ],
    tools: [
      { name: 'speak_text', description: 'Convert text to speech using ElevenLabs.', example: '"Read this paragraph aloud with a warm voice"' },
    ],
    usageExamples: [
      'Read a document summary aloud',
      'Generate an audio version of meeting notes',
      'Create voiceover for a presentation',
    ],
    requiresConfig: [
      { key: 'elevenlabsApiKey', label: 'ElevenLabs API Key' },
    ],
  },

  'ui-themes': {
    displayName: 'UI Themes & Styling',
    tagline: 'Custom themes, CSS tokens, and display names',
    description:
      'Customize the entire look and feel of the Oboto UI. Choose from 16+ built-in themes, override individual CSS tokens, inject custom CSS, and set custom display names for the user and agent in chat.',
    category: 'utility',
    iconEmoji: '🎨',
    features: [
      { icon: '🌈', title: 'Theme Presets', description: 'Choose from cyberpunk, ocean, sunset, matrix, midnight, arctic, forest, and more.' },
      { icon: '🔧', title: 'CSS Token Overrides', description: 'Override individual CSS variables for fine-grained control.' },
      { icon: '💉', title: 'Custom CSS Injection', description: 'Inject arbitrary CSS for advanced customization.' },
      { icon: '👤', title: 'Display Names', description: 'Set custom names for the user and agent shown in chat messages.' },
      { icon: '💾', title: 'Persistent Changes', description: 'Theme changes survive restarts when persistence is enabled.' },
    ],
    tools: [
      { name: 'set_ui_theme', description: 'Apply a theme preset or custom theme.', example: '"Switch to the cyberpunk theme"' },
      { name: 'set_ui_tokens', description: 'Override specific CSS tokens.' },
      { name: 'inject_ui_css', description: 'Inject custom CSS into the UI.' },
      { name: 'reset_ui_style', description: 'Reset all styling to defaults.' },
      { name: 'get_ui_style_state', description: 'Query the current style state.' },
      { name: 'set_display_names', description: 'Set custom display names for user and agent.', example: '"Call me Captain and the AI Jarvis"' },
    ],
    usageExamples: [
      'Switch to the cyberpunk theme',
      'Set the primary color to a custom blue',
      'Change my display name to "Captain" and the agent to "Jarvis"',
    ],
  },

  'voice-suite': {
    displayName: 'Voice Suite',
    tagline: 'Multi-provider TTS, transcription, and voice tools',
    description:
      'A comprehensive voice manipulation suite supporting multiple providers (OpenAI and ElevenLabs). Includes text-to-speech, audio transcription (Whisper), voice listing, voice cloning, and sound effect generation.',
    category: 'media',
    iconEmoji: '🎤',
    features: [
      { icon: '🔊', title: 'Multi-Provider TTS', description: 'Text-to-speech via OpenAI or ElevenLabs with automatic provider selection.' },
      { icon: '📝', title: 'Audio Transcription', description: 'Transcribe audio to text using OpenAI Whisper.' },
      { icon: '🗣️', title: 'Voice Catalog', description: 'Browse available ElevenLabs voices with metadata.' },
      { icon: '🧬', title: 'Voice Cloning', description: 'Clone voices from audio samples (experimental).' },
      { icon: '🎵', title: 'Sound Effects', description: 'Generate sound effects from descriptions (experimental).' },
    ],
    tools: [
      { name: 'text_to_speech', description: 'Convert text to speech via OpenAI or ElevenLabs.', example: '"Say \'Hello World\' using OpenAI\'s voice"' },
      { name: 'transcribe_audio', description: 'Transcribe audio to text using Whisper.' },
      { name: 'get_voices', description: 'List available ElevenLabs voices.' },
      { name: 'clone_voice', description: 'Clone a voice from audio samples (experimental).' },
      { name: 'generate_sound_effect', description: 'Generate sound effects from descriptions (experimental).' },
    ],
    usageExamples: [
      'Convert this summary to speech using OpenAI',
      'Transcribe an audio recording to text',
      'List all available ElevenLabs voices',
    ],
  },

  'web-search': {
    displayName: 'Web Search',
    tagline: 'Search the web and fetch URL content',
    description:
      'Search the web using the Serper API and fetch content from URLs. Supports web search, news search, image search, and place search with configurable result counts, localization, and safe search settings.',
    category: 'data',
    iconEmoji: '🌐',
    features: [
      { icon: '🔍', title: 'Web Search', description: 'Search the web with customizable query parameters.' },
      { icon: '📰', title: 'News Search', description: 'Search for recent news articles on any topic.' },
      { icon: '🖼️', title: 'Image Search', description: 'Find images matching your query.' },
      { icon: '📍', title: 'Place Search', description: 'Search for locations and businesses.' },
      { icon: '🌍', title: 'Localization', description: 'Set geographic location and language for localized results.' },
    ],
    tools: [
      { name: 'search_web', description: 'Search the web with configurable type, count, and location.', example: '"Search for the latest React 19 features"' },
    ],
    usageExamples: [
      'Search for the latest TypeScript best practices',
      'Find recent news about AI developments',
      'Search for restaurants near Times Square',
    ],
    requiresConfig: [
      { key: 'serperApiKey', label: 'Serper API Key' },
    ],
  },

  'workflow-weaver': {
    displayName: 'Workflow Weaver',
    tagline: 'Visual orchestration for agents, tools, and queries',
    description:
      'A visual orchestration engine for chaining agents, tools, and semantic queries into reusable workflows. Define complex multi-step processes that can be executed with a single command, supporting agent steps, tool steps, and conditional logic.',
    category: 'automation',
    iconEmoji: '🕸️',
    features: [
      { icon: '🔗', title: 'Step Chaining', description: 'Chain agent, tool, and query steps into reusable workflows.' },
      { icon: '🤖', title: 'Agent Steps', description: 'Include AI agent reasoning as workflow steps with configurable prompts.' },
      { icon: '🔧', title: 'Tool Steps', description: 'Execute specific tools with parameters as workflow steps.' },
      { icon: '📦', title: 'Workflow Library', description: 'Save and manage a library of workflow definitions.' },
    ],
    tools: [
      { name: 'execute_weaved_workflow', description: 'Execute a saved workflow by ID.', example: '"Run the daily-report workflow"' },
      { name: 'create_weaved_workflow', description: 'Create or update a workflow definition.' },
      { name: 'list_weaved_workflows', description: 'List all defined workflows.' },
    ],
    usageExamples: [
      'Create a workflow: search web → summarize → save note',
      'Build a code review pipeline with multiple analysis steps',
      'Run the daily-report workflow',
    ],
  },

  workflows: {
    displayName: 'Workflow Automation',
    tagline: 'Todo lists, error recovery, and surface workflows',
    description:
      'Core workflow automation including todo list management for complex tasks, intelligent error recovery with alternative approaches, response quality evaluation, and BubbleLab surface automation workflows.',
    category: 'productivity',
    iconEmoji: '⚡',
    features: [
      { icon: '✅', title: 'Todo Lists', description: 'Break complex tasks into tracked steps with status management.' },
      { icon: '🔄', title: 'Error Recovery', description: 'Analyze errors and automatically try alternative approaches.' },
      { icon: '⭐', title: 'Quality Evaluation', description: 'Rate AI response quality and suggest improvements.' },
      { icon: '🎨', title: 'Surface Workflows', description: 'Start BubbleLab automation workflows bound to visual surfaces.' },
    ],
    tools: [
      { name: 'create_todo_list', description: 'Break a complex task into sequential todo steps.' },
      { name: 'update_todo_status', description: 'Update the status of a todo step.' },
      { name: 'analyze_and_recover', description: 'Analyze errors and attempt recovery strategies.' },
      { name: 'evaluate_response_quality', description: 'Evaluate and rate an AI response.' },
      { name: 'start_surface_workflow', description: 'Start a BubbleLab visual surface workflow.' },
    ],
    usageExamples: [
      'Create a todo list for migrating the database',
      'Analyze the last error and try an alternative approach',
      'Evaluate whether the AI\'s response was comprehensive enough',
    ],
  },
};

/**
 * Get welcome info for a plugin by name.
 * Falls back to a generic info object if no specific data exists.
 */
export function getPluginWelcomeInfo(pluginName: string): PluginWelcomeInfo {
  if (pluginWelcomeData[pluginName]) {
    return pluginWelcomeData[pluginName];
  }

  // Generic fallback for unknown plugins
  return {
    displayName: pluginName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    tagline: 'Plugin for Oboto',
    description: `The ${pluginName} plugin extends Oboto with additional capabilities.`,
    category: 'utility',
    iconEmoji: '🔌',
    features: [],
    tools: [],
  };
}
