(() => {
  "use strict";
  const active = new Set();
  const imageName = /\.(png|jpe?g|gif|webp|bmp|avif|svg|heic|heif)$/i;
  function installStyle() {
    if (document.getElementById("attachmentPreviewStyle")) return;
    const style=document.createElement("style");
    style.id="attachmentPreviewStyle";
    style.textContent=".attachment-preview[hidden]{display:none!important}.attachment-preview{margin:10px 0 4px;padding:10px;border:1px solid #dce6df;border-radius:10px;background:#f8faf8;min-width:0}.attachment-preview img{display:block;width:auto;max-width:100%;max-height:180px;margin:0 auto;object-fit:contain;border-radius:7px}.attachment-preview a{color:#176b4a;font-size:12px;font-weight:700;overflow-wrap:anywhere}.attachment-preview-caption{margin-top:7px;color:#617268;font-size:11px;overflow-wrap:anywhere;white-space:pre-wrap}.attachment-preview-message{margin:4px 0 7px;color:#738078;font-size:12px}.attachment-preview-warning{color:#a34a21}";
    document.head.appendChild(style);
  }
  function mount(root,savedById={}) {
    if (!root) return {destroy(){}};
    installStyle();
    let disposed=false;
    const states=[];
    const form=root.matches("form") ? root : root.closest("form");
    for (const input of root.querySelectorAll('input[type="file"]')) {
      const preview=document.createElement("div");
      preview.className="attachment-preview";
      preview.hidden=true;
      preview.setAttribute("aria-live","polite");
      input.insertAdjacentElement("afterend",preview);
      const state={input,preview,url:null,version:0};
      function release() {
        if (state.url) URL.revokeObjectURL(state.url);
        state.url=null;
      }
      async function refresh() {
        const version=++state.version;
        release();
        preview.replaceChildren();
        const selected=input.files?.[0] || null;
        const saved=savedById[input.id] || null;
        const source=selected || saved;
        preview.hidden=!source;
        if (!source) return;
        const caption=document.createElement("div");
        caption.className="attachment-preview-caption";
        caption.textContent=(selected ? "未保存：" : "已保存：")+(source.name || "附件");
        const message=document.createElement("div");
        message.className="attachment-preview-message";
        message.textContent="正在读取预览…";
        preview.append(message,caption);
        let blob=selected;
        if (!blob) {
          try {
            if (saved.id) blob=(await window.MineAttachmentStore.get(saved.id))?.blob || null;
            else if (saved.data) blob=await (await fetch(saved.data)).blob();
          } catch {}
        }
        if (disposed || version!==state.version || !root.contains(input)) return;
        if (!blob) {
          message.textContent="附件无法读取，请重新选择文件。";
          message.classList.add("attachment-preview-warning");
          return;
        }
        const url=URL.createObjectURL(blob);
        state.url=url;
        const mime=String(blob.type || source.type || "");
        const isImage=mime.startsWith("image/") || imageName.test(source.name || "");
        const link=document.createElement("a");
        link.href=url;link.target="_blank";link.rel="noopener";
        if (isImage) {
          const image=document.createElement("img");
          image.alt=(source.name || "图片")+"预览";
          image.addEventListener("error",() => {
            if (disposed || version!==state.version) return;
            image.remove();
            message.textContent="此图片暂无法显示，可打开原文件查看。";
            message.classList.add("attachment-preview-warning");
          });
          image.src=url;
          link.appendChild(image);
          const label=document.createElement("span");
          label.textContent="查看原图";
          link.appendChild(label);
          message.textContent="";
        } else {
          message.textContent=mime==="application/pdf" || /\.pdf$/i.test(source.name || "") ? "PDF 附件" : "文件附件";
          link.textContent="打开附件";
        }
        preview.insertBefore(link,caption);
      }
      state.refresh=refresh;
      state.release=release;
      input.addEventListener("change",refresh);
      states.push(state);
      refresh();
    }
    const onReset=() => { queueMicrotask(() => { if (!disposed) states.forEach(state=>state.refresh()); }); };
    form?.addEventListener("reset",onReset);
    const controller={destroy() {
      if (disposed) return;
      disposed=true;
      for (const state of states) {
        state.version++;
        state.input.removeEventListener("change",state.refresh);
        state.release();
        state.preview.remove();
      }
      form?.removeEventListener("reset",onReset);
      active.delete(controller);
    }};
    active.add(controller);
    return controller;
  }
  window.addEventListener("pagehide",event => {
    if (!event.persisted) Array.from(active).forEach(controller=>controller.destroy());
  });
  window.MineAttachmentPreview={mount};
})();
