---
title: 軟體介紹
---

# 介紹

- **名稱**：相片地圖編輯器（Photo/Map Editor）
- **定位**：以 HTML/JS/CSS 製作的地圖與相片可視化工具，支援 360 相片、KML、KMZ...等格式
- **整合**：與 Jupyter Book 搭配，紀錄與成果展示

## 特色
- **免安裝、操作容易**：在瀏覽器上即可使用，學習門檻低
- **地圖 + 影像**：群聚地標、手繪標註（點/線/面）、360 相片檢視
- **資料匯入**：照片（JPEG/PNG/HEIC），GPX / KML / KMZ / GeoJSON / CSV
- **匯出分享**：可輸出成 HTML、ZIP、KML、KMZ（KML+照片）...等格式，與他人分享旅遊軌跡
- **隱私選項**：座標小數點調整、是否移除 EXIF、是否包含原圖

```{admonition} 系統組成（Libraries）
:class: note
Leaflet（地圖）、MarkerCluster（聚合）、Leaflet.Draw（繪製）、Pannellum（360 相片）、exifr（EXIF/XMP）、toGeoJSON（KML/GPX 轉換）、JSZip + FileSaver（打包下載）、libheif/heic2any（HEIC 轉檔）。