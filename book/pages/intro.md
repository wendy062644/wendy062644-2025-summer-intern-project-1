---
title: 軟體介紹
---

# 軟體介紹

- **名稱**：相片地圖編輯器（Photo/Map Editor）
- **定位**：以 HTML/JS/CSS 製作的地圖與相片可視化工具，支援 360 相片、軌跡/圖徵匯入、EXIF/XMP 解析與多種匯出格式
- **整合**：與 Jupyter Book 搭配，適合教學、紀錄與成果展示

## 特色一覽
- **免安裝、可離線**：瀏覽器即可使用，打包成單一 HTML 或靜態網站包後可直接開啟
- **地圖 + 影像**：群聚地標、手繪標註（點/線/面）、360 相片檢視
- **資料匯入**：照片（JPEG/PNG/HEIC），GPX / KML / KMZ / GeoJSON / CSV
- **時間對齊**：用軌跡時間戳對齊相片位置
- **匯出分享**：單一 HTML、靜態網站 ZIP、KML、KMZ（KML+照片）
- **隱私選項**：座標小數位數調整、是否移除 EXIF、是否包含原圖
- **易擴充**：模組化程式架構、標準前端技術棧

```{admonition} 系統組成（前端 Libraries）
:class: note
Leaflet（地圖）、MarkerCluster（聚合）、Leaflet.Draw（繪製）、Pannellum（360 相片）、exifr（EXIF/XMP）、toGeoJSON（KML/GPX 轉換）、JSZip + FileSaver（打包下載）、libheif/heic2any（HEIC 轉檔）。