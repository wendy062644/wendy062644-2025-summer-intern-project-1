(() => {
  // ====== 基本地圖 ======
  const map = L.map('map', { zoomControl: true }).setView([23.7, 121], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  const cluster = L.markerClusterGroup();
  map.addLayer(cluster);

  // 內部狀態（最小）
  const state = {
    photos: [],           // {id, type: 'photo'|'photo360'|'video', src(dataURL), title, lat,lng, width,height, yaw,pitch}
    markers: new Map(),   // id -> { marker, viewer? }
  };

  // ====== 小工具 ======
  const uid = () => 'ph_' + Math.random().toString(36).slice(2, 9);
  const escapeHtml = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isPanoramaBySize = (w,h) => w>0 && h>0 && Math.abs((w/h)-2) < 0.02;

  function divIcon(content){
    return L.divIcon({ html:`<div class="marker-icon">${content}</div>`, className:'', iconSize:[34,34], iconAnchor:[17,17] });
  }

  function buildPopupHtml(ph){
    const is360 = ph.type === 'photo360';
    const isVideo = ph.type === 'video';
    const title = escapeHtml(ph.title || ph.name || '');
    const media = is360
      ? `<div id="pnl_${ph.id}" style="width:360px;height:220px"></div>`
      : (isVideo
          ? `<video src="${ph.src}" controls playsinline style="max-width:320px;max-height:240px;border-radius:8px"></video>`
          : `<img src="${ph.src}" style="max-width:320px;max-height:240px;border-radius:8px">`);
    return `<div style="min-width:340px"><div style="font-weight:700">${title}</div>${media}</div>`;
  }

  function upsertMarker(ph){
    // 先移除舊的
    const old = state.markers.get(ph.id);
    if (old){
      cluster.removeLayer(old.marker);
      // 關掉 pannellum
      if (old.viewer){ try{ old.viewer.destroy(); }catch{} }
    }
    if (ph.lat==null || ph.lng==null) { state.markers.delete(ph.id); return; }

    const icon = ph.type==='photo360' ? divIcon('360°') : (ph.type==='video' ? divIcon('🎬') : divIcon('📷'));
    const marker = L.marker([ph.lat, ph.lng], { icon });
    marker.bindPopup(buildPopupHtml(ph));
    marker.on('popupopen', () => {
      if (ph.type==='photo360'){
        const el = document.getElementById('pnl_'+ph.id);
        if (el){
          const viewer = pannellum.viewer(el, {
            type:'equirectangular', panorama: ph.src,
            autoLoad:true, yaw: ph.yaw||0, pitch: ph.pitch||0, hfov:75
          });
          const slot = state.markers.get(ph.id); if (slot) slot.viewer = viewer;
        }
      }
    });
    marker.on('popupclose', () => {
      const slot = state.markers.get(ph.id);
      if (slot?.viewer){ try{ slot.viewer.destroy(); }catch{} slot.viewer = null; }
    });

    cluster.addLayer(marker);
    state.markers.set(ph.id, { marker, viewer: null });
  }

  async function addPhotoFromDataURL(name, dataUrl, { lat=null, lng=null, title='' , yaw=0, pitch=0 } = {}){
    // 量測寬高以判定 360
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    });
    const is360 = isPanoramaBySize(img.naturalWidth, img.naturalHeight);
    const ph = {
      id: uid(),
      name: name || 'image.jpg',
      type: is360 ? 'photo360' : 'photo',
      src: dataUrl,
      width: img.naturalWidth, height: img.naturalHeight,
      lat, lng, yaw, pitch,
      title: title || (name ? name.replace(/\.[^.]+$/, '') : 'Photo')
    };
    state.photos.push(ph);
    upsertMarker(ph);
  }

  async function addVideoFromDataURL(name, dataUrl, { lat=null, lng=null, title='' } = {}){
    const ph = {
      id: uid(),
      name: name || 'video.mp4',
      type: 'video',
      src: dataUrl,
      width: 0, height: 0,  // 不特別量測
      lat, lng, yaw:0, pitch:0,
      title: title || (name ? name.replace(/\.[^.]+$/, '') : 'Video')
    };
    state.photos.push(ph);
    upsertMarker(ph);
  }

  // ====== KMZ 解析（支援 query 參數與本地檔） ======
  async function loadKmzFromArrayBuffer(ab){
    const zip = await JSZip.loadAsync(ab);
    // 取 KML（優先 doc.kml）
    const entries = Object.values(zip.files).filter(f=>!f.dir);
    const kmlEntry = entries.find(e => /(?:^|\/)doc\.kml$/i.test(e.name))
      || entries.find(e => /\.kml$/i.test(e.name));
    if (!kmlEntry) throw new Error('KMZ 內找不到 .kml');

    const kmlText = await kmlEntry.async('text');

    // 建立檔案映射（含圖片/影片）
    const fileMap = new Map();
    for (const ent of entries){
      if (/\.(jpe?g|png|gif|webp|bmp|tiff?|mp4|mov|m4v|webm)$/i.test(ent.name)){
        const base64 = await ent.async('base64');
        const mime = guessMimeByExt(ent.name);
        fileMap.set(normPath(ent.name), {
          name: ent.name,
          dataUrl: `data:${mime};base64,${base64}`
        });
      }
    }

    // 解析 KML DOM
    const dom = new DOMParser().parseFromString(kmlText, 'text/xml');
    await importPhotosFromKmlDom(dom, fileMap);
    fitToAllMarkers();
  }

  async function loadKmzFromUrl(url){
    const ab = await (await fetch(url)).arrayBuffer();
    await loadKmzFromArrayBuffer(ab);
  }

  function normPath(p=''){
    return decodeURIComponent(String(p).replace(/\\/g,'/').replace(/^\.\//,'').replace(/\/{2,}/g,'/')).toLowerCase();
  }
  function guessMimeByExt(name=''){
    const ext = (name.split('.').pop()||'').toLowerCase();
    return ({
      jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', bmp:'image/bmp', tif:'image/tiff', tiff:'image/tiff',
      mp4:'video/mp4', m4v:'video/mp4', mov:'video/quicktime', webm:'video/webm'
    })[ext] || 'application/octet-stream';
  }
  function findKmzAsset(href='', fileMap){
    const p = normPath(href);
    if (fileMap.has(p)) return fileMap.get(p);
    const justName = p.split('/').pop();
    for (const [k,v] of fileMap.entries()){
      if (k.endsWith('/'+justName) || k===justName) return v;
    }
    if (p.startsWith('./') && fileMap.has(p.slice(2))) return fileMap.get(p.slice(2));
    return null;
  }

  async function importPhotosFromKmlDom(dom, fileMap){
    const getText = (node, sel) => (node.querySelector(sel)?.textContent || '').trim();

    // 1) PhotoOverlay（含 gx:PhotoOverlay）
    for (const po of dom.querySelectorAll('PhotoOverlay, gx\\:PhotoOverlay')){
      const name = getText(po,'name');
      const desc = getText(po,'description'); // 可不使用
      const href = getText(po,'Icon > href');
      const coords = getText(po,'Point > coordinates'); // "lng,lat[,alt]"
      if (!href || !coords) continue;

      const asset = findKmzAsset(href, fileMap);
      if (!asset) continue;

      const [lng, lat] = coords.split(',').map(Number);
      const heading = parseFloat(getText(po,'Camera > heading'));
      const tilt    = parseFloat(getText(po,'Camera > tilt'));

      if (/^data:video\//.test(asset.dataUrl) || /\.(mp4|mov|m4v|webm)$/i.test(asset.name)){
        await addVideoFromDataURL(asset.name, asset.dataUrl, { lat, lng, title: name || '' });
      } else {
        await addPhotoFromDataURL(asset.name, asset.dataUrl, {
          lat, lng, title: name || '', yaw: Number.isFinite(heading)?heading:0, pitch: Number.isFinite(tilt)?tilt:0
        });
      }
    }

    // 2) Placemark：從 <description> 找 <img> 或 影片連結
    const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|tiff?)(?:\?.*)?$/i;
    for (const pm of dom.querySelectorAll('Placemark')){
      const coords = getText(pm,'Point > coordinates');
      if (!coords) continue;
      const [lng, lat] = coords.split(',').map(Number);
      const name = getText(pm,'name');
      const d = pm.querySelector('description');
      if (!d) continue;

      // 取 description 內 HTML（含 CDATA）
      let descHtml = '';
      const cdata = Array.from(d.childNodes).find(n => n.nodeType===4);
      if (cdata && cdata.nodeValue) descHtml = cdata.nodeValue.trim();
      else descHtml = (d.textContent||'').trim();

      if (!descHtml) continue;
      const doc = new DOMParser().parseFromString(descHtml, 'text/html');

      // 先找影片
      const videoEl = doc.querySelector('video[src], a[href$=".mp4" i], a[href$=".mov" i], a[href$=".m4v" i], a[href$=".webm" i]');
      if (videoEl){
        const href = videoEl.getAttribute('src') || videoEl.getAttribute('href') || '';
        const asset = findKmzAsset(href, fileMap);
        if (asset){
          await addVideoFromDataURL(asset.name, asset.dataUrl, { lat, lng, title: name || '' });
          continue;
        }
      }

      // 再找圖片
      let imgHref = (doc.querySelector('img[src]')?.getAttribute('src')) || '';
      if (!imgHref){
        const aImg = Array.from(doc.querySelectorAll('a[href]')).find(a => IMAGE_EXT_RE.test(a.getAttribute('href') || ''));
        if (aImg) imgHref = aImg.getAttribute('href') || '';
      }
      if (!imgHref) continue;

      const img = findKmzAsset(imgHref, fileMap);
      if (!img) continue;

      await addPhotoFromDataURL(img.name, img.dataUrl, { lat, lng, title: name || '' });
    }
  }

  function fitToAllMarkers(){
    if (!state.markers.size) return;
    const bounds = cluster.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.2));
  }

  // ====== UI：本地 KMZ 載入 + 拖放 ======
  const SimpleBar = L.Control.extend({
    options: { position: 'topleft' },
    onAdd(){
      const div = L.DomUtil.create('div', 'leaflet-bar simplebar');
      div.innerHTML = `<a href="#" title="載入 KMZ">＋</a>`;
      const [btnLoad] = div.querySelectorAll('a');

      btnLoad.addEventListener('click', (e) => {
        e.preventDefault();
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.kmz'; inp.multiple = false;
        inp.addEventListener('change', async ev => {
          const f = ev.target.files?.[0]; if (!f) return;
          try {
            const ab = await f.arrayBuffer();
            await loadKmzFromArrayBuffer(ab);
          } catch(err){ alert('KMZ 讀取失敗：'+(err?.message||err)); }
        });
        inp.click();
      });

      L.DomEvent.disableClickPropagation(div);
      return div;
    }
  });
  L.control.simpleBar = (opts)=> new SimpleBar(opts);
  L.control.simpleBar().addTo(map);

  // 拖放 .kmz 到地圖
  const mc = map.getContainer();
  mc.addEventListener('dragover', e => { e.preventDefault(); });
  mc.addEventListener('drop', async e => {
    e.preventDefault();
    const f = [...e.dataTransfer.files].find(x => /\.kmz$/i.test(x.name));
    if (!f) return;
    try{
      const ab = await f.arrayBuffer();
      await loadKmzFromArrayBuffer(ab);
    }catch(err){ alert('KMZ 讀取失敗：'+(err?.message||err)); }
  });

  // ====== 啟動：支援 query 參數 ?kmzbase=../example/&kmz=example.kmz ======
  (async function bootFromQuery(){
    const sp = new URLSearchParams(location.search);
    const kmz = sp.get('kmz');
    const base = sp.get('kmzbase');
    if (!kmz) return;
    try {
      // 若有 base，以 base 為相對根；否則用目前頁面為根
      const baseUrl = base ? new URL(base, location.href) : new URL('.', location.href);
      const kmzUrl  = new URL(kmz, baseUrl).toString();
      await loadKmzFromUrl(kmzUrl);
    } catch (err){
      console.error(err);
      alert('讀取 KMZ 失敗：' + (err?.message || err));
    }
  })();

})();
