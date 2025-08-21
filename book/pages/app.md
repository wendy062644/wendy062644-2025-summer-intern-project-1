---
title: 成果展示
---

# 成果展示

<div style="margin-bottom: 1em;">
  <button onclick="loadLocal()" style="padding:8px 16px; margin-right:8px; border-radius:6px; border:1px solid #ccc; cursor:pointer;">
    本地html(不需網路)
  </button>
  <button onclick="loadOnline()" style="padding:8px 16px; border-radius:6px; border:1px solid #ccc; cursor:pointer;">
    外部連結(github)
  </button>
</div>

<div class="embed-wrap">
  <iframe
    id="demoFrame"
    src="../sites/index.html"
    width="100%" height="600px"
    style="border:none;"
    sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox"
  ></iframe>
</div>

<script>
function loadLocal() {
  document.getElementById("demoFrame").src = "../sites/index.html";
}
function loadOnline() {
  document.getElementById("demoFrame").src = "https://wendy062644.github.io/picture_with_map/index.html";
}
</script>

<style>
.bd-sidebar-secondary {
  display: none !important;
}

.bd-content {
  max-width: 100% !important;
}

.bd-article-container {
  max-width: 100% !important;
  width: 100% !important;
}

.tex2jax_ignore.mathjax_ignore {
  max-width: 100% !important;
  width: 100% !important;
}
</style>