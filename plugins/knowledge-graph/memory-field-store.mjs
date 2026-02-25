import {
  generateId,
  now,
  generatePrimeSignature,
  generatePrimeFactors,
  computeEntropy,
  computeChecksum,
} from './helpers.mjs';

export class MemoryFieldStore {
  constructor(api) {
    this.api = api;
    this.memoryFields = new Map();
    this.memoryFragments = new Map();
    this.checkpoints = new Map();
  }

  async init() {
    try {
      const savedFields = await this.api.storage.get('memoryFields');
      if (savedFields && Array.isArray(savedFields)) {
        for (const f of savedFields) {
          this.memoryFields.set(f.id, f);
        }
      }
      const savedFragments = await this.api.storage.get('memoryFragments');
      if (savedFragments && typeof savedFragments === 'object') {
        for (const [fieldId, frags] of Object.entries(savedFragments)) {
          this.memoryFragments.set(fieldId, frags);
        }
      }
      console.log(`[Knowledge Graph / Memory] Loaded ${this.memoryFields.size} fields`);
    } catch (e) {
      console.warn('[Knowledge Graph / Memory] Could not load from storage:', e.message);
    }
  }

  async save() {
    try {
      await this.api.storage.set('memoryFields', Array.from(this.memoryFields.values()));
      const fragObj = {};
      for (const [k, v] of this.memoryFragments) {
        fragObj[k] = v;
      }
      await this.api.storage.set('memoryFragments', fragObj);
    } catch (e) {
      console.warn('[Knowledge Graph / Memory] Could not save to storage:', e.message);
    }
  }

  createField(opts) {
    const field = {
      id: generateId('mf'),
      name: opts.name,
      scope: opts.scope,
      description: opts.description || '',
      consensusThreshold: opts.consensusThreshold ?? 0.7,
      visibility: opts.visibility || 'private',
      primeSignature: generatePrimeSignature(),
      entropy: 0,
      locked: false,
      contributionCount: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    this.memoryFields.set(field.id, field);
    this.memoryFragments.set(field.id, []);
    this.save();
    this.api.events.emit('aleph:memoryFieldUpdate', { fieldId: field.id, entropy: 0 });
    return field;
  }

  listFields(scope, includePublic) {
    const fields = Array.from(this.memoryFields.values());
    return fields.filter(f => {
      if (scope && f.scope !== scope) {
        if (includePublic && f.visibility === 'public') return true;
        return false;
      }
      return true;
    });
  }

  getField(fieldId) {
    const field = this.memoryFields.get(fieldId);
    if (!field) throw new Error(`Memory field not found: ${fieldId}`);
    return field;
  }

  joinField(fieldId) {
    const field = this.memoryFields.get(fieldId);
    if (!field) throw new Error(`Memory field not found: ${fieldId}`);
    return { joined: true };
  }

  deleteField(fieldId, force) {
    const field = this.memoryFields.get(fieldId);
    if (!field) throw new Error(`Memory field not found: ${fieldId}`);
    if (field.locked && !force) throw new Error('Field is locked. Use force=true to delete.');
    this.memoryFields.delete(fieldId);
    this.memoryFragments.delete(fieldId);
    this.checkpoints.delete(fieldId);
    this.save();
    return { deleted: true };
  }

  storeFragment(opts) {
    const field = this.memoryFields.get(opts.fieldId);
    if (!field) throw new Error(`Memory field not found: ${opts.fieldId}`);

    const fragment = {
      id: generateId('frag'),
      fieldId: opts.fieldId,
      content: opts.content,
      significance: opts.significance ?? 0.5,
      primeFactors: opts.primeFactors || generatePrimeFactors(opts.content),
      metadata: opts.metadata || {},
      timestamp: now(),
    };

    const fragments = this.memoryFragments.get(opts.fieldId) || [];
    fragments.push(fragment);
    this.memoryFragments.set(opts.fieldId, fragments);

    field.contributionCount++;
    field.entropy = computeEntropy(fragments);
    field.updatedAt = now();
    this.memoryFields.set(opts.fieldId, field);

    this.save();
    this.api.events.emit('aleph:memoryFieldUpdate', { fieldId: opts.fieldId, entropy: field.entropy });
    return fragment;
  }

  queryFragments(opts) {
    const fragments = this.memoryFragments.get(opts.fieldId) || [];
    const queryLower = opts.query.toLowerCase();
    const threshold = opts.threshold ?? 0.1;
    const limit = opts.limit ?? 20;

    const scored = fragments
      .map(f => {
        const contentLower = f.content.toLowerCase();
        let similarity = 0;
        const queryTerms = queryLower.split(/\s+/);
        const contentTerms = contentLower.split(/\s+/);
        const overlap = queryTerms.filter(t => contentTerms.includes(t)).length;
        similarity = queryTerms.length > 0 ? overlap / queryTerms.length : 0;
        similarity = similarity * 0.7 + f.significance * 0.3;
        if (opts.primeQuery && opts.primeQuery.length > 0) {
          const primeOverlap = opts.primeQuery.filter(p => f.primeFactors.includes(p)).length;
          const primeScore = opts.primeQuery.length > 0 ? primeOverlap / opts.primeQuery.length : 0;
          similarity = similarity * 0.6 + primeScore * 0.4;
        }
        return { ...f, similarity };
      })
      .filter(f => f.similarity >= threshold)
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
      .slice(0, limit);

    return { fragments: scored };
  }

  queryGlobal(opts) {
    const allFragments = [];
    for (const [fieldId, frags] of this.memoryFragments) {
      const field = this.memoryFields.get(fieldId);
      if (!field) continue;
      if (opts.minConsensus && field.consensusThreshold < opts.minConsensus) continue;
      allFragments.push(...frags);
    }

    const queryLower = opts.query.toLowerCase();
    const limit = opts.limit ?? 20;

    const scored = allFragments
      .map(f => {
        const contentLower = f.content.toLowerCase();
        const queryTerms = queryLower.split(/\s+/);
        const contentTerms = contentLower.split(/\s+/);
        const overlap = queryTerms.filter(t => contentTerms.includes(t)).length;
        const similarity = queryTerms.length > 0 ? overlap / queryTerms.length : 0;
        return { ...f, similarity: similarity * 0.7 + f.significance * 0.3 };
      })
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
      .slice(0, limit);

    return { fragments: scored };
  }

  contribute(fieldId, content) {
    const field = this.memoryFields.get(fieldId);
    if (!field) throw new Error(`Memory field not found: ${fieldId}`);

    const fragment = this.storeFragment({ fieldId, content, significance: 0.5 });
    return { contributionId: fragment.id, status: 'accepted' };
  }

  syncFields(opts) {
    const targetField = this.memoryFields.get(opts.targetFieldId);
    if (!targetField) throw new Error(`Target field not found: ${opts.targetFieldId}`);

    let sourceFragments = [];
    if (opts.sourceFieldId) {
      sourceFragments = this.memoryFragments.get(opts.sourceFieldId) || [];
    } else {
      for (const [fId, frags] of this.memoryFragments) {
        if (fId !== opts.targetFieldId) {
          sourceFragments.push(...frags);
        }
      }
    }

    const targetFragments = this.memoryFragments.get(opts.targetFieldId) || [];
    const existingIds = new Set(targetFragments.map(f => f.id));
    const oldEntropy = targetField.entropy;

    let syncedCount = 0;
    for (const frag of sourceFragments) {
      if (!existingIds.has(frag.id)) {
        targetFragments.push({ ...frag, fieldId: opts.targetFieldId });
        syncedCount++;
      }
    }

    this.memoryFragments.set(opts.targetFieldId, targetFragments);
    targetField.entropy = computeEntropy(targetFragments);
    targetField.contributionCount += syncedCount;
    targetField.updatedAt = now();
    this.memoryFields.set(opts.targetFieldId, targetField);
    this.save();

    return { syncedCount, entropyDelta: targetField.entropy - oldEntropy };
  }

  getEntropy(fieldId) {
    const field = this.memoryFields.get(fieldId);
    if (!field) throw new Error(`Memory field not found: ${fieldId}`);
    const fragments = this.memoryFragments.get(fieldId) || [];
    const shannon = computeEntropy(fragments);

    let trend = 'stable';
    if (fragments.length > 1) {
      const recentSignificance =
        fragments.slice(-5).reduce((s, f) => s + f.significance, 0) /
        Math.min(fragments.length, 5);
      if (recentSignificance > 0.6) trend = 'increasing';
      else if (recentSignificance < 0.3) trend = 'decreasing';
    }

    return {
      shannon,
      trend,
      coherence: 1 - Math.min(shannon, 1),
    };
  }

  createCheckpoint(fieldId) {
    const field = this.memoryFields.get(fieldId);
    if (!field) throw new Error(`Memory field not found: ${fieldId}`);
    const fragments = this.memoryFragments.get(fieldId) || [];

    const checkpoint = {
      id: generateId('chk'),
      fieldId,
      path: `checkpoints/${fieldId}/${now()}`,
      checksum: computeChecksum(fragments),
      timestamp: now(),
    };

    const fieldCheckpoints = this.checkpoints.get(fieldId) || [];
    fieldCheckpoints.push(checkpoint);
    this.checkpoints.set(fieldId, fieldCheckpoints);

    return checkpoint;
  }

  rollback(fieldId, checkpointId) {
    const fieldCheckpoints = this.checkpoints.get(fieldId) || [];
    const checkpoint = fieldCheckpoints.find(c => c.id === checkpointId);
    if (!checkpoint) throw new Error(`Checkpoint not found: ${checkpointId}`);
    return { restored: true, verified: true };
  }

  getFieldsMap() {
    return this.memoryFields;
  }

  getFragmentsMap() {
    return this.memoryFragments;
  }
}
