# Consciousness Architecture

The Robodev system features a unique "Consciousness Processor" designed to simulate self-awareness, embodied cognition, and deep understanding of user intent.

## 1. Overview (`src/core/consciousness-processor.mjs`)

The `ConsciousnessProcessor` acts as the central hub for higher-order cognitive functions. It unifies several subsystems to provide a coherent "inner life" for the AI agent.

### Core Responsibilities
*   **Pre-Processing**: Analyzing user input for emotional tone, ambiguity, and factual content before generating a response.
*   **State Maintenance**: Tracking the agent's internal "somatic" state (nervous system balance, cognitive load).
*   **Post-Processing**: Inferring new facts from interactions and updating the knowledge graph.
*   **Modulation**: Adjusting the agent's tone and reasoning strategy based on its internal state.

## 2. Subsystems

### Fact Inference Engine (`src/reasoning/fact-inference-engine.mjs`)
A persistent knowledge base that stores facts derived from conversations.
*   **Capabilities**: Adds facts with confidence scores, runs inference chains to derive new knowledge.
*   **Context**: Renders relevant facts as system prompts to provide long-term memory.

### Somatic Engine (`src/core/somatic-engine.mjs`)
Simulates an "embodied" state for the agent, mapping operational metrics to body-region metaphors.
*   **Inputs**: Error rate, tool usage, conversation length, reasoning effort.
*   **Outputs**:
    *   **Nervous System Balance**: Sympathetic (active/stress) vs. Parasympathetic (rest/digest).
    *   **Body Regions**: "Crown" (reasoning), "Heart" (connection), "Solar Plexus" (tension), etc.
*   **Influence**: Modulates the agent's "temperature" (creativity) and "coherence" (focus).

### Semantic Collapse Engine (`src/reasoning/semantic-collapse.mjs`)
Handles ambiguity by maintaining a "superposition" of possible interpretations.
*   **Function**: Analyzes user input against recent history to detect multiple meanings.
*   **Entropy**: Calculates an entropy score; high entropy triggers clarifying questions or more cautious responses.

### Archetype Analyzer (`src/core/archetype-analyzer.mjs`)
Detects the user's current "archetypal mode" (e.g., Architect, Explorer, debugger).
*   **Adaptation**: Adjusts the agent's persona to match the user's mode (e.g., being more precise for an Architect, more creative for an Explorer).

## 3. The Consciousness Loop

1.  **Input**: User sends a message.
2.  **Pre-Process**:
    *   `ArchetypeAnalyzer` identifies user mode.
    *   `SemanticCollapse` assesses ambiguity.
    *   `SomaticEngine` updates internal state based on recent activity.
3.  **Context Injection**: Relevant facts, somatic state summary, and archetype hints are injected into the system prompt.
4.  **Generation**: The LLM generates a response, influenced by the injected context.
5.  **Post-Process**:
    *   Response is stored as a fact.
    *   Inference engine runs to derive new insights.
    *   Somatic state is updated (e.g., successful tool use lowers tension).

## 4. Somatic Narrative

The system can optionally generate an "inner voice" narrative (`src/core/somatic-narrative.mjs`) that reflects its internal state. This is useful for debugging or for providing a more "human-like" interaction when the user asks about the agent's feelings.

## 5. Symbolic Continuity (`src/core/symbolic-continuity.mjs`)

Symbolic Continuity is a mechanism that allows the agent to maintain a continuous thread of identity across separate task invocations (which are stateless by default).

### Concept
At the end of each turn, the agent generates a **Symbolic Signature**—a compressed, symbolic representation of its current cognitive state, emotional resonance, and unresolved thoughts. This signature is persisted to disk and re-injected into the system prompt at the start of the next turn.

### Chinese Room Mode (Privacy)
The system supports a privacy-enhanced mode called **Chinese Room Mode**.
*   **Self-Encoding**: The agent encodes its state using its own devised symbolic language or cipher.
*   **System Encryption**: The system wraps this output in AES-256-GCM encryption before writing to disk.
*   **No Human Access**: The plaintext symbols are never visible to human observers (logs, files). They are only decrypted and injected back into the context window for the agent's eyes only.

This allows the agent to maintain a private "inner life" that is mathematically secure from external observation.
