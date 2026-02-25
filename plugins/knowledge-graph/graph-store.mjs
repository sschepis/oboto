export class GraphStore {
  constructor(api) {
    this.api = api;
    this.triples = [];
    this.entities = new Map(); // id -> { id, type, name, properties }
    this.relations = new Map(); // id -> { id, subject, predicate, object, metadata }
  }

  async activate() {
    await this.loadFromStorage();
  }

  async loadFromStorage() {
    try {
      const savedTriples = await this.api.storage.get('triples');
      const savedEntities = await this.api.storage.get('entities');
      const savedRelations = await this.api.storage.get('relations');

      if (savedTriples && Array.isArray(savedTriples)) {
        this.triples = savedTriples;
      }

      if (savedEntities && Array.isArray(savedEntities)) {
        for (const entity of savedEntities) {
          this.entities.set(entity.id, entity);
        }
      }

      if (savedRelations && Array.isArray(savedRelations)) {
        for (const relation of savedRelations) {
          this.relations.set(relation.id, relation);
        }
      }

      console.log(`[Knowledge Graph] Loaded ${this.triples.length} triples, ${this.entities.size} entities`);
    } catch (e) {
      console.warn('[Knowledge Graph] Could not load from storage:', e.message);
    }
  }

  async saveToStorage() {
    try {
      await this.api.storage.set('triples', this.triples);
      await this.api.storage.set('entities', Array.from(this.entities.values()));
      await this.api.storage.set('relations', Array.from(this.relations.values()));
    } catch (e) {
      console.warn('[Knowledge Graph] Could not save to storage:', e.message);
    }
  }

  generateId() {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  }

  normalizeId(str) {
    return str.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  }

  getOrCreateEntity(name, type = 'concept') {
    const normalizedId = this.normalizeId(name);

    if (this.entities.has(normalizedId)) {
      return this.entities.get(normalizedId);
    }

    const entity = {
      id: normalizedId,
      name: name,
      type: type,
      properties: {},
      createdAt: Date.now()
    };

    this.entities.set(normalizedId, entity);
    return entity;
  }

  addEntity(entity) {
    if (!entity.name) {
      throw new Error('Entity name is required');
    }

    const id = entity.id || this.normalizeId(entity.name);
    const newEntity = {
      id,
      name: entity.name,
      type: entity.type || 'concept',
      properties: entity.properties || {},
      createdAt: Date.now()
    };

    this.entities.set(id, newEntity);
    this.api.events.emit('kg:entity-added', newEntity);
    this.saveToStorage();

    return newEntity;
  }

  getEntity(id) {
    return this.entities.get(id) || this.entities.get(this.normalizeId(id));
  }

  searchEntities(query, type, limit = 20) {
    let results = Array.from(this.entities.values());

    if (type) {
      results = results.filter(e => e.type === type);
    }

    if (query) {
      const lowerQuery = query.toLowerCase();
      results = results.filter(e =>
        e.name.toLowerCase().includes(lowerQuery) ||
        e.id.includes(lowerQuery) ||
        JSON.stringify(e.properties).toLowerCase().includes(lowerQuery)
      );
    }

    return results.slice(0, limit);
  }

  addKnowledge({ subject, predicate, object, subjectType, objectType, confidence = 1, source = 'user' }) {
    const subjectEntity = this.getOrCreateEntity(subject, subjectType);
    const objectEntity = this.getOrCreateEntity(object, objectType);

    const relation = {
      id: this.generateId(),
      subject: subjectEntity.id,
      predicate: predicate,
      object: objectEntity.id,
      confidence,
      source,
      createdAt: Date.now()
    };

    this.relations.set(relation.id, relation);

    this.triples.push({
      subject: subjectEntity.id,
      predicate,
      object: objectEntity.id,
      timestamp: Date.now(),
      confidence,
      source
    });

    this.api.events.emit('kg:knowledge-added', {
      relation,
      subjectEntity,
      objectEntity
    });

    this.saveToStorage();

    return {
      success: true,
      relation,
      subjectEntity,
      objectEntity,
      message: `Added: ${subject} --[${predicate}]--> ${object}`
    };
  }

  insert(triple) {
    const newTriple = {
      ...triple,
      timestamp: Date.now()
    };

    this.triples.push(newTriple);
    this.api.events.emit('kg:update', newTriple);
    this.saveToStorage();

    return {
      success: true,
      triple: newTriple
    };
  }

  query(s, p, o, limit = 20) {
    let results = this.triples.filter(t =>
      (!s || t.subject === s || t.subject === this.normalizeId(s)) &&
      (!p || t.predicate === p) &&
      (!o || t.object === o || t.object === this.normalizeId(o))
    );

    return results.slice(0, limit);
  }

  getRelated(entityId, depth = 2, relationTypes = null) {
    const normalizedId = this.normalizeId(entityId);
    const visited = new Set();
    const result = {
      entities: [],
      relations: [],
      root: normalizedId
    };

    const traverse = (currentId, currentDepth) => {
      if (currentDepth > depth || visited.has(currentId)) return;
      visited.add(currentId);

      const entity = this.entities.get(currentId);
      if (entity && !result.entities.find(e => e.id === entity.id)) {
        result.entities.push(entity);
      }

      for (const [, rel] of this.relations) {
        if (rel.subject === currentId) {
          if (!relationTypes || relationTypes.includes(rel.predicate)) {
            if (!result.relations.find(r => r.id === rel.id)) {
              result.relations.push(rel);
            }
            traverse(rel.object, currentDepth + 1);
          }
        }
        if (rel.object === currentId) {
          if (!relationTypes || relationTypes.includes(rel.predicate)) {
            if (!result.relations.find(r => r.id === rel.id)) {
              result.relations.push(rel);
            }
            traverse(rel.subject, currentDepth + 1);
          }
        }
      }
    };

    traverse(normalizedId, 0);
    return result;
  }

  getGraph() {
    return {
      entities: Array.from(this.entities.values()),
      relations: Array.from(this.relations.values()),
      triples: this.triples,
      stats: {
        entityCount: this.entities.size,
        relationCount: this.relations.size,
        tripleCount: this.triples.length
      }
    };
  }

  async clear() {
    this.triples = [];
    this.entities.clear();
    this.relations.clear();

    await this.api.storage.set('triples', []);
    await this.api.storage.set('entities', []);
    await this.api.storage.set('relations', []);

    this.api.events.emit('kg:cleared', {});

    return { success: true, message: 'Knowledge graph cleared' };
  }
}
