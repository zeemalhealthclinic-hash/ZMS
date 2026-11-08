import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync('index.html', 'utf8');
function extractFunction(name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const match = re.exec(html);
  assert.ok(match, 'missing production function ' + name);
  let depth = 1, i = match.index + match[0].length;
  for (; i < html.length && depth; i++) {
    const ch = html[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  assert.equal(depth, 0, 'unterminated function ' + name);
  return html.slice(match.index, i);
}

const readinessCode = extractFunction('markServerSnapshot');
const canWriteCode = extractFunction('canWrite');
const cloudPushCode = extractFunction('cloudPush');

const state = { serverSnapshotReady: false, cacheEvents: 0, serverEvents: 0 };
const fakeFirestore = {
  listener: null,
  onSnapshot(options, next) {
    assert.equal(options && options.includeMetadataChanges, true);
    this.listener = next;
    return () => {};
  },
  emit(snapshot) { this.listener(snapshot); }
};
const context = vm.createContext({
  console,
  navigator: { onLine: true },
  message() {},
  setSync() {},
});
vm.runInContext(`
  const CLOUD = true;
  let serverSnapshotReady = false;
  let cloudReady = false;
  let fbUser = { uid: 'test-user' };
  let fbDb = {};
  let serverMedsCount = null;
  let db = { meds: [], sales: [], customers: [], payments: [] };
  let docCache = {};
  let activeStoreId = 'store1';
  let uploads = 0;
  const firebase = { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } };
  function buildDocs(){ return { main: JSON.stringify({meds:db.meds,customers:db.customers,settings:{}}) }; }
`, context);
vm.runInContext(readinessCode + '\n' + canWriteCode + '\n' + cloudPushCode, context);
context.fakeFirestore = fakeFirestore;
vm.runInContext(`
  const fakeListener = { onSnapshot: fakeFirestore.onSnapshot.bind(fakeFirestore) };
  fakeListener.onSnapshot({includeMetadataChanges:true}, snap => markServerSnapshot(snap));
`, context);

// Initial cache event must NOT unlock writes.
fakeFirestore.emit({ metadata: { fromCache: true }, docChanges: () => [] });
assert.equal(vm.runInContext('serverSnapshotReady', context), false);
assert.equal(vm.runInContext('canWrite()', context), false);
vm.runInContext('cloudReady = true; fbDb = {collection(){ uploads++; return {doc(){return {collection(){return {doc(){return {set(){uploads++}}}}}}}}}}; cloudPush();', context);
assert.equal(vm.runInContext('uploads', context), 0, 'cloudPush uploaded before a server snapshot');

// Metadata-only server event (no document changes) must unlock writes.
fakeFirestore.emit({ metadata: { fromCache: false }, docChanges: () => [] });
assert.equal(vm.runInContext('serverSnapshotReady', context), true);
assert.equal(vm.runInContext('canWrite()', context), true);

// The existing inventory safety lock must still block a large inventory drop.
vm.runInContext(`
  serverMedsCount = 20;
  db.meds = Array.from({length:9}, (_,i)=>({id:String(i)}));
  uploads = 0;
  fbDb = {collection(){ uploads++; return {doc(){return {collection(){return {doc(){return {set(){uploads++}}}}}}}}}};
  cloudPush();
`, context);
assert.equal(vm.runInContext('uploads', context), 0, 'inventory safety lock failed to block upload');

console.log('sync state tests OK: cache remains locked; metadata-only server snapshot unlocks; pre-server cloudPush blocked; inventory safety lock preserved');
