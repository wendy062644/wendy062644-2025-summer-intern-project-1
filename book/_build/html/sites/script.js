
let map;
(() => {
    /*** —— 全域狀態 —— ***/
    const state = {
        photos: [],         // Array<Photo>
        tracks: [],         // GPX/KML/GeoJSON features
        drawn: L.featureGroup(),
        selectedIds: new Set(),
        selectedOne: null,
        origOne: null,
        setCoordMode: false,
        cluster: null,
        markers: new Map(), // id => { marker, fov }
    };

    const el = (id) => document.getElementById(id);
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    /*** —— Leaflet 地圖初始化 —— ***/
    map = L.map('map', { zoomControl: true }).setView([23.7, 121], 7);

    const appEl = document.getElementById('app');
    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.getElementById('sidebar');
    const splitter = document.getElementById('splitter');

    // 取 CSS 變數 --sidebar-w（或以實際寬度為準）
    function getSidebarWidthPx() {
        const cssVar = getComputedStyle(document.documentElement)
            .getPropertyValue('--sidebar-w').trim() || '360px';
        const probe = document.createElement('div');
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        probe.style.width = cssVar;
        document.body.appendChild(probe);
        const w = probe.getBoundingClientRect().width;
        probe.remove();
        return w || (sidebar?.offsetWidth || 390);
    }

    function positionToggleBtn(collapsed) {
        const splitW = splitter ? splitter.getBoundingClientRect().width : 6;
        if (collapsed) {
            toggleBtn.style.left = '10px';
            toggleBtn.style.right = 'auto';
        } else {
            const left = getSidebarWidthPx() + splitW + 25;
            toggleBtn.style.left = left + 'px';
            toggleBtn.style.right = 'auto';
        }
    }

    function relayoutMap() {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => map.invalidateSize());
        });
    }

    const initCollapsed = localStorage.getItem('sidebarCollapsed') === '1';
    appEl.classList.toggle('collapsed', initCollapsed);
    toggleBtn.textContent = initCollapsed ? '顯示' : '收合';
    positionToggleBtn(initCollapsed);
    relayoutMap();

    toggleBtn.addEventListener('click', () => {
        const next = !appEl.classList.contains('collapsed');
        appEl.classList.toggle('collapsed', next);
        toggleBtn.textContent = next ? '顯示' : '收合';
        positionToggleBtn(next);
        relayoutMap();
        localStorage.setItem('sidebarCollapsed', next ? '1' : '0');
    });

    new ResizeObserver(() => {
        positionToggleBtn(appEl.classList.contains('collapsed'));
        relayoutMap();
    }).observe(appEl);

    const baseLayers = {
        'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }),
        '衛星（Esri）': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' }),
        '地形（Stadia）': L.tileLayer('https://tiles.stadiamaps.com/tiles/outdoors/{z}/{x}/{y}{r}.png', { maxZoom: 20, attribution: '&copy; Stadia Maps' })
    };
    baseLayers['OpenStreetMap'].addTo(map);
    state.cluster = L.markerClusterGroup();
    map.addLayer(state.cluster);
    state.drawn.addTo(map);
    L.control.layers(baseLayers, { '相片群聚': state.cluster, '我的標註/路徑': state.drawn }).addTo(map);

    // 繪圖控制
    const drawControl = new L.Control.Draw({
        edit: { featureGroup: state.drawn },
        draw: {
            polygon: true,
            polyline: true,
            rectangle: false,
            circle: false,
            circlemarker: false,
            marker: true,
        }
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, (e) => {
        const layer = e.layer;
        state.drawn.addLayer(layer);
        const name = prompt('名稱/說明（可留空）：') || '';
        layer.bindPopup(`<b>${name || '未命名'}</b>`);
        layer.feature = layer.feature || { type: 'Feature', properties: {} };
        layer.feature.properties.name = name;

        const o = layer.options || {};
        layer.feature.properties.style = {
            color: o.color || '#4da3ff',
            weight: o.weight || 2,
            fillColor: o.fillColor || '#4da3ff',
            fillOpacity: (o.fillOpacity != null) ? o.fillOpacity : 0.15
        };
    });

    /*** —— 工具函式 —— ***/
    function normPath(p = '') {
        return decodeURIComponent(String(p).replace(/\\/g, '/').replace(/^\.\//, '')).toLowerCase();
    }
    function guessMimeByExt(name = '') {
        const ext = (name.split('.').pop() || '').toLowerCase();
        return ({
            jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
            webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff'
        })[ext]
            || 'application/octet-stream';
    }
    async function extractKmz(file) {
        const ab = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(ab);
        const entries = Object.values(zip.files).filter(f => !f.dir);

        const kmlEntry = entries.find(e => /(?:^|\/)doc\.kml$/i.test(e.name))
            || entries.find(e => e.name.toLowerCase().endsWith('.kml'));
        if (!kmlEntry) throw new Error('KMZ 內找不到 .kml');

        const kmlText = await kmlEntry.async('text');

        const fileMap = new Map();
        for (const ent of entries) {
            if (/\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(ent.name)) {
                const base64 = await ent.async('base64');
                const mime = guessMimeByExt(ent.name);
                fileMap.set(normPath(ent.name), { name: ent.name, dataUrl: `data:${mime};base64,${base64}` });
            }
        }
        return { kmlText, fileMap };
    }
    function findKmzImage(href = '', fileMap) {
        const p = normPath(href);
        if (fileMap.has(p)) return fileMap.get(p);
        const justName = p.split('/').pop();
        for (const [k, v] of fileMap.entries()) {
            if (k.endsWith('/' + justName) || k === justName) return v;
        }
        return null;
    }

    const uid = () => 'ph_' + Math.random().toString(36).slice(2, 9);
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const deg2rad = d => d * Math.PI / 180;
    const rad2deg = r => r * 180 / Math.PI;
    const fmt = (n, p = 5) => (typeof n === 'number' ? n.toFixed(p) : '');

    function isPanoramaBySize(w, h) { return w > 0 && h > 0 && Math.abs((w / h) - 2) < 0.02; }

    function dataURLFromFile(file) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(file);
        });
    }

    async function imageBitmapFromBlob(blob) {
        try { return await createImageBitmap(blob); }
        catch (e) {
            return new Promise((res) => {
                const img = new Image();
                img.onload = () => res(img);
                img.src = URL.createObjectURL(blob);
            });
        }
    }

    async function makeThumbnail(blob, maxSide) {
        const bmp = await imageBitmapFromBlob(blob);
        const w = bmp.width, h = bmp.height;
        const scale = (maxSide / Math.max(w, h));
        const tw = Math.round(w * scale), th = Math.round(h * scale);
        const cvs = document.createElement('canvas');
        cvs.width = tw; cvs.height = th;
        const ctx = cvs.getContext('2d');
        ctx.drawImage(bmp, 0, 0, tw, th);
        const url = cvs.toDataURL('image/jpeg', 0.85);
        return { url, width: tw, height: th };
    }

    // 讀 HEIF/AVIF ftyp box
    async function sniffHeifBrands(file) {
        const head = await file.slice(0, 4096).arrayBuffer();
        const v = new DataView(head);
        let pos = 0;
        while (pos + 8 <= v.byteLength) {
            const size = v.getUint32(pos);
            const type = String.fromCharCode(v.getUint8(pos + 4), v.getUint8(pos + 5), v.getUint8(pos + 6), v.getUint8(pos + 7));
            if (type === 'ftyp') {
                const major = String.fromCharCode(v.getUint8(pos + 8), v.getUint8(pos + 9), v.getUint8(pos + 10), v.getUint8(pos + 11));
                const compatibles = [];
                for (let off = pos + 16; off + 4 <= pos + size && off + 4 <= v.byteLength; off += 4) {
                    const s = String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
                    compatibles.push(s);
                }
                return { brand: major, compatible: compatibles };
            }
            if (!size) break;
            pos += size;
        }
        return { brand: null, compatible: [] };
    }

    function dataUrlToJpegFile(dataUrl, origName) {
        const bin = atob(dataUrl.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new File([arr], (origName || 'image').replace(/\.(heic|heif)$/i, '') + '.jpg', { type: 'image/jpeg' });
    }

    async function heicToJpegWithLibheif(file, maxSide = 2048, quality = 0.9) {
        const decoder = await getHeifDecoder();
        const buf = new Uint8Array(await file.arrayBuffer());
        const images = decoder.decode(buf);
        if (!images || !images.length) throw new Error('HEIF decode: no images');
        const image = images[0];

        const width = image.get_width();
        const height = image.get_height();

        const c1 = document.createElement('canvas');
        c1.width = width; c1.height = height;
        const ctx1 = c1.getContext('2d');
        const id = ctx1.createImageData(width, height);

        await new Promise((resolve, reject) => {
            image.display(id, (ok) => ok ? resolve() : reject(new Error('HEIF processing error')));
        });
        ctx1.putImageData(id, 0, 0);

        const scale = Math.min(1, maxSide / Math.max(width, height));
        const w = Math.round(width * scale), h = Math.round(height * scale);
        const c2 = document.createElement('canvas');
        c2.width = w; c2.height = h;
        c2.getContext('2d').drawImage(c1, 0, 0, w, h);

        return dataUrlToJpegFile(c2.toDataURL('image/jpeg', quality), file.name);
    }

    async function getHeifDecoder() {
        if (!window.libheif) throw new Error('libheif-js 未載入');
        if (libheif.ready?.then) {
            await libheif.ready;
        } else if (!libheif.HeifDecoder) {
            await new Promise((resolve) => {
                const t = setInterval(() => {
                    if (libheif.HeifDecoder) { clearInterval(t); resolve(); }
                }, 10);
            });
        }
        if (!libheif.HeifDecoder) throw new Error('libheif-js 尚未就緒（HeifDecoder 不可用）');
        return new libheif.HeifDecoder();
    }

    async function convertHeicIfNeeded(file) {
        if (el('heicToggle').value !== 'on') return file;

        const name = file.name || '';
        const ext = (name.split('.').pop() || '').toLowerCase();
        if (ext !== 'heic' && ext !== 'heif') return file;

        const { brand, compatible } = await sniffHeifBrands(file);
        const compatStr = [brand, ...compatible].filter(Boolean).join(',');
        const isAvif = /avif|avis/i.test(compatStr);
        const isTmap = /(?:^|,)tmap(?:,|$)/i.test(compatStr);

        if (isAvif) {
            try {
                const bmp = await createImageBitmap(file);
                const MAX = 2048;
                const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
                const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
                const c = document.createElement('canvas'); c.width = w; c.height = h;
                c.getContext('2d').drawImage(bmp, 0, 0, w, h);
                return dataUrlToJpegFile(c.toDataURL('image/jpeg', 0.9), name);
            } catch { /* fallthrough */ }
        }

        if (isTmap) {
            try { return await heicToJpegWithLibheif(file, 2048, 0.9); }
            catch (e) { console.warn('libheif-js for tmap failed', e); }
        }

        try {
            const objUrl = URL.createObjectURL(file);
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = reject;
                i.src = objUrl;
            });
            URL.revokeObjectURL(objUrl);

            const MAX = 2048;
            const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
            const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            return dataUrlToJpegFile(c.toDataURL('image/jpeg', 0.9), name);
        } catch {
            console.warn('原生 HEIC 解碼失敗');
        }

        try { return await heicToJpegWithLibheif(file, 2048, 0.9); }
        catch (e2) { console.warn('libheif-js 失敗，退回 heic2any', e2); }

        if (window.heic2any) {
            try {
                let out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.8, multiple: false });
                const blob = Array.isArray(out) ? out[0] : out;
                const bmp = await createImageBitmap(blob);
                const MAX = 2048;
                const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
                const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
                const c = document.createElement('canvas'); c.width = w; c.height = h;
                c.getContext('2d').drawImage(bmp, 0, 0, w, h);
                return dataUrlToJpegFile(c.toDataURL('image/jpeg', 0.9), name);
            } catch (err) {
                console.warn('heic2any 也失敗', err);
            }
        }

        throw new Error(
            `HEIC 轉檔失敗（brand: ${brand || '未知'}; compat: ${compatible.join('/') || '—'}）。` +
            ` 這可能是較新的 iOS 18 HEIC（含 tmap/10-bit/HDR）。` +
            ` 請在裝置上先匯出成 JPEG/PNG 後再上傳，或在「相機設定→格式」改 Most Compatible（JPEG）。`
        );
    }

    function bearingFOVPolygon(lat, lng, bearingDeg, fov = 60, distMeters = 60) {
        const R = 6378137;
        const ang = distMeters / R;
        const lat1 = deg2rad(lat), lon1 = deg2rad(lng);
        const b = deg2rad(bearingDeg);
        const half = deg2rad(fov / 2);
        const pts = [[lat, lng]];
        for (const a of [b - half, b, b + half]) {
            const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(a));
            const lon2 = lon1 + Math.atan2(Math.sin(a) * Math.sin(ang) * Math.cos(lat1), Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2));
            pts.push([rad2deg(lat2), rad2deg(lon2)]);
        }
        return L.polygon(pts, { color: '#4da3ff', weight: 1, fillOpacity: 0.15, opacity: 0.8 });
    }

    function divIcon(content, cls) {
        return L.divIcon({ html: `<div class="marker-icon ${cls}">${content}</div>`, className: '', iconSize: [34, 34], iconAnchor: [17, 17] });
    }

    function buildPopupHtml(ph) {
        const is360 = ph.type === 'photo360';
        const imgPart = is360 ? `<div id="pnl_${ph.id}" class="popup-360"></div>` : `<img class="popup-img" src="${ph.src}" alt="${ph.title || ph.name}">`;
        const meta = `<div class="sub">${ph.lat != null ? ('📍 ' + fmt(ph.lat, 5) + ', ' + fmt(ph.lng, 5)) : '無座標'} </div><div class="sub">${ph.capturedAt ? ('🕒 ' + new Date(ph.capturedAt).toLocaleString()) : '時間未知'}</div>`
        return `<div style="min-width:340px">
      <div style="display:flex;gap:8px;align-items:flex-start">
        <img src="${ph.thumbnail}" style="width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid #2a3868"/>
        <div style="flex:1">
          <div style="font-weight:700">${ph.title || ph.name}</div>
          ${meta}
          <div class="notice">${(ph.tags || []).map(t => `#${t}`).join(' ')}</div>
        </div>
      </div>
      <div class="divider"></div>
      ${imgPart}
    </div>`;
    }

    function updateStatus() {
        el('statusText').textContent = `${state.photos.length} 張相片 / ${state.drawn.getLayers().length} 個標註`;
    }

    function renderPhotoList() {
        const list = el('photoList');
        list.innerHTML = '';

        const q = (el('qText').value || '').toLowerCase().trim();
        const is360Sel = el('qIs360').value;
        const startDate = el('qStartDate').value ? new Date(el('qStartDate').value) : null;
        const endDate = el('qEndDate').value ? new Date(el('qEndDate').value) : null;

        const within = (ph) => {
            if (q) {
                const t = (ph.title || '') + ' ' + (ph.description || '') + ' ' + (ph.author || '') + ' ' + (ph.tags || []).join(',');
                if (!t.toLowerCase().includes(q)) return false;
            }
            if (is360Sel !== 'any') {
                const is360 = ph.type === 'photo360';
                if ((is360Sel === 'true' && !is360) || (is360Sel === 'false' && is360)) return false;
            }
            if (startDate || endDate) {
                const ts = ph.capturedAt ? new Date(ph.capturedAt) : null;
                if (!ts) return false;
                if (startDate && ts < startDate) return false;
                if (endDate) {
                    const end = new Date(endDate); end.setHours(23, 59, 59, 999);
                    if (ts > end) return false;
                }
            }
            return true;
        };

        state.photos.filter(within).forEach(ph => {
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
        <div class="thumb">${ph.thumbnail ? `<img src="${ph.thumbnail}" alt="thumb">` : '—'}</div>
        <div class="meta">
          <div class="flex" style="justify-content:space-between;align-items:center">
            <div class="title">${ph.title || ph.name}</div>
            <label class="flex" style="gap:6px;align-items:center;font-size:12px">
              <input type="checkbox" ${state.selectedIds.has(ph.id) ? 'checked' : ''} data-sel="${ph.id}"> 勾選
            </label>
          </div>
          <div class="sub">${ph.lat != null ? ('📍 ' + fmt(ph.lat, 5) + ', ' + fmt(ph.lng, 5)) : '無座標'} ｜ ${(ph.type === 'photo360') ? '360°' : '一般'} ｜ ${ph.width}×${ph.height}</div>
        </div>
        <div class="actions">
          <button class="icon-btn" data-toggle="${ph.id}" title="${ph.hidden ? '顯示在地圖' : '隱藏於地圖'}">
           ${ph.hidden ? '🙈' : '👁️'}
          </button>
          <button class="icon-btn" data-del="${ph.id}" title="刪除">🗑️</button>
        </div>`;

            card.addEventListener('click', (e) => {
                if (e.target && (e.target.matches('input[type="checkbox"]') || e.target.closest('.icon-btn'))) return;
                selectOne(ph.id);
            });
            list.appendChild(card);

            card.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
                if (e.target.checked) state.selectedIds.add(ph.id); else state.selectedIds.delete(ph.id);
            });

            const btnToggle = card.querySelector('[data-toggle]');
            if (btnToggle) btnToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                ph.hidden = !ph.hidden;     // 直接改這張的狀態
                upsertMarker(ph);           // 同步地圖
                renderPhotoList();          // 讓按鈕圖示/提示文字更新
            });

            const btnDel = card.querySelector('[data-del]');
            if (btnDel) btnDel.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!confirm('確定刪除這張相片？此動作無法復原。')) return;
                deletePhoto(ph.id);
                renderPhotoList();
            });
        });
    }

    function selectOne(id) {
        const ph = state.photos.find(p => p.id === id); if (!ph) return;
        state.selectedOne = JSON.parse(JSON.stringify(ph));
        state.origOne = JSON.parse(JSON.stringify(ph));
        el('dTitle').value = ph.title || '';
        el('dDesc').value = ph.description || '';
        el('dTags').value = (ph.tags || []).join(',');
        el('dAuthor').value = ph.author || '';
        el('dLicense').value = ph.license || '';
        el('dIs360').value = ph.type === 'photo360' ? 'true' : (ph.type === 'photo' ? 'false' : 'auto');
        el('dLatLng').value = (ph.lat != null && ph.lng != null) ? `${ph.lat},${ph.lng}` : '';
        el('dTime').value = ph.capturedAt ? new Date(ph.capturedAt).toISOString().slice(0, 16) : '';
        el('dBearing').value = (ph.bearing != null ? ph.bearing : '');
        el('dYawPitch').value = (ph.yaw != null || ph.pitch != null) ? `${ph.yaw || 0},${ph.pitch || 0}` : '';
        if (ph.lat != null) map.setView([ph.lat, ph.lng], Math.max(map.getZoom(), 15));
        updateDetailButtonsEnabled();
    }

    function saveDetail() {
        const id = state.selectedOne?.id; if (!id) return;
        const ph = state.photos.find(p => p.id === id); if (!ph) return;
        ph.title = el('dTitle').value.trim();
        ph.description = el('dDesc').value.trim();
        ph.tags = (el('dTags').value || '').split(',').map(s => s.trim()).filter(Boolean);
        ph.author = el('dAuthor').value.trim();
        ph.license = el('dLicense').value.trim();
        const is360Sel = el('dIs360').value;
        if (is360Sel === 'true') ph.type = 'photo360'; else if (is360Sel === 'false') ph.type = 'photo';
        const latlng = el('dLatLng').value.trim();
        if (latlng) {
            const m = latlng.split(',').map(s => parseFloat(s.trim()));
            if (m.length === 2 && !Number.isNaN(m[0]) && !Number.isNaN(m[1]) && Math.abs(m[0]) <= 90 && Math.abs(m[1]) <= 180) {
                ph.lat = m[0]; ph.lng = m[1];
            } else { alert('座標格式錯誤，請用 "lat,lng"'); }
        } else { ph.lat = ph.lng = null; }
        const dt = el('dTime').value; ph.capturedAt = dt ? new Date(dt).toISOString() : null;
        const br = parseFloat(el('dBearing').value);
        ph.bearing = Number.isFinite(br) ? clamp(br, 0, 359.9) : null;
        const yp = el('dYawPitch').value.trim();
        if (yp) { const [y, p] = yp.split(',').map(s => parseFloat(s.trim())); ph.yaw = Number.isFinite(y) ? y : 0; ph.pitch = Number.isFinite(p) ? p : 0; }
        if (!ph.type || ph.type === 'auto') ph.type = isPanoramaBySize(ph.width, ph.height) ? 'photo360' : 'photo';
        upsertMarker(ph);
        renderPhotoList();
        state.selectedOne = JSON.parse(JSON.stringify(ph));
        state.origOne = JSON.parse(JSON.stringify(ph));
    }

    function revertDetail() {
        const id = state.selectedOne?.id; if (!id) return;
        const idx = state.photos.findIndex(p => p.id === id);
        if (idx === -1) return;

        // 用原始快照覆蓋目前這張
        const orig = state.origOne;
        if (orig) {
            state.photos[idx] = JSON.parse(JSON.stringify(orig));
            upsertMarker(state.photos[idx]); // 同步地圖
            renderPhotoList();
            // 重新選取（也會重填表單），但這次不改 origOne
            state.selectedOne = JSON.parse(JSON.stringify(orig));
            // 不重設 origOne，保持基準不變
            el('dTitle').value = orig.title || '';
            el('dDesc').value = orig.description || '';
            el('dTags').value = (orig.tags || []).join(',');
            el('dAuthor').value = orig.author || '';
            el('dLicense').value = orig.license || '';
            el('dIs360').value = orig.type === 'photo360' ? 'true' : (orig.type === 'photo' ? 'false' : 'auto');
            el('dLatLng').value = (orig.lat != null && orig.lng != null) ? `${orig.lat},${orig.lng}` : '';
            el('dTime').value = orig.capturedAt ? new Date(orig.capturedAt).toISOString().slice(0, 16) : '';
            el('dBearing').value = (orig.bearing != null ? orig.bearing : '');
            el('dYawPitch').value = (orig.yaw != null || orig.pitch != null) ? `${orig.yaw || 0},${orig.pitch || 0}` : '';
        } else {
            // 沒快照就退回顯示用的 reload
            selectOne(id);
        }
    }

    function deletePhoto(id) {
        const idx = state.photos.findIndex(p => p.id === id);
        if (idx === -1) return;
        const existing = state.markers.get(id);
        if (existing) { state.cluster.removeLayer(existing.marker); if (existing.fov) map.removeLayer(existing.fov); state.markers.delete(id); }
        state.photos.splice(idx, 1);
        state.selectedIds.delete(id);
        if (state.selectedOne && state.selectedOne.id === id) {
            state.selectedOne = null;
            ['dTitle', 'dDesc', 'dTags', 'dAuthor', 'dLicense', 'dIs360', 'dLatLng', 'dTime', 'dBearing', 'dYawPitch'].forEach(k => {
                const e = el(k); if (!e) return; if (e.tagName === 'SELECT') e.value = 'auto'; else e.value = '';
            });
        }
        updateStatus();
    }

    function updateDetailButtonsEnabled() {
        const ok = !!state.selectedOne;
        el('btnSave').disabled = !ok;
        el('btnRevert').disabled = !ok;
        el('btnSetCoord').disabled = !ok;
        el('btnDeleteOne').disabled = !ok;
    }

    function upsertMarker(ph) {
        const existing = state.markers.get(ph.id);
        if (existing) {
            state.cluster.removeLayer(existing.marker);
            if (existing.fov) map.removeLayer(existing.fov);
        }

        // 沒座標或被隱藏，就不要放到地圖上
        if (ph.lat == null || ph.lng == null || ph.hidden) {
            state.markers.delete(ph.id);
            return;
        }

        const icon = ph.type === 'photo360' ? divIcon('360°', 'panorama') : divIcon('📷', 'photo');
        const marker = L.marker([ph.lat, ph.lng], { icon });
        marker.bindPopup(buildPopupHtml(ph));
        marker.on('popupopen', () => {
            selectOne(ph.id);
            if (ph.type === 'photo360') {
                const elv = document.getElementById('pnl_' + ph.id);
                if (elv) {
                    pannellum.viewer(elv, {
                        type: 'equirectangular', panorama: ph.src, autoLoad: true,
                        yaw: ph.yaw || 0, pitch: ph.pitch || 0, hfov: 75
                    });
                }
            }
        });
        state.cluster.addLayer(marker);

        let fov = null;
        if (ph.bearing != null) {
            fov = bearingFOVPolygon(ph.lat, ph.lng, ph.bearing, 60, 80).addTo(map);
        }
        state.markers.set(ph.id, { marker, fov });
    }

    function syncAllMarkers() {
        state.cluster.clearLayers();
        state.markers.forEach(m => { if (m.fov) map.removeLayer(m.fov); });
        state.markers.clear();
        state.photos.forEach(upsertMarker);
    }

    /*** —— 上傳/解析流程 —— ***/
    el('fileInput').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        for (const original of files) {
            await addPhotoFromFile(original);
        }
        updateStatus(); renderPhotoList();
    });

    function dmsToDeg(x) {
        if (x == null) return null;
        if (typeof x === 'number') return x;
        if (Array.isArray(x)) {
            const toNum = v => (typeof v === 'object' && v && 'numerator' in v)
                ? v.numerator / (v.denominator || 1)
                : Number(v);
            const [d = 0, m = 0, s = 0] = x.map(toNum);
            return (Math.sign(d) || 1) * (Math.abs(d) + m / 60 + s / 3600);
        }
        if (typeof x === 'object' && 'numerator' in x) {
            return x.numerator / (x.denominator || 1);
        }
        return Number(x);
    }

    function extractGps(meta) {
        const g = meta?.gps || {};
        let lat = g.latitude ?? meta?.latitude ?? meta?.GPSLatitude ?? null;
        let lng = g.longitude ?? meta?.longitude ?? meta?.GPSLongitude ?? null;
        let alt = g.altitude ?? meta?.altitude ?? meta?.GPSAltitude ?? null;

        lat = dmsToDeg(lat);
        lng = dmsToDeg(lng);
        if (alt && typeof alt === 'object' && 'numerator' in alt) {
            alt = alt.numerator / (alt.denominator || 1);
        } else if (Array.isArray(alt)) {
            alt = dmsToDeg(alt);
        } else if (alt != null) {
            alt = Number(alt);
        }
        return { lat, lng, alt };
    }

    async function addPhotoFromDataURL(name, dataUrl, { lat = null, lng = null, title = '', description = '', bearing = null, yaw = 0, pitch = 0, capturedAt = null } = {}) {
        const blob = await (await fetch(dataUrl)).blob();
        const bmp = await imageBitmapFromBlob(blob);
        const w = bmp.width, h = bmp.height;
        const thumb = await makeThumbnail(blob, parseInt(el('thumbSize').value || '512'));
        const id = 'ph_' + Math.random().toString(36).slice(2, 9);
        const is360 = isPanoramaBySize(w, h); // 2:1 視為 360
        const ph = {
            id,
            name: name || 'image.jpg',
            type: is360 ? 'photo360' : 'photo',
            src: dataUrl,
            thumbnail: thumb.url,
            width: w, height: h,
            lat, lng,
            yaw, pitch,
            bearing,
            capturedAt,
            tags: [],
            title: title || (name ? name.replace(/\.[^.]+$/, '') : 'Photo'),
            description: description || '',
            author: '',
            license: ''
        };
        state.photos.push(ph);
        upsertMarker(ph);
    }

    // 從 KML DOM + KMZ 檔表抓出照片（PhotoOverlay 與 Placemark <description><img ...>）
    async function importPhotosFromKmlDom(dom, fileMap) {
        const getText = (node, sel) => (node.querySelector(sel)?.textContent || '').trim();

        // 1) PhotoOverlay（Google Earth 全景/照片）
        for (const po of dom.querySelectorAll('PhotoOverlay')) {
            const name = getText(po, 'name');
            const desc = getText(po, 'description');
            const href = getText(po, 'Icon > href');
            const coords = getText(po, 'Point > coordinates'); // "lng,lat[,alt]"
            if (!href || !coords) continue;

            const img = findKmzImage(href, fileMap);
            if (!img) continue;

            const [lng, lat] = coords.split(',').map(Number);
            const heading = parseFloat(getText(po, 'Camera > heading'));
            const tilt = parseFloat(getText(po, 'Camera > tilt'));

            await addPhotoFromDataURL(img.name, img.dataUrl, {
                lat, lng,
                title: name,
                description: desc,
                bearing: Number.isFinite(heading) ? heading : null,
                yaw: Number.isFinite(heading) ? heading : 0,
                pitch: Number.isFinite(tilt) ? tilt : 0
            });
        }

        // 2) Placemark（常見是把 <img src="files/xxx.jpg"> 放在 <description>）
        for (const pm of dom.querySelectorAll('Placemark')) {
            const coords = getText(pm, 'Point > coordinates');
            if (!coords) continue;
            const [lng, lat] = coords.split(',').map(Number);
            const name = getText(pm, 'name');
            const when = getText(pm, 'TimeStamp > when') || null;
            const descHtml = getText(pm, 'description');
            if (!descHtml) continue;

            // 把 description 當 HTML parse，找第一張 <img>
            const doc = new DOMParser().parseFromString(descHtml, 'text/html');
            const imgTag = doc.querySelector('img');
            if (!imgTag) continue;

            const href = imgTag.getAttribute('src') || '';
            const img = findKmzImage(href, fileMap);
            if (!img) continue;

            // 試抓 heading（有些會放在 IconStyle/heading 或 ExtendedData）
            let bearing = null;
            const h1 = parseFloat(getText(pm, 'Style > IconStyle > heading'));
            if (Number.isFinite(h1)) bearing = h1;
            if (bearing == null) {
                const h2 = (pm.querySelector('ExtendedData Data[name="bearing"] > value')?.textContent || '').trim();
                if (h2) {
                    const v = parseFloat(h2);
                    if (Number.isFinite(v)) bearing = v;
                }
            }

            await addPhotoFromDataURL(img.name, img.dataUrl, {
                lat, lng,
                title: name,
                description: doc.body.textContent?.trim() || '', // 純文字備註
                bearing,
                capturedAt: when
            });
        }
    }

    async function addPhotoFromFile(file) {
        try {
            const name = file.name || '';
            const displayFile = await convertHeicIfNeeded(file);
            const imgURL = await dataURLFromFile(displayFile);
            const bmp = await imageBitmapFromBlob(displayFile);
            const w = bmp.width, h = bmp.height;

            let meta = {};
            try {
                meta = await exifr.parse(file, { tiff: true, ifd1: true, xmp: true, gps: true, userComment: true });
            } catch (ex) {
                console.warn('EXIF 解析失敗：', ex);
            }

            const GPano = meta?.xmp?.GPano || meta?.GPano || {};
            const { lat, lng } = extractGps(meta);
            const heading = GPano.PoseHeadingDegrees ?? meta?.heading ?? null;
            const capturedAt = meta?.DateTimeOriginal ? new Date(meta.DateTimeOriginal).toISOString() : null;
            const is360 = isPanoramaBySize(w, h) || !!GPano?.ProjectionType;

            const thumb = await makeThumbnail(displayFile, parseInt(el('thumbSize').value || '512'));
            const id = uid();
            const ph = {
                id,
                name: (displayFile.name || name),
                type: is360 ? 'photo360' : 'photo',
                src: imgURL,
                thumbnail: thumb.url,
                width: w,
                height: h,
                lat,
                lng,
                yaw: GPano?.PoseHeadingDegrees || 0,
                pitch: 0,
                bearing: heading ?? null,
                capturedAt,
                tags: [],
                title: (displayFile.name || name).replace(/\.[^.]+$/, ''),
                description: '',
                author: '',
                license: ''
            };

            state.photos.push(ph);
            upsertMarker(ph);
        } catch (err) {
            console.error('加入相片失敗', err);
            alert('加入相片失敗：' + (err?.message || err));
        }
    }

    map.on('click', (e) => {
        if (!state.setCoordMode) return;
        const ph = state.selectedOne && state.photos.find(p => p.id === state.selectedOne.id);
        if (!ph) { alert('請先在左側選一張相片'); return; }

        // 直接改資料（目前設計是即時套用到 ph）
        ph.lat = e.latlng.lat; ph.lng = e.latlng.lng;
        upsertMarker(ph); renderPhotoList();

        // 同步表單顯示，但不要呼叫 selectOne() 以免覆寫 origOne
        el('dLatLng').value = `${ph.lat},${ph.lng}`;
        if (state.selectedOne) {
            state.selectedOne.lat = ph.lat;
            state.selectedOne.lng = ph.lng;
        }

        state.setCoordMode = false; el('btnSetCoord').classList.remove('warn');
    });

    /*** —— 匯入軌跡/標註 —— ***/
    el('trackInput').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        for (const f of files) { await importTrackFile(f); }
        updateStatus();
        renderPhotoList();
    });

    async function importTrackFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        let gj = null;

        try {
            if (ext === 'gpx' || ext === 'kml') {
                const text = await file.text();
                const dom = new DOMParser().parseFromString(text, 'text/xml');
                gj = (ext === 'gpx') ? toGeoJSON.gpx(dom) : toGeoJSON.kml(dom);

            } else if (ext === 'kmz') {
                // ⬅️ 新增：KMZ → 解壓 → 取 KML → 轉 GeoJSON
                const { kmlText, fileMap } = await extractKmz(file);
                const dom = new DOMParser().parseFromString(kmlText, 'text/xml');
                gj = toGeoJSON.kml(dom);
                await importPhotosFromKmlDom(dom, fileMap);

            } else if (ext === 'geojson' || ext === 'json') {
                const text = await file.text();
                gj = JSON.parse(text);

            } else if (ext === 'csv') {
                const text = await file.text();
                gj = csvPointsToGeoJSON(text);
            }
        } catch (err) {
            alert('解析檔案失敗：' + err.message);
            return;
        }

        if (!gj) return;
        L.geoJSON(gj, {
            onEachFeature: (feat, layer) => { layer.bindPopup(feat.properties?.name || ''); }
        }).addTo(state.drawn);

        state.tracks.push(gj);
    }

    function csvPointsToGeoJSON(text) {
        const lines = text.split(/\r?\n/).filter(Boolean);
        const head = lines.shift().split(',').map(s => s.trim().toLowerCase());
        const iLat = head.indexOf('lat'), iLng = head.indexOf('lng');
        const iName = head.indexOf('name'), iDesc = head.indexOf('desc');
        const feats = [];
        for (const line of lines) {
            const cols = line.split(',');
            const lat = parseFloat(cols[iLat]); const lng = parseFloat(cols[iLng]);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            feats.push({ type: 'Feature', properties: { name: cols[iName] || '', desc: cols[iDesc] || '' }, geometry: { type: 'Point', coordinates: [lng, lat] } });
        }
        return { type: 'FeatureCollection', features: feats };
    }

    // 依時間戳對齊照片與軌跡（最近點）
    el('btnTimeAlign').addEventListener('click', () => {
        const tracks = state.tracks.flatMap(gj => gj.features || []);
        const timed = tracks.filter(f => f.geometry.type === 'LineString' && f.properties && f.properties.coordTimes);
        if (!timed.length) { alert('找不到含時間的 GPX/KML（coordTimes）'); return; }
        const samples = [];
        for (const f of timed) {
            const coords = f.geometry.coordinates; const times = f.properties.coordTimes.map(t => new Date(t).getTime());
            for (let i = 0; i < coords.length; i++) samples.push({ t: times[i], lat: coords[i][1], lng: coords[i][0] });
        }
        samples.sort((a, b) => a.t - b.t);
        for (const ph of state.photos) {
            if (!ph.capturedAt) continue;
            const t = new Date(ph.capturedAt).getTime();
            let lo = 0, hi = samples.length - 1;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (samples[mid].t < t) lo = mid + 1; else hi = mid; }
            const cand = [samples[clamp(lo - 1, 0, samples.length - 1)], samples[lo], samples[clamp(lo + 1, 0, samples.length - 1)]].filter(Boolean);
            cand.sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t));
            const best = cand[0]; if (best) { ph.lat = best.lat; ph.lng = best.lng; upsertMarker(ph); }
        }
        renderPhotoList();
        alert('時間對齊完成（採用最接近時間點）');
    });

    /*** —— 批次操作 —— ***/
    el('btnSelectAll').addEventListener('click', () => { state.photos.forEach(p => state.selectedIds.add(p.id)); renderPhotoList(); });
    el('btnApplyFilter').addEventListener('click', renderPhotoList);
    el('btnClearFilter').addEventListener('click', () => { el('qText').value = ''; el('qIs360').value = 'any'; el('qStartDate').value = ''; el('qEndDate').value = ''; renderPhotoList(); });
    el('btnApplyBatch').addEventListener('click', () => {
        const tags = (el('batchTags').value || '').split(',').map(s => s.trim()).filter(Boolean);
        const shift = parseInt(el('batchShift').value || '0');
        state.photos.filter(p => state.selectedIds.has(p.id)).forEach(p => {
            if (tags.length) { p.tags = Array.from(new Set([...(p.tags || []), ...tags])); }
            if (p.capturedAt && shift) { const t = new Date(p.capturedAt); t.setMinutes(t.getMinutes() + shift); p.capturedAt = t.toISOString(); }
            upsertMarker(p);
        });
        renderPhotoList();
    });
    el('btnSameLicense').addEventListener('click', () => {
        const picked = state.photos.find(p => state.selectedIds.has(p.id));
        if (!picked) { alert('請先勾選至少一張，並確保其中一張已填授權'); return; }
        state.photos.filter(p => state.selectedIds.has(p.id)).forEach(p => p.license = picked.license);
        renderPhotoList();
    });

    el('btnSave').addEventListener('click', saveDetail);
    el('btnRevert').addEventListener('click', revertDetail);
    el('btnSetCoord').addEventListener('click', () => { state.setCoordMode = !state.setCoordMode; el('btnSetCoord').classList.toggle('warn', state.setCoordMode); });

    if (el('btnDeleteSelected')) {
        el('btnDeleteSelected').addEventListener('click', () => {
            if (!state.selectedIds.size) { alert('請先勾選要刪除的相片'); return; }
            if (!confirm('確定刪除已選相片？此動作無法復原。')) return;
            [...state.selectedIds].forEach(id => deletePhoto(id));
            state.selectedIds.clear();
            renderPhotoList();
        });
    }
    if (el('btnDeleteOne')) {
        el('btnDeleteOne').addEventListener('click', () => {
            const id = state.selectedOne?.id; if (!id) { alert('尚未選擇相片'); return; }
            if (!confirm('確定刪除此相片？')) return;
            deletePhoto(id);
            renderPhotoList();
        });
    }

    /*** —— 匯出 —— ***/
    el('btnExport').addEventListener('click', async () => {
        const mode = el('exportMode').value;
        const prec = parseInt(el('coordPrec').value || '5');
        const strip = el('stripExif').value.startsWith('是');

        // site / kmz 之外才從 UI 讀 includeFull
        const includeFullUI = el('includeFull').value === '是';

        if (mode === 'kmz') {
            // KMZ 一定要把圖打包進壓縮檔
            const payload = await buildProjectJSON({ coordPrecision: prec, includeFull: true, stripExif: strip });
            const blob = await buildKMZZip(payload);
            saveAs(blob, `photo-map-${Date.now()}.kmz`);
            return;
        }

        // 先組 payload（KML 不內嵌圖片，includeFull 其實用不到）
        const payload = await buildProjectJSON({ coordPrecision: prec, includeFull: includeFullUI, stripExif: strip });

        if (mode === 'kml') {
            // 這裡才是 KML 輸出
            const kml = buildKML(payload);
            const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
            saveAs(blob, `photo-map-${Date.now()}.kml`);
            return;
        }

        if (mode === 'single') {
            const html = await buildSingleHTML(payload);
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            saveAs(blob, `photo-map-${Date.now()}.html`);
            return;
        }

        // 其餘視為 site（ZIP）
        const zip = await buildStaticSiteZip(payload);
        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, `photo-map-site-${Date.now()}.zip`);
    });

    async function buildProjectJSON({ coordPrecision = 5, includeFull = true, stripExif = true }) {
        const photos = [];
        for (const p of state.photos) {
            const ph = { ...p };
            if (ph.lat != null) { ph.lat = +(ph.lat.toFixed(coordPrecision)); ph.lng = +(ph.lng.toFixed(coordPrecision)); }
            if (stripExif) {
                if (includeFull) {
                    ph.src = await reencodeImage(ph.src, 'image/jpeg', 0.92);
                }
            }
            photos.push({
                id: ph.id, name: ph.name, type: ph.type,
                src: includeFull ? ph.src : undefined,
                thumbnail: ph.thumbnail, width: ph.width, height: ph.height,
                lat: ph.lat, lng: ph.lng, yaw: ph.yaw, pitch: ph.pitch,
                bearing: ph.bearing, capturedAt: ph.capturedAt, tags: ph.tags,
                title: ph.title, description: ph.description, license: ph.license, author: ph.author
            });
        }
        const drawnGj = state.drawn.toGeoJSON();
        return {
            project: { title: 'My 360 Map', createdAt: new Date().toISOString(), projection: 'EPSG:4326', baseLayers: ['osm', 'satellite'] },
            photos,
            annotations: drawnGj
        };
    }

    async function reencodeImage(dataURL, mime = 'image/jpeg', quality = 0.92) {
        const blob = await (await fetch(dataURL)).blob();
        const bmp = await imageBitmapFromBlob(blob);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
        return c.toDataURL(mime, quality);
    }

    async function buildSingleHTML(payload) {
        const tpl = '<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>' +
            '<title>相片地圖（單檔分享）</title>' +
            '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>' +
            '<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"/>' +
            '<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"/>' +
            '<link rel="stylesheet" href="https://unpkg.com/pannellum@2.5.6/build/pannellum.css"/>' +
            '<style>html,body,#map{height:100%;margin:0} .marker-icon{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:2px solid #222e57;background:#0e1733;color:#0ff;font-weight:700;box-shadow:0 1px 6px rgba(0,0,0,.35)}</style>' +
            '</head><body><div id="map"></div>' +
            '<script>const PROJECT = ' + JSON.stringify(payload) + ';<\/script>' +
            '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>' +
            '<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"><\/script>' +
            '<script src="https://unpkg.com/pannellum@2.5.6/build/pannellum.js"><\/script>' +
            '<script>' +
            '  const map=L.map("map").setView([23.7,121],7);' +
            '  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OSM"}).addTo(map);' +
            '  const cluster=L.markerClusterGroup(); map.addLayer(cluster);' +
            '  function divIcon(c){return L.divIcon({html:"<div class=\\"marker-icon\\">"+c+"</div>",className:"",iconSize:[34,34],iconAnchor:[17,17]});}' +
            '  function buildPopupHtml(ph){' +
            '    const is360 = ph.type==="photo360";' +
            '    var img = is360' +
            '      ? "<div id=\\"pnl_"+ph.id+"\\" style=\\"width:360px;height:220px\\"></div>"' +
            '      : "<img src=\\""+ph.src+"\\" style=\\"max-width:320px;max-height:240px;border-radius:8px\\">";' +
            '    return "<div style=\\"min-width:340px\\"><div style=\\"font-weight:700\\">"+(ph.title||ph.name)+"</div>"+img+"</div>";' +
            '  }' +
            '  function bearingFOVPolygon(lat,lng,bearingDeg,fov=60,dist=80){const R=6378137;const ang=dist/R;const d2r=x=>x*Math.PI/180,r2d=x=>x*180/Math.PI;const lat1=d2r(lat),lon1=d2r(lng),b=d2r(bearingDeg),h=d2r(fov/2);const pts=[[lat,lng]];for(const a of [b-h,b,b+h]){const lat2=Math.asin(Math.sin(lat1)*Math.cos(ang)+Math.cos(lat1)*Math.sin(ang)*Math.cos(a));const lon2=lon1+Math.atan2(Math.sin(a)*Math.sin(ang)*Math.cos(lat1),Math.cos(ang)-Math.sin(lat1)*Math.sin(lat2));pts.push([r2d(lat2),r2d(lon2)]);}return L.polygon(pts,{color:"#4da3ff",weight:1,fillOpacity:.15,opacity:.8});}' +
            '  for(const ph of PROJECT.photos){' +
            '    if(ph.lat==null) continue;' +
            '    const icon=ph.type==="photo360"?divIcon("360°"):divIcon("📷");' +
            '    const m=L.marker([ph.lat,ph.lng],{icon}); m.bindPopup(buildPopupHtml(ph));' +
            '    m.on("popupopen",()=>{ if(ph.type==="photo360"){ const el=document.getElementById("pnl_"+ph.id); if(el) pannellum.viewer(el,{type:"equirectangular",panorama:ph.src,autoLoad:true,yaw:ph.yaw||0,pitch:ph.pitch||0,hfov:75}); } });' +
            '    cluster.addLayer(m); if(ph.bearing!=null){ bearingFOVPolygon(ph.lat,ph.lng,ph.bearing).addTo(map); }' +
            '  }' +
            '  if (PROJECT.annotations && PROJECT.annotations.features && PROJECT.annotations.features.length) {' +
            '    const anno = L.geoJSON(PROJECT.annotations, {' +
            '      style: function(feat){ var s=(feat.properties&&feat.properties.style)||{}; return {' +
            '        color: s.color || "#4da3ff",' +
            '        weight: (s.weight!=null ? s.weight : 2),' +
            '        fillColor: s.fillColor || "#4da3ff",' +
            '        fillOpacity: (s.fillOpacity!=null ? s.fillOpacity : 0.15),' +
            '        opacity: 0.9' +
            '      }; },' +
            '      pointToLayer: function(feat, latlng){ return L.marker(latlng); },' +
            '      onEachFeature: function(feat, layer){ var name = feat.properties && feat.properties.name; if (name) layer.bindPopup("<b>"+name+"</b>"); }' +
            '    }).addTo(map);' +
            '  }' +
            '<\/script></body></html>';
        return tpl;
    }

    async function buildStaticSiteZip(payload) {
        const zip = new JSZip();

        // —— Windows 安全檔名（含保留字、非法字元、尾端空白/點、長度限制）與避免重複 —— //
        function safeWinName(raw = 'file', fallbackExt = '') {
            let base = (raw || 'file').split(/[\\/]/).pop();
            base = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
            base = base.replace(/\s+$/g, '').replace(/\.+$/g, '');
            if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(base)) base = '_' + base;
            if (base.length > 180) {
                const m = base.match(/^(.*?)(\.[^.]+)?$/);
                const stem = (m && m[1]) || 'file';
                const ext = (m && m[2]) || '';
                base = stem.slice(0, 180 - ext.length) + ext;
            }
            if (!/\.[^.]+$/.test(base) && fallbackExt) base += fallbackExt;
            return base || ('file' + fallbackExt);
        }
        const used = new Set();
        const uniq = (name) => {
            let n = name, i = 1;
            while (used.has(n.toLowerCase())) {
                const m = n.match(/^(.*?)(\.[^.]+)?$/);
                n = `${m[1]}_${i}${m[2] || ''}`; i++;
            }
            used.add(n.toLowerCase());
            return n;
        };

        // —— 依賴（從 CDN 抓到本地 lib/） —— //
        async function addLib(url, path) {
            const txt = await (await fetch(url)).text();
            zip.file(path, txt);
        }
        async function addLibBin(url, path) {
            const ab = await (await fetch(url)).arrayBuffer();
            zip.file(path, ab);
        }

        await addLib('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'lib/leaflet.css');
        await addLib('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'lib/leaflet.js');
        await addLib('https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css', 'lib/MarkerCluster.css');
        await addLib('https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css', 'lib/MarkerCluster.Default.css');
        await addLib('https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js', 'lib/leaflet.markercluster.js');
        await addLib('https://unpkg.com/pannellum@2.5.6/build/pannellum.css', 'lib/pannellum.css');
        await addLib('https://unpkg.com/pannellum@2.5.6/build/pannellum.js', 'lib/pannellum.js');

        // Leaflet 預設圖示（annotations 的 pointToLayer 會用到）
        await addLibBin('https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png', 'lib/images/marker-icon.png');
        await addLibBin('https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png', 'lib/images/marker-icon-2x.png');
        await addLibBin('https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png', 'lib/images/marker-shadow.png');

        // —— 輸出原圖到 assets/，並在 payload.photos 回填 assetName（同時移除 base64 與縮圖） —— //
        const assetsFolder = zip.folder('assets');
        for (const p of payload.photos || []) {
            if (p.src) {
                const data = p.src.split(',')[1];
                const safe = uniq(safeWinName(p.name, '.jpg'));
                p.assetName = safe;
                assetsFolder.file(safe, data, { base64: true });
                delete p.src; // 瘦身 data.json：不再嵌入整張圖
            }
            if (p.thumbnail) delete p.thumbnail; // site 版不需要縮圖 base64
        }

        // —— data.json 仍保留（供之後上傳伺服器使用），但 index.html 內會內嵌同內容以支援 file:// —— //
        const dataStr = JSON.stringify(payload, null, 2).replace(/<\/script/gi, '<\\/script>');
        zip.file('data.json', dataStr);

        // —— index.html（直接內嵌 JSON；若拿去上傳，也保留 fetch 作為後備） —— //
        const END = '</' + 'script>';
        const indexHtml =
            '<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>' +
            '<title>相片地圖</title>' +
            '<link rel="stylesheet" href="lib/leaflet.css"/>' +
            '<link rel="stylesheet" href="lib/MarkerCluster.css"/>' +
            '<link rel="stylesheet" href="lib/MarkerCluster.Default.css"/>' +
            '<link rel="stylesheet" href="lib/pannellum.css"/>' +
            '<style>html,body,#map{height:100%;margin:0} .marker-icon{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:2px solid #222e57;background:#0e1733;color:#0ff;font-weight:700;box-shadow:0 1px 6px rgba(0,0,0,.35)}</style>' +
            '</head><body><div id="map"></div>' +
            // 內嵌資料（本地直接解析）
            '<script id="__DATA__" type="application/json">' + dataStr + END +
            '<script src="lib/leaflet.js">' + END +
            '<script src="lib/leaflet.markercluster.js">' + END +
            '<script src="lib/pannellum.js">' + END +
            '<script>' +
            '(function(){' +
            '  function divIcon(c){return L.divIcon({html:"<div class=\\"marker-icon\\">"+c+"</div>",className:"",iconSize:[34,34],iconAnchor:[17,17]});}' +
            '  function buildPopupHtml(ph){' +
            '    const is360=ph.type==="photo360";' +
            '    const assetName=(ph.assetName||((ph.name||"").replace(/[^\\w.\\-]/g,"_")));' +
            '    const src="assets/"+assetName;' +
            '    var img = is360' +
            '      ? "<div id=\\"pnl_"+ph.id+"\\" style=\\"width:360px;height:220px\\"></div>"' +
            '      : "<img src=\\""+src+"\\" style=\\"max-width:320px;max-height:240px;border-radius:8px\\">";' +
            '    return "<div style=\\"min-width:340px\\"><div style=\\"font-weight:700\\">"+(ph.title||ph.name)+"</div>"+img+"</div>";' +
            '  }' +
            '  function bearingFOVPolygon(lat,lng,bearingDeg,fov=60,dist=80){const R=6378137;const ang=dist/R;const d2r=x=>x*Math.PI/180,r2d=x=>x*180/Math.PI;const lat1=d2r(lat),lon1=d2r(lng),b=d2r(bearingDeg),h=d2r(fov/2);const pts=[[lat,lng]];for(const a of [b-h,b,b+h]){const lat2=Math.asin(Math.sin(lat1)*Math.cos(ang)+Math.cos(lat1)*Math.sin(ang)*Math.cos(a));const lon2=lon1+Math.atan2(Math.sin(a)*Math.sin(ang)*Math.cos(lat1),Math.cos(ang)-Math.sin(lat1)*Math.sin(lat2));pts.push([r2d(lat2),r2d(lon2)]);}return L.polygon(pts,{color:"#4da3ff",weight:1,fillOpacity:.15,opacity:.8});}' +
            '  function init(PROJECT){' +
            '    const map=L.map("map").setView([23.7,121],7);' +
            '    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OSM"}).addTo(map);' +
            '    const cluster=L.markerClusterGroup(); map.addLayer(cluster);' +
            '    for(const ph of (PROJECT.photos||[])){' +
            '      if(ph.lat==null) continue; const icon=ph.type==="photo360"?divIcon("360°"):divIcon("📷");' +
            '      const m=L.marker([ph.lat,ph.lng],{icon}); m.bindPopup(buildPopupHtml(ph));' +
            '      m.on("popupopen",()=>{ if(ph.type==="photo360"){ const el=document.getElementById("pnl_"+ph.id); if(el){ const assetName=(ph.assetName||((ph.name||"").replace(/[^\\w.\\-]/g,"_"))); const src="assets/"+assetName; pannellum.viewer(el,{type:"equirectangular",panorama:src,autoLoad:true}); } } });' +
            '      cluster.addLayer(m); if(ph.bearing!=null){ bearingFOVPolygon(ph.lat,ph.lng,ph.bearing).addTo(map); }' +
            '    }' +
            '    if (PROJECT.annotations && PROJECT.annotations.features && PROJECT.annotations.features.length){' +
            '      L.geoJSON(PROJECT.annotations, {' +
            '        style: function(feat){ var s=(feat.properties&&feat.properties.style)||{}; return {color:s.color||"#4da3ff",weight:(s.weight!=null?s.weight:2),fillColor:s.fillColor||"#4da3ff",fillOpacity:(s.fillOpacity!=null?s.fillOpacity:0.15),opacity:0.9}; },' +
            '        pointToLayer: function(feat, latlng){ return L.marker(latlng); },' +
            '        onEachFeature: function(feat, layer){ var name=feat.properties&&feat.properties.name; if(name) layer.bindPopup("<b>"+name+"</b>"); }' +
            '      }).addTo(map);' +
            '    }' +
            '  }' +
            '  try{ var el=document.getElementById("__DATA__"); if(el && el.textContent.trim()){ init(JSON.parse(el.textContent)); return; } }catch(e){}' +
            '  fetch("data.json")' + // 若未內嵌或改成純外連檔案時可用
            '    .then(r=>{ if(!r.ok) throw new Error("讀取 data.json 失敗: "+r.status); return r.json(); })' +
            '    .then(init)' +
            '    .catch(err=>{' +
            '      document.body.innerHTML = "<div style=\\"padding:16px;font:14px/1.6 system-ui\\"><h1>無法載入資料</h1><p>請勿用 <code>file://</code> 直接開啟 <b>index.html</b>，改用本機伺服器（例如 <code>npx http-server .</code>）或部署到 GitHub Pages/Netlify。</p><pre>"+String(err)+"</pre></div>";' +
            '    });' +
            '})();' +
            END +
            '</body></html>';

        zip.file('index.html', indexHtml);

        return zip;
    }

    function buildKML(payload) {
        const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

        const hexToRgb = (hex) => {
            if (!hex) return { r: 77, g: 163, b: 255 };
            const m = String(hex).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
            if (!m) return { r: 77, g: 163, b: 255 };
            let h = m[1].toLowerCase();
            if (h.length === 3) h = h.split('').map(c => c + c).join('');
            return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
        };
        // KML 顏色順序是 aabbggrr（注意顛倒）
        const kmlColor = (hex, alpha = 1) => {
            const { r, g, b } = hexToRgb(hex);
            const a = Math.round(clamp(alpha, 0, 1) * 255);
            const h2 = n => n.toString(16).padStart(2, '0');
            return h2(a) + h2(b) + h2(g) + h2(r);
        };

        const coord = (lng, lat, alt = null, prec = 6) => {
            const f = n => (typeof n === 'number' ? n.toFixed(prec) : '');
            return `${f(lng)},${f(lat)}${(alt != null ? ',' + Number(alt).toFixed(1) : '')}`;
        };

        // 產生照片 Placemark（一般 & 360）
        const photoPlacemarks = (photos = []) => photos
            .filter(ph => ph.lat != null && ph.lng != null)
            .map(ph => {
                const is360 = (ph.type === 'photo360');
                const styleId = is360 ? 'pano' : 'photo';
                const when = ph.capturedAt ? `<TimeStamp><when>${esc(ph.capturedAt)}</when></TimeStamp>` : '';
                const ext = [
                    ['id', ph.id], ['type', ph.type], ['bearing', ph.bearing],
                    ['yaw', ph.yaw], ['pitch', ph.pitch], ['width', ph.width],
                    ['height', ph.height], ['tags', (ph.tags || []).join(',')],
                    ['author', ph.author], ['license', ph.license]
                ].map(([k, v]) => v != null && v !== '' ? `<Data name="${esc(k)}"><value>${esc(v)}</value></Data>` : '').join('');

                // 針對單一點位設定 heading，會覆蓋 styleUrl 內的 IconStyle 旋轉
                const headingStyle = (typeof ph.bearing === 'number')
                    ? `<Style><IconStyle><heading>${Math.round(clamp(ph.bearing, 0, 359.9))}</heading></IconStyle></Style>`
                    : '';

                const descHtml = `
        <div><b>${esc(ph.title || ph.name || '')}</b></div>
        ${ph.description ? `<div>${esc(ph.description)}</div>` : ''}
        ${(ph.tags && ph.tags.length) ? `<div>#${ph.tags.map(esc).join(' #')}</div>` : ''}
        ${ph.author ? `<div>作者：${esc(ph.author)}</div>` : ''}
        ${ph.license ? `<div>授權：${esc(ph.license)}</div>` : ''}
        ${is360 ? `<div>（360° 影像：KML 僅顯示為地標）</div>` : ''}
      `.replace(/\s+/g, ' ').trim();

                return `
        <Placemark>
          <name>${esc(ph.title || ph.name || (is360 ? '360 Photo' : 'Photo'))}</name>
          <styleUrl>#${styleId}</styleUrl>
          ${when}
          <ExtendedData>${ext}</ExtendedData>
          <description><![CDATA[${descHtml}]]></description>
          ${headingStyle}
          <Point><coordinates>${coord(ph.lng, ph.lat, ph.alt)}</coordinates></Point>
        </Placemark>`;
            }).join('\n');

        // 把 GeoJSON 標註輸出成 KML（基本幾何）
        const annotationsKml = (gj) => {
            if (!gj || !Array.isArray(gj.features)) return '';
            const features = gj.features.map((f, idx) => featureToKml(f, idx)).join('\n');
            return features ? `<Folder><name>Annotations</name>${features}</Folder>` : '';
        };

        function featureToKml(feat, idx = 0) {
            const g = feat && feat.geometry;
            if (!g) return '';
            const name = esc(feat.properties?.name || `Feature ${idx + 1}`);
            const s = feat.properties?.style || {};
            const lineColor = kmlColor(s.color || '#4da3ff', 0.9);
            const polyFill = kmlColor(s.fillColor || s.color || '#4da3ff', (s.fillOpacity != null ? s.fillOpacity : 0.25));
            const lineWeight = (s.weight != null ? s.weight : 2);

            const styleXml = `
      <Style>
        <LineStyle><color>${lineColor}</color><width>${lineWeight}</width></LineStyle>
        <PolyStyle><color>${polyFill}</color><fill>1</fill><outline>1</outline></PolyStyle>
      </Style>`;

            const pt = (c) => coord(c[0], c[1], c.length > 2 ? c[2] : null);

            switch (g.type) {
                case 'Point': {
                    const c = g.coordinates;
                    return `<Placemark><name>${name}</name>${styleXml}<Point><coordinates>${pt(c)}</coordinates></Point></Placemark>`;
                }
                case 'LineString': {
                    const cs = g.coordinates.map(pt).join(' ');
                    return `<Placemark><name>${name}</name>${styleXml}<LineString><tessellate>1</tessellate><coordinates>${cs}</coordinates></LineString></Placemark>`;
                }
                case 'Polygon': {
                    const outer = (g.coordinates[0] || []).map(pt).join(' ');
                    const inner = (g.coordinates.slice(1) || []).map(ring =>
                        `<innerBoundaryIs><LinearRing><coordinates>${ring.map(pt).join(' ')}</coordinates></LinearRing></innerBoundaryIs>`
                    ).join('');
                    return `<Placemark><name>${name}</name>${styleXml}<Polygon><outerBoundaryIs><LinearRing><coordinates>${outer}</coordinates></LinearRing></outerBoundaryIs>${inner}</Polygon></Placemark>`;
                }
                case 'MultiLineString': {
                    return g.coordinates.map((ls, i) => {
                        const cs = ls.map(pt).join(' ');
                        return `<Placemark><name>${name} (${i + 1})</name>${styleXml}<LineString><tessellate>1</tessellate><coordinates>${cs}</coordinates></LineString></Placemark>`;
                    }).join('');
                }
                case 'MultiPolygon': {
                    return g.coordinates.map((poly, i) => {
                        const outer = (poly[0] || []).map(pt).join(' ');
                        const inner = (poly.slice(1) || []).map(ring =>
                            `<innerBoundaryIs><LinearRing><coordinates>${ring.map(pt).join(' ')}</coordinates></LinearRing></innerBoundaryIs>`
                        ).join('');
                        return `<Placemark><name>${name} (${i + 1})</name>${styleXml}<Polygon><outerBoundaryIs><LinearRing><coordinates>${outer}</coordinates></LinearRing></outerBoundaryIs>${inner}</Polygon></Placemark>`;
                    }).join('');
                }
                default:
                    return ''; // 其他幾何可自行擴充
            }
        }

        const title = esc(payload?.project?.title || 'My 360 Map');
        const doc =
            `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${title}</name>

    <!-- 圖示樣式：一般相片 / 360 相片 -->
    <Style id="photo">
      <IconStyle>
        <scale>1.1</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/camera.png</href></Icon>
      </IconStyle>
    </Style>
    <Style id="pano">
      <IconStyle>
        <scale>1.2</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/camera.png</href></Icon>
      </IconStyle>
    </Style>

    <Folder>
      <name>Photos</name>
      ${photoPlacemarks(payload?.photos || [])}
    </Folder>

    ${annotationsKml(payload?.annotations)}
  </Document>
</kml>`;

        return doc;
    }

    async function buildKMZZip(payload) {
        const zip = new JSZip();

        // —— 安全檔名 & 去重 —— //
        function safeWinName(raw = 'image', fallbackExt = '.jpg') {
            let base = (raw || 'image').split(/[\\/]/).pop();
            base = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
                .replace(/\s+$/g, '')
                .replace(/\.+$/g, '');
            if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(base)) base = '_' + base;
            if (!/\.[^.]+$/.test(base)) base += fallbackExt;
            if (base.length > 180) {
                const m = base.match(/^(.*?)(\.[^.]+)?$/);
                const stem = (m && m[1]) || 'image';
                const ext = (m && m[2]) || fallbackExt;
                base = stem.slice(0, 180 - ext.length) + ext;
            }
            return base || ('image' + fallbackExt);
        }
        const used = new Set();
        const uniq = (name) => {
            let n = name, i = 1;
            while (used.has(n.toLowerCase())) {
                const m = n.match(/^(.*?)(\.[^.]+)?$/);
                n = `${m[1]}_${i}${m[2] || ''}`; i++;
            }
            used.add(n.toLowerCase());
            return n;
        };

        // —— 準備照片：抽出 base64 -> KMZ 的 files/ 目錄 —— //
        const filesFolder = zip.folder('files');
        const photos = (payload.photos || []).map(p => ({ ...p })); // 複製避免汙染原物件

        for (const p of photos) {
            if (!p.src) continue; // 沒圖就跳過
            const extGuess = /\.png$/i.test(p.name) ? '.png' : '.jpg';
            const safe = uniq(safeWinName(p.name || p.id || 'image', extGuess));
            p.assetName = safe;

            // 從 dataURL 取出 base64 並寫入 KMZ
            const base64 = p.src.split(',')[1] || '';
            filesFolder.file(safe, base64, { base64: true });

            // KMZ 裡不需要再存 dataURL/縮圖，瘦身
            delete p.src;
            if (p.thumbnail) delete p.thumbnail;
        }

        // —— 產生 KML（引用相對路徑 files/<assetName>） —— //
        const payload2 = { ...payload, photos };
        const kml = buildKMLForKMZ(payload2);

        // KMZ 慣例：主檔名叫 doc.kml
        zip.file('doc.kml', kml);

        // —— 打包 KMZ —— //
        const blob = await zip.generateAsync({ type: 'blob' });
        return blob;
    }

    function buildKMLForKMZ(payload) {
        const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const coord = (lng, lat, alt = null, prec = 6) => {
            const f = n => (typeof n === 'number' ? n.toFixed(prec) : '');
            return `${f(lng)},${f(lat)}${(alt != null ? ',' + Number(alt).toFixed(1) : '')}`;
        };

        const photoPlacemarks = (photos = []) => photos
            .filter(ph => ph.lat != null && ph.lng != null)
            .map(ph => {
                const is360 = (ph.type === 'photo360');
                const when = ph.capturedAt ? `<TimeStamp><when>${esc(ph.capturedAt)}</when></TimeStamp>` : '';
                const imgHref = ph.assetName ? `files/${esc(ph.assetName)}` : null;

                const desc = `
        <div><b>${esc(ph.title || ph.name || (is360 ? '360 Photo' : 'Photo'))}</b></div>
        ${ph.description ? `<div>${esc(ph.description)}</div>` : ''}
        ${imgHref ? `<div><img src="${imgHref}" style="max-width:380px;max-height:280px;"/></div>` : ''}
        ${(ph.tags && ph.tags.length) ? `<div>#${ph.tags.map(esc).join(' #')}</div>` : ''}
        ${ph.author ? `<div>作者：${esc(ph.author)}</div>` : ''}
        ${ph.license ? `<div>授權：${esc(ph.license)}</div>` : ''}
        ${is360 ? `<div>（360°：KML 僅地標/PhotoOverlay 呈現，無網頁檢視器）</div>` : ''}
      `.replace(/\s+/g, ' ').trim();

                const ext = [
                    ['id', ph.id], ['type', ph.type], ['bearing', ph.bearing],
                    ['yaw', ph.yaw], ['pitch', ph.pitch], ['width', ph.width],
                    ['height', ph.height], ['tags', (ph.tags || []).join(',')],
                    ['author', ph.author], ['license', ph.license]
                ].map(([k, v]) => v != null && v !== '' ? `<Data name="${esc(k)}"><value>${esc(v)}</value></Data>` : '').join('');

                const headingStyle = (typeof ph.bearing === 'number')
                    ? `<Style><IconStyle><heading>${Math.round(clamp(ph.bearing, 0, 359.9))}</heading></IconStyle></Style>`
                    : '';

                return `
        <Placemark>
          <name>${esc(ph.title || ph.name || (is360 ? '360 Photo' : 'Photo'))}</name>
          <styleUrl>#${is360 ? 'pano' : 'photo'}</styleUrl>
          ${when}
          <ExtendedData>${ext}</ExtendedData>
          <description><![CDATA[${desc}]]></description>
          ${headingStyle}
          <Point><coordinates>${coord(ph.lng, ph.lat, ph.alt)}</coordinates></Point>
        </Placemark>`;
            }).join('\n');

        // 另外輸出 360 的 PhotoOverlay（Google Earth 支援時可用）
        const panoOverlays = (photos = []) => photos
            .filter(ph => ph.type === 'photo360' && ph.lat != null && ph.lng != null && ph.assetName)
            .map(ph => {
                const heading = Number.isFinite(ph.bearing) ? Math.round(clamp(ph.bearing, 0, 359.9)) : 0;
                return `
        <PhotoOverlay>
          <name>${esc(ph.title || ph.name || 'Panorama')}</name>
          <Camera>
            <longitude>${ph.lng}</longitude>
            <latitude>${ph.lat}</latitude>
            <altitude>0</altitude>
            <heading>${heading}</heading>
            <tilt>${Number.isFinite(ph.pitch) ? ph.pitch : 0}</tilt>
            <roll>0</roll>
          </Camera>
          <Icon><href>files/${esc(ph.assetName)}</href></Icon>
          <Point><coordinates>${coord(ph.lng, ph.lat)}</coordinates></Point>
          <ViewVolume>
            <leftFov>-90</leftFov><rightFov>90</rightFov>
            <bottomFov>-45</bottomFov><topFov>45</topFov>
            <near>1</near>
          </ViewVolume>
        </PhotoOverlay>`;
            }).join('\n');

        // GeoJSON 標註 → KML（簡化版）
        function annotationsKml(gj) {
            if (!gj || !Array.isArray(gj.features)) return '';
            const pt = (c) => coord(c[0], c[1], c.length > 2 ? c[2] : null);
            const feats = gj.features.map((f, i) => {
                const g = f.geometry; if (!g) return '';
                const name = esc(f.properties?.name || `Feature ${i + 1}`);
                switch (g.type) {
                    case 'Point':
                        return `<Placemark><name>${name}</name><Point><coordinates>${pt(g.coordinates)}</coordinates></Point></Placemark>`;
                    case 'LineString':
                        return `<Placemark><name>${name}</name><LineString><tessellate>1</tessellate><coordinates>${g.coordinates.map(pt).join(' ')}</coordinates></LineString></Placemark>`;
                    case 'Polygon': {
                        const outer = (g.coordinates[0] || []).map(pt).join(' ');
                        const inner = (g.coordinates.slice(1) || []).map(r => `<innerBoundaryIs><LinearRing><coordinates>${r.map(pt).join(' ')}</coordinates></LinearRing></innerBoundaryIs>`).join('');
                        return `<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${outer}</coordinates></LinearRing></outerBoundaryIs>${inner}</Polygon></Placemark>`;
                    }
                    default: return '';
                }
            }).join('\n');
            return feats ? `<Folder><name>Annotations</name>${feats}</Folder>` : '';
        }

        const title = esc(payload?.project?.title || 'My 360 Map');
        return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${title}</name>

    <!-- 基本圖示樣式 -->
    <Style id="photo">
      <IconStyle>
        <scale>1.1</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/camera.png</href></Icon>
      </IconStyle>
    </Style>
    <Style id="pano">
      <IconStyle>
        <scale>1.2</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/camera.png</href></Icon>
      </IconStyle>
    </Style>

    <Folder>
      <name>Photos</name>
      ${photoPlacemarks(payload.photos || [])}
    </Folder>
    ${annotationsKml(payload.annotations)}
  </Document>
</kml>`;
    }

    /*** —— UI：從網址加入 —— ***/
    el('btnAddUrl').addEventListener('click', async () => {
        const url = prompt('輸入圖片網址（JPEG/PNG，360 請為 2:1）：');
        if (!url) return;
        try {
            const res = await fetch(url); const blob = await res.blob();
            const file = new File([blob], url.split('/')?.pop() || 'remote.jpg', { type: blob.type || 'image/jpeg' });
            await addPhotoFromFile(file);
            updateStatus(); renderPhotoList();
        } catch (err) { alert('加入失敗：' + err.message); }
    });

    // 初次渲染
    renderPhotoList(); updateStatus();
})();

(() => {
  const SECTION_IDS = [
    'uploadSection',  // 上傳與匯入
    'filtersSection', // 搜尋 / 篩選
    'batchSection',   // 批次操作
    'detailSection',  // 資訊面板（選一張）
    'exportSection'   // 輸出 / 分享
  ];
  const PREF_KEY = 'photoapp.sectionCollapsed';

  // 讀取偏好
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); }
  catch { prefs = {}; }

  const savePrefs = () =>
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));

  // 依展開/收起狀態更新箭頭
  function setCollapsed(sectionEl, collapsed, id, btn) {
    if (collapsed) {
      sectionEl.setAttribute('data-collapsed', 'true');
      if (btn) btn.textContent = '▶';       // 收起時：向右箭頭
      if (btn) btn.setAttribute('aria-expanded', 'false');
      prefs[id] = true;
    } else {
      sectionEl.removeAttribute('data-collapsed');
      if (btn) btn.textContent = '▼';       // 展開時：向下箭頭
      if (btn) btn.setAttribute('aria-expanded', 'true');
      prefs[id] = false;
    }
    savePrefs();
  }

  SECTION_IDS.forEach((id) => {
    const sectionEl = document.getElementById(id);
    if (!sectionEl) return;

    const header = sectionEl.querySelector('h2');
    if (!header) return;

    // 右側箭頭按鈕（無背景）
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'section-toggle';
    btn.setAttribute('aria-label', '切換收合');
    btn.textContent = '▼'; // 預設先視為展開
    btn.setAttribute('aria-expanded', 'true');
    header.appendChild(btn);

    // 初始化（若有記錄，套用）
    const initialCollapsed = !!prefs[id];
    setCollapsed(sectionEl, initialCollapsed, id, btn);

    const toggle = () => {
      const isCollapsed = sectionEl.getAttribute('data-collapsed') === 'true';
      setCollapsed(sectionEl, !isCollapsed, id, btn);
    };

    // 點整個 h2 可收合（避免按鈕被點時觸發兩次）
    header.addEventListener('click', (e) => {
      if (e.target === btn) return; // 交給按鈕自己的 handler
      toggle();
    });

    // 點箭頭按鈕也可收合
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });

    // 鍵盤可用：h2 可聚焦，Enter/Space 觸發
    header.tabIndex = 0;
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });
})();