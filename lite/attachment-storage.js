(() => {
  const DB_NAME = "mine-management-lite-attachments-v1";
  const STORE_NAME = "attachments";
  const MAX_BYTES = 10 * 1024 * 1024;

  function openDB() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("当前浏览器不支持 IndexedDB 附件存储，请使用最新版浏览器。"));
    return new Promise((resolve,reject) => {
      const request = indexedDB.open(DB_NAME,1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME,{keyPath:"id"});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开浏览器附件存储"));
      request.onblocked = () => reject(new Error("附件存储正在升级，请关闭其他系统页面后重试。"));
    });
  }

  function putRecord(db,record) {
    return new Promise((resolve,reject) => {
      const transaction = db.transaction(STORE_NAME,"readwrite");
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("附件保存失败"));
      transaction.onabort = () => reject(transaction.error || new Error("附件保存已取消"));
    });
  }

  async function save(file) {
    if (!file) return null;
    if (file.size > MAX_BYTES) throw new Error("附件“" + file.name + "”超过 10 MB，请压缩后再提交。");
    const db = await openDB();
    const id = "file-" + crypto.randomUUID();
    await putRecord(db,{id,name:file.name,type:file.type || "application/octet-stream",size:file.size,blob:file});
    db.close();
    return {id,name:file.name,type:file.type || "application/octet-stream",size:file.size,storage:"indexeddb"};
  }

  async function remove(id) {
    if (!id) return;
    const db = await openDB();
    await new Promise((resolve,reject) => {
      const transaction = db.transaction(STORE_NAME,"readwrite");
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("清理附件失败"));
      transaction.onabort = () => reject(transaction.error || new Error("清理附件已取消"));
    });
    db.close();
  }

  async function migrateRecords(recordsKey) {
    let records;
    try { records = JSON.parse(localStorage.getItem(recordsKey) || "{}"); } catch { records = {}; }
    records.people = Array.isArray(records.people) ? records.people : [];
    records.vehicles = Array.isArray(records.vehicles) ? records.vehicles : [];
    records.supplies = Array.isArray(records.supplies) ? records.supplies : [];
    const legacy = [];
    records.people.forEach(person => {
      Object.entries(person.attachments || {}).forEach(([field,attachment]) => {
        if (attachment && attachment.data && !attachment.id) legacy.push({person,field,attachment});
      });
    });
    if (!legacy.length) return records;

    const db = await openDB();
    try {
      for (const item of legacy) {
        const blob = await (await fetch(item.attachment.data)).blob();
        if (blob.size > MAX_BYTES) continue;
        const id = "legacy-" + String(item.person.id) + "-" + item.field;
        await putRecord(db,{id,name:item.attachment.name || item.field,type:item.attachment.type || blob.type || "application/octet-stream",size:blob.size,blob});
        item.person.attachments[item.field] = {id,name:item.attachment.name || item.field,type:item.attachment.type || blob.type || "application/octet-stream",size:blob.size,storage:"indexeddb"};
      }
      localStorage.setItem(recordsKey,JSON.stringify(records));
      return records;
    } finally {
      db.close();
    }
  }

  window.MineAttachmentStore = {MAX_BYTES,save,remove,migrateRecords};
})();
