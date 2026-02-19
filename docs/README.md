# Oboto Documentation

Welcome to the documentation for **Oboto**, an advanced AI-powered development assistant designed for autonomous software engineering.

## 📚 Documentation Index

### 🏗 Architecture
Learn about the internal design of Oboto.
*   [**System Overview**](architecture/overview.md): High-level architecture, components, and data flow.
*   [**Multi-Agent Architecture**](architecture/multi-agent.md): Multiple conversations, background tasks, recurring tasks, and the autonomous agent loop.
*   [**Consciousness Processor**](architecture/consciousness.md): Understanding the agent's "mind" (inference, somatic state, symbolic continuity).
*   [**Structured Development**](architecture/structured-dev.md): The manifest-driven development workflow (`SYSTEM_MAP.md`).
*   [**Integrations**](architecture/integrations.md): Architecture for OpenClaw and Model Context Protocol (MCP).
*   [**Skills System**](architecture/skills.md): Extending the agent with modular skills (`SKILL.md`).

### 🚀 Guides & Usage
Practical guides for setting up and using Oboto.
*   [**Setup & Installation**](guides/setup.md): How to install and run the project.
*   [**Tools Reference**](guides/tools.md): A complete list of available tools and commands.
*   [**UI Surfaces**](guides/ui-surfaces.md): Using dynamic dashboards and UI components.

## ⚡ Quick Start

1.  **Install**: `npm install`
2.  **Configure**: Copy `.env.example` to `.env`
3.  **Run Server**: `npm run serve`
4.  **Run UI**: `npm run dev:ui` (in `ui/` folder)

## 💡 Key Features
*   **Multi-Agent**: Multiple parallel conversations, background tasks, recurring schedules, and an autonomous agent loop that operates independently.
*   **Autonomous Loop**: A background heartbeat that dynamically assembles context and acts on the user's behalf.
*   **Embodied Cognition**: Simulates internal state to modulate behavior.
*   **Structured Engineering**: Manages projects via a "Living Manifest".
*   **Dynamic UI**: Can generate custom dashboards on the fly.
*   **Multi-Modal**: Supports chat, file editing, terminal commands, and browser automation.
