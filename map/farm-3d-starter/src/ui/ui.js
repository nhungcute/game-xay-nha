import {TYPES} from '../systems/ConstructionSystem.js';
export function renderShell(){
 document.querySelector('#app').innerHTML=`
  <div id="viewport" aria-label="Interactive 3D world"><canvas id="game-canvas"></canvas></div>
  <header class="topbar"><div class="brand"><span class="brand-mark">✳</span><span><strong>WILDLANDS</strong><small>THREE-DIMENSIONAL WORLD BUILDER</small></span></div>
   <div class="world-heading"><span class="eyebrow">WORLD 01 · STARTER WORLD</span><strong id="world-name">Whispering Valley</strong></div>
   <div class="top-actions"><span id="world-type" class="world-chip">FARM WORLD</span><button class="ui-button icon-button" data-action="help" title="Controls & help">?</button></div></header>
  <aside class="left-rail"><span class="rail-heading">MAP VIEW</span>
   <button class="rail-btn active" data-action="iso" title="Isometric camera">◈ <small>ISO</small></button>
   <button class="rail-btn" data-action="top" title="Top-down camera">▦ <small>TOP</small></button>
   <button class="rail-btn" data-action="resetCamera" title="Reset camera">◎ <small>RESET</small></button>
   <div class="rail-separator"></div>
   <button class="rail-btn" data-action="toggleZones" id="zones-button" title="Outline available parcels">▣ <small>LOTS</small></button>
  </aside>
  <aside class="inspector panel" id="inspector"><div class="inspector-top"><span class="tiny-label">LAND INSPECTOR</span><span class="inspector-indicator">● LIVE</span></div>
    <div id="parcel-badge" class="parcel-badge">SELECT A PARCEL</div><h2 id="parcel-name">Your empty canvas</h2>
    <p id="parcel-description">Tap an open meadow to inspect its buildable area. No buildings have been placed yet.</p>
    <div class="stats"><div><span>BUILDABLE LOTS</span><strong id="lot-count">14</strong></div><div><span>STRUCTURES</span><strong id="structure-count">0</strong></div></div>
    <div class="parcel-meta" id="parcel-meta">Choose a parcel to see its unique ID and size.</div>
  </aside>
  <div class="map-hint" id="map-hint"><span class="mouse-icon">✥</span> Drag to orbit <b>·</b> Right-drag to pan <b>·</b> Scroll to zoom</div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <div class="toolbar"><div class="toolbar-label">BUILD TOOLS <span id="mode-label">SELECT</span></div>
   <div class="toolbar-row">
    <button data-tool="select" class="tool-btn active"><span class="tool-icon">⌖</span><strong>Inspect</strong><small>Select land</small></button>
    <button data-tool="crop" class="tool-btn"><span class="tool-icon">✿</span><strong>Crops</strong><small>5 × 5</small></button>
    <button data-tool="barn" class="tool-btn"><span class="tool-icon">▣</span><strong>Barn</strong><small>10 × 8</small></button>
    <button data-tool="cottage" class="tool-btn"><span class="tool-icon">⌂</span><strong>Cottage</strong><small>8 × 7</small></button>
    <button data-tool="tree" class="tool-btn"><span class="tool-icon">♣</span><strong>Fruit tree</strong><small>4 × 4</small></button>
    <div class="toolbar-divider"></div>
    <button data-action="rotateBuild" class="tool-btn mini"><span class="tool-icon">↻</span><strong>Rotate</strong><small>R key</small></button>
   </div>
   <div class="toolbar-footer"><span id="build-status">Choose a tool, then click a suitable lot.</span><button data-action="save" class="text-btn">Save</button><button data-action="load" class="text-btn">Load</button><button data-action="export" class="text-btn">Export</button><button data-action="import" class="text-btn">Import</button></div>
  </div>
  <div id="system-stats" class="perf-readout">LOADING TERRAIN...</div>
  <input id="import-file" type="file" accept="application/json,.json" hidden />
  <div id="help-modal" class="modal-backdrop" hidden><div class="modal panel"><button data-action="closeHelp" class="modal-close">×</button><div class="tiny-label">WELCOME TO YOUR WORLD</div><h2>A real, editable 3D landscape.</h2>
   <p>This scene uses triangulated terrain, animated water surfaces and instanced 3D GLB trees — not a background photo. Orbit to see the world from any angle.</p>
   <p><b>Desktop:</b> left-drag orbit, right-drag pan, scroll zoom. Click a parcel to inspect it. Choose a build tool and click to place a construction. Press <kbd>R</kbd> to rotate, <kbd>Esc</kbd> to inspect.</p>
   <p><b>Mobile:</b> one-finger orbit; pinch with two fingers to zoom and move the view. Tap to select or build.</p>
   <p>Save / Load persists to this browser. Export / Import uses portable JSON. Switch worlds with <code>?world=farm</code>, <code>?world=city</code> or <code>?world=eco</code>.</p>
   <button data-action="closeHelp" class="primary-btn">EXPLORE THE MAP ↗</button></div></div>
 `;
}
export function toast(message,alert=false){let node=document.querySelector('#toast');node.textContent=message;node.classList.add('visible');node.classList.toggle('error',alert);clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>node.classList.remove('visible'),3600);}
export function setMode(mode){document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===(mode||'select')));document.querySelector('#mode-label').textContent=mode?TYPES[mode].label.toUpperCase():'SELECT';document.querySelector('#build-status').textContent=mode?'Move over a lot to preview placement. Press R to rotate.':'Choose a tool, then click a suitable lot.';}
export function inspect(parcel,info){
 document.querySelector('#parcel-badge').textContent=info?info.id:'SELECT A PARCEL';document.querySelector('#parcel-name').textContent=info?info.name:'Your empty canvas';
 document.querySelector('#parcel-description').textContent=info?`An undeveloped ${info.type} parcel, ready for future construction.`:'Tap an open meadow to inspect its buildable area. No buildings have been placed yet.';
 document.querySelector('#parcel-meta').textContent=info?`${info.area.toLocaleString()} m² · ${info.type.toUpperCase()} · ${info.id}`:'Choose a parcel to see its unique ID and size.';
}
