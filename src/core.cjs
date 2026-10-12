'use strict';
const kdbx = require('kdbxweb');
const { argon2id, argon2d } = require('hash-wasm');
if (typeof globalThis.DOMParser === 'undefined') {
  const dom = require('@xmldom/xmldom');
  globalThis.DOMParser = class extends dom.DOMParser {
    constructor() { super({ onError: () => { throw new Error('Invalid vault XML.'); } }); }
  };
  globalThis.XMLSerializer = dom.XMLSerializer;
}

const MAX_VAULT_BYTES = 16 * 1024 * 1024;
kdbx.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type, version) => {
  if (version !== 0x13 || ![0, 2].includes(type)) throw new Error('This vault uses an unsupported Argon2 variant.');
  if (memory > 262144 || iterations > 50 || parallelism > 16) throw new Error('Vault encryption settings exceed this app’s safe resource limits.');
  const hash = type === 2 ? argon2id : argon2d;
  return hash({ password: new Uint8Array(password), salt: new Uint8Array(salt), memorySize: memory,
    iterations, hashLength: length, parallelism, outputType: 'binary' });
});

function textField(entry, name) {
  const v = entry.fields.get(name);
  return v instanceof kdbx.ProtectedValue ? v.getText() : (v || '');
}
function allEntries(db, includeTrash = false) {
  const out = [];
  const visit = g => {
    if (!includeTrash && db.meta.recycleBinUuid && g.uuid.equals(db.meta.recycleBinUuid)) return;
    out.push(...g.entries); g.groups.forEach(visit);
  };
  db.groups.forEach(visit); return out;
}
function sameEntry(a, b) {
  const keys = new Set([...a.fields.keys(), ...b.fields.keys()]);
  for (const key of keys) if (textField(a, key) !== textField(b, key)) return false;
  return JSON.stringify(a.tags || []) === JSON.stringify(b.tags || []);
}
function versionExists(entry, other) {
  return entry.history.some(h => sameEntry(h, other));
}
function tick(entry) {
  const old = entry.times.lastModTime ? entry.times.lastModTime.getTime() : 0;
  entry.times.lastModTime = new Date(Math.max(Math.floor(Date.now() / 1000) * 1000, Math.floor(old / 1000) * 1000 + 1000));
  entry.times.lastAccessTime = entry.times.lastModTime;
}
function validateBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_VAULT_BYTES || bytes.length < 32)
    throw new Error('Choose a KeePass .kdbx vault smaller than 16 MB.');
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (d.getUint32(0, true) !== 0x9aa2d903 || d.getUint32(4, true) !== 0xb54bfb67)
    throw new Error('This file is not a KeePass 2 vault.');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

class Vault {
  constructor(persist) { this.persist = persist; this.db = null; this.saved = null; this.revision = null; }
  async create(password, name = 'My vault') {
    if (typeof password !== 'string' || password.length < 12) throw new Error('Use at least 12 characters for your master password. A long passphrase works well.');
    this.db = kdbx.Kdbx.create(new kdbx.Credentials(kdbx.ProtectedValue.fromString(password)), String(name).slice(0, 100) || 'My vault');
    this.db.setVersion(4); this.db.setKdf(kdbx.Consts.KdfId.Argon2id);
    const p = this.db.header.kdfParameters;
    p.set('M', kdbx.VarDictionary.ValueType.UInt64, kdbx.Int64.from(64 * 1024 * 1024));
    p.set('I', kdbx.VarDictionary.ValueType.UInt64, kdbx.Int64.from(3));
    p.set('P', kdbx.VarDictionary.ValueType.UInt32, 1);
    this.db.meta.historyMaxItems = -1; this.db.meta.historyMaxSize = -1;
    try { await this.save(); } catch (e) { this.lock(); throw e; }
  }
  async open(bytes, password, revision = null) {
    const next = await kdbx.Kdbx.load(validateBytes(bytes), new kdbx.Credentials(kdbx.ProtectedValue.fromString(password)));
    this.lock(); this.db = next; this.saved = bytes.slice(); this.revision = revision;
  }
  get name() { return this.db?.meta.name || 'My vault'; }
  get unlocked() { return !!this.db; }
  requireUnlocked() { if (!this.db) throw new Error('Unlock your vault first.'); }
  list() {
    this.requireUnlocked();
    return allEntries(this.db).map(e => ({ id: e.uuid.id, title: textField(e, 'Title'), username: textField(e, 'UserName'),
      url: textField(e, 'URL'), category: (e.tags || [])[0] || 'General', modified: e.times.lastModTime?.toISOString(), history: e.history.length }));
  }
  find(id) { this.requireUnlocked(); const e = allEntries(this.db).find(e => e.uuid.id === id); if (!e) throw new Error('Entry no longer exists.'); return e; }
  details(id, historyIndex) {
    let e = this.find(id);
    if (historyIndex !== undefined) { e = e.history[historyIndex]; if (!e) throw new Error('That version is no longer available.'); }
    return { id, title: textField(e, 'Title'), username: textField(e, 'UserName'), password: textField(e, 'Password'),
      url: textField(e, 'URL'), notes: textField(e, 'Notes'), category: (e.tags || [])[0] || 'General', modified: e.times.lastModTime?.toISOString() };
  }
  async transaction(action) {
    this.requireUnlocked(); const credentials = this.db.credentials;
    try { const result = await action(); await this.save(); return result; }
    catch (error) {
      if (this.saved) this.db = await kdbx.Kdbx.load(validateBytes(this.saved), credentials);
      throw error;
    }
  }
  async upsert(data, id) {
    if (!data.title?.trim()) throw new Error('Give this entry a name.');
    if (Object.values(data).some(v => typeof v !== 'string' || v.length > 65536)) throw new Error('An entry field is too large.');
    return this.transaction(() => {
      const e = id ? this.find(id) : this.db.createEntry(this.db.getDefaultGroup());
      if (id) e.pushHistory();
      e.fields.set('Title', data.title.trim()); e.fields.set('UserName', data.username || '');
      e.fields.set('Password', kdbx.ProtectedValue.fromString(data.password || ''));
      e.fields.set('URL', data.url || ''); e.fields.set('Notes', kdbx.ProtectedValue.fromString(data.notes || ''));
      e.tags = [data.category?.trim() || 'General']; tick(e); return e.uuid.id;
    });
  }
  async remove(id) { return this.transaction(() => {
    const e = this.find(id), oldLocation = e.times.locationChanged?.getTime() || 0;
    this.db.remove(e);
    e.times.locationChanged = new Date(Math.max(Math.floor(Date.now()/1000)*1000, Math.floor(oldLocation/1000)*1000+1000));
  }); }
  history(id) { return this.find(id).history.map((e, i) => ({ index: i, modified: e.times.lastModTime?.toISOString(), title: textField(e, 'Title') })).reverse(); }
  async restore(id, index) { const data = this.details(id, index); delete data.id; delete data.modified; return this.upsert(data, id); }
  async merge(bytes) {
    this.requireUnlocked();
    const remote = await kdbx.Kdbx.load(validateBytes(bytes), this.db.credentials);
    if (!this.db.getDefaultGroup().uuid.equals(remote.getDefaultGroup().uuid))
      throw new Error('These are different vaults. Export and import the same vault onto both devices before syncing.');
    let conflicts = 0;
    await this.transaction(() => {
      const locals = new Map(allEntries(this.db).map(e => [e.uuid.id, e]));
      for (const r of allEntries(remote)) {
        const l = locals.get(r.uuid.id);
        if (!l || sameEntry(l, r)) continue;
        const concurrent = !versionExists(l, r) && !versionExists(r, l);
        if (concurrent) conflicts++;
        // KDBX dates have second precision. Retain both versions even for equal-time edits.
        if (l.times.lastModTime.getTime() === r.times.lastModTime.getTime()) {
          l.pushHistory();
          // A deterministic tie breaker is unnecessary for this PC-centred sync; the returned file becomes authoritative.
          tick(r);
        }
      }
      this.db.merge(remote);
      // Do not prune password histories on sync. Encrypted backup rotation is separate.
      this.db.meta.historyMaxItems = -1; this.db.meta.historyMaxSize = -1;
    });
    return conflicts;
  }
  async save() {
    this.requireUnlocked(); const bytes = new Uint8Array(await this.db.save());
    if (bytes.length > MAX_VAULT_BYTES) throw new Error('Vault exceeds the 16 MB limit.');
    const result = await this.persist(bytes, this.revision);
    this.saved = bytes.slice(); this.revision = result?.revision ?? null;
    return bytes;
  }
  export() { this.requireUnlocked(); return this.saved.slice(); }
  lock() {
    if (this.db) {
      for (const entry of allEntries(this.db, true)) for (const version of [entry, ...entry.history])
        for (const v of version.fields.values()) if (v instanceof kdbx.ProtectedValue) { v.value.fill(0); v.salt.fill(0); }
      for (const v of [this.db.credentials.passwordHash, this.db.credentials.keyFileHash]) if (v) { v.value.fill(0); v.salt.fill(0); }
    }
    this.db = null; this.saved = null; this.revision = null;
  }
}

function randomPassword(length = 24, options = {}) {
  length = Math.max(12, Math.min(128, Number(length) || 24));
  const pools = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789'];
  if (options.symbols !== false) pools.push('!@#$%^&*()-_=+[]{}?');
  const alphabet = pools.join(''); const random = n => {
    const a = new Uint8Array(1); const limit = 256 - 256 % n;
    do { globalThis.crypto.getRandomValues(a); } while (a[0] >= limit);
    return a[0] % n;
  };
  const out = pools.map(p => p[random(p.length)]);
  while (out.length < length) out.push(alphabet[random(alphabet.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = random(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}
function toBase64(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 16384) s += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(s);
}
function fromBase64(s) {
  if (typeof s !== 'string' || s.length > Math.ceil(MAX_VAULT_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('Invalid vault data.');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
module.exports = { Vault, randomPassword, toBase64, fromBase64, validateBytes, MAX_VAULT_BYTES, kdbx };
