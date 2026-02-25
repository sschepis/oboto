import { now } from './helpers.mjs';

export class SemanticComputing {
  constructor(store) {
    this.store = store;
    this.focusTopics = [];
    this.focusExpiration = 0;
    this.cognitiveState = 'resting';
  }

  think(text, depth = 'normal') {
    this.cognitiveState = 'focused';

    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const wordCounts = new Map();
    for (const w of words) {
      wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
    }
    const themes = Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, depth === 'deep' ? 8 : depth === 'normal' ? 5 : 3)
      .map(([w]) => w);

    const totalWords = words.length || 1;
    const themeOccurrences = themes.reduce((s, t) => s + (wordCounts.get(t) || 0), 0);
    const coherence = Math.min(themeOccurrences / totalWords, 1);

    const focusBoost =
      this.focusTopics.length > 0 && now() < this.focusExpiration
        ? themes.filter(t => this.focusTopics.some(ft => ft.toLowerCase().includes(t))).length * 0.1
        : 0;

    return {
      coherence: Math.min(coherence + focusBoost, 1),
      themes,
      insight: `Analysis of ${words.length} tokens yields ${themes.length} core themes with ${(coherence * 100).toFixed(1)}% coherence.`,
      suggestedActions:
        themes.length > 0
          ? [`Explore theme: ${themes[0]}`, 'Store as memory fragment', 'Compare with existing knowledge']
          : ['Provide more detailed input for analysis'],
    };
  }

  compare(text1, text2) {
    this.cognitiveState = 'exploring';

    const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3));

    const shared = Array.from(words1).filter(w => words2.has(w));
    const unique1 = Array.from(words1).filter(w => !words2.has(w));
    const unique2 = Array.from(words2).filter(w => !words1.has(w));

    const unionSize = new Set([...words1, ...words2]).size;
    const similarity = unionSize > 0 ? shared.length / unionSize : 0;

    return {
      similarity,
      explanation: `Texts share ${shared.length} common terms out of ${unionSize} unique terms (Jaccard: ${(similarity * 100).toFixed(1)}%).`,
      sharedThemes: shared.slice(0, 10),
      differentThemes: [...unique1.slice(0, 5), ...unique2.slice(0, 5)],
    };
  }

  remember(content, importance = 0.5) {
    this.cognitiveState = 'consolidating';

    const themes = content
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4)
      .slice(0, 5);

    let defaultField = Array.from(this.store.getFieldsMap().values()).find(f => f.name === '__default__');
    if (!defaultField) {
      defaultField = this.store.createField({
        name: '__default__',
        scope: 'user',
        description: 'Default memory field for remembered items',
        visibility: 'private',
      });
    }

    const fragment = this.store.storeFragment({
      fieldId: defaultField.id,
      content,
      significance: importance,
    });

    return {
      confirmed: true,
      themes,
      fragmentId: fragment.id,
    };
  }

  recall(query, limit = 10) {
    this.cognitiveState = 'focused';

    const allFragments = [];
    for (const [, frags] of this.store.getFragmentsMap()) {
      allFragments.push(...frags);
    }

    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

    const scored = allFragments
      .map(f => {
        const contentLower = f.content.toLowerCase();
        const contentTerms = contentLower.split(/\s+/);
        const overlap = queryTerms.filter(t => contentTerms.some(ct => ct.includes(t))).length;
        const sim = queryTerms.length > 0 ? overlap / queryTerms.length : 0;
        return { ...f, similarity: sim * 0.7 + f.significance * 0.3 };
      })
      .filter(f => (f.similarity ?? 0) > 0.05)
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
      .slice(0, limit);

    return { fragments: scored };
  }

  introspect() {
    const fragmentsMap = this.store.getFragmentsMap();
    const totalFragments = Array.from(fragmentsMap.values()).reduce((s, f) => s + f.length, 0);
    const avgSignificance =
      totalFragments > 0
        ? Array.from(fragmentsMap.values())
            .flat()
            .reduce((s, f) => s + f.significance, 0) / totalFragments
        : 0;

    const activeTopics =
      this.focusTopics.length > 0 && now() < this.focusExpiration ? this.focusTopics : [];

    return {
      state: this.cognitiveState,
      mood:
        this.cognitiveState === 'resting'
          ? 'calm'
          : this.cognitiveState === 'focused'
            ? 'engaged'
            : 'curious',
      confidence: Math.min(0.3 + avgSignificance * 0.7, 1),
      recommendations: [
        totalFragments < 10 ? 'Store more memories to improve recall' : 'Memory base is healthy',
        activeTopics.length === 0
          ? 'Set focus topics to improve coherence'
          : `Currently focused on: ${activeTopics.join(', ')}`,
        `${this.store.getFieldsMap().size} memory fields active`,
      ],
      activeTopics,
      entropy: this.computeGlobalEntropy(),
    };
  }

  focus(topics, duration = 3600000) {
    this.focusTopics = topics
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);
    this.focusExpiration = now() + duration;
    this.cognitiveState = 'focused';

    return {
      topics: this.focusTopics,
      expiration: this.focusExpiration,
    };
  }

  computeGlobalEntropy() {
    const allFragments = Array.from(this.store.getFragmentsMap().values()).flat();
    if (allFragments.length === 0) return 0;
    const total = allFragments.reduce((s, f) => s + f.significance, 0) || 1;
    let entropy = 0;
    for (const f of allFragments) {
      const p = f.significance / total;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    return entropy;
  }
}
