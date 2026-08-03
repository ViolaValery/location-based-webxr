import{A as e,C as t,M as n,N as r,O as i,P as a,S as o,T as s,_ as c,a as l,b as u,c as d,d as f,f as p,g as m,h,l as g,m as _,n as v,o as y,p as b,r as x,s as S,t as C,u as w,v as T,w as E,x as D}from"./feature-scene-registry-CLDJ4zw1.js";var O=class{host;scene=new n;featureRoot=new E;overlayRoot=new E;camera=new i(50,1,.1,1e5);renderer;controls;frameId=null;resizeObserver;disposed=!1;constructor(e){this.host=e,this.scene.background=new D(1053466),this.scene.add(this.featureRoot,this.overlayRoot,new s(16777215,2502720,2));let n=new o(16777215,2),r=new t(1e3,500,5138314,2437700);r.position.y=-.01,this.scene.add(n,r),this.camera.position.set(120,120,120),this.renderer=new T({antialias:!0}),this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),this.renderer.domElement.setAttribute(`aria-label`,`3D KML preview`),this.host.appendChild(this.renderer.domElement),this.controls=new v(this.camera,this.renderer.domElement),this.controls.enableDamping=!0,this.controls.maxDistance=5e4,this.resizeObserver=new ResizeObserver(()=>this.resize()),this.resizeObserver.observe(e),this.resize(),this.renderLoop()}focusOn(e){let t=new u().setFromObject(e);if(t.isEmpty())return;let n=t.getCenter(new a),r=t.getSize(new a),i=Math.max(r.x,r.y,r.z,5),o=new a(i*1.8,i*1.8,i*1.8);this.controls.target.copy(n),this.camera.position.copy(n).add(o),this.controls.update()}setZoomDistance(e){let t=new a().subVectors(this.camera.position,this.controls.target);t.lengthSq()===0&&t.set(1,1,1),t.normalize();let n=Math.max(2,Math.min(e,5e4));this.camera.position.copy(this.controls.target).addScaledVector(t,n),this.controls.update()}getZoomDistance(){return this.camera.position.distanceTo(this.controls.target)}resize(){let e=Math.max(1,this.host.clientWidth),t=Math.max(1,this.host.clientHeight);this.camera.aspect=e/t,this.camera.updateProjectionMatrix(),this.renderer.setSize(e,t,!1)}dispose(){this.disposed||(this.disposed=!0,this.frameId!==null&&cancelAnimationFrame(this.frameId),this.resizeObserver.disconnect(),this.controls.dispose(),this.renderer.dispose(),this.renderer.domElement.remove())}renderLoop=()=>{this.disposed||(this.frameId=requestAnimationFrame(this.renderLoop),this.controls.update(),this.renderer.render(this.scene,this.camera))}},k={getAssetUrl:async e=>e,release:()=>{},getAssetBytes:async()=>new Uint8Array,hasAsset:()=>!1,dispose:()=>{}},A=class{host;store;persistence;replayHarness=new x;scene;registry;list;message;inspectorContainer;fileInput;nameInput;descriptionInput;spatialFieldsContainer;applyButton;focusButton;deleteButton;undoButton;redoButton;unsubscribe=null;disposed=!1;constructor(e,t=l()){this.host=e,this.store=t,this.persistence=c(),this.host.replaceChildren(),F();let n=document.createElement(`div`);n.className=`kml-editor`;let r=document.createElement(`aside`),i=document.createElement(`main`);i.className=`kml-editor__viewport`,this.message=document.createElement(`p`),this.message.className=`kml-editor__message`,this.message.setAttribute(`role`,`alert`);let a=document.createElement(`div`);a.className=`kml-editor__card`;let o=document.createElement(`label`);o.className=`kml-editor__section-title`,o.textContent=`DOCUMENT SOURCE`,this.fileInput=document.createElement(`input`),this.fileInput.type=`file`,this.fileInput.accept=`.kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz`,this.fileInput.style.display=`none`,this.fileInput.addEventListener(`change`,()=>{let e=this.fileInput.files?.[0];e&&this.openFile(e)});let s=M(`Open KML / KMZ File`,()=>void this.triggerOpen(),`primary`),u=document.createElement(`div`);u.className=`kml-editor__btn-row`,this.undoButton=M(`Undo ↩`,()=>this.store.undo()),this.redoButton=M(`Redo ↪`,()=>this.store.redo()),u.append(this.undoButton,this.redoButton),a.append(o,s,this.fileInput,u);let d=document.createElement(`div`);d.className=`kml-editor__card`;let f=document.createElement(`label`);f.className=`kml-editor__section-title`,f.textContent=`FEATURES`,this.list=document.createElement(`ul`),this.list.className=`kml-editor__feature-list`,this.list.setAttribute(`aria-label`,`KML features`),d.append(f,this.list),this.inspectorContainer=document.createElement(`div`),this.inspectorContainer.className=`kml-editor__card`;let p=document.createElement(`label`);p.className=`kml-editor__section-title`,p.textContent=`PROPERTY INSPECTOR`,this.nameInput=document.createElement(`input`),this.nameInput.placeholder=`Feature name`,this.descriptionInput=document.createElement(`textarea`),this.descriptionInput.placeholder=`Feature description`,this.spatialFieldsContainer=document.createElement(`div`),this.spatialFieldsContainer.className=`kml-editor__spatial-fields`;let h=document.createElement(`div`);h.className=`kml-editor__btn-row`,this.applyButton=M(`Apply properties`,()=>this.applyProperties(),`primary`),this.focusButton=M(`Focus in 3D 🎯`,()=>this.focusSelected()),this.deleteButton=M(`Delete`,()=>this.deleteSelected(),`danger`),h.append(this.applyButton,this.focusButton,this.deleteButton),this.inspectorContainer.append(p,N(`Name`,this.nameInput),N(`Description`,this.descriptionInput),this.spatialFieldsContainer,h);let g=document.createElement(`div`);g.className=`kml-editor__card`;let _=document.createElement(`label`);_.className=`kml-editor__section-title`,_.textContent=`REPLAY WALK (TASK 1)`;let v=document.createElement(`select`);v.style.width=`100%`,[{label:`Walk 1 (13:58:24 UTC)`,url:`../../fixtures/recordings/2026-06-24_13-58-24utc.zip`},{label:`Walk 2 (13:54:45 UTC)`,url:`../../fixtures/recordings/2026-06-24_13-54-45utc.zip`},{label:`Walk 3 (13:56:01 UTC)`,url:`../../fixtures/recordings/2026-06-24_13-56-01utc.zip`},{label:`Walk 4 (14:04:36 UTC)`,url:`../../fixtures/recordings/2026-06-24_14-04-36utc.zip`},{label:`Walk 5 (14:09:28 UTC)`,url:`../../fixtures/recordings/2026-06-24_14-09-28utc.zip`},{label:`Walk 6 (14:12:35 UTC)`,url:`../../fixtures/recordings/2026-06-24_14-12-35utc.zip`},{label:`Walk 7 (14:19:00 UTC)`,url:`../../fixtures/recordings/2026-06-24_14-19-00utc.zip`},{label:`InfoWalk 1 (13:52:34 UTC)`,url:`../../fixtures/recordings/InfoWalk/2026-06-24_13-52-34utc.zip`},{label:`InfoWalk 2 (13:56:51 UTC)`,url:`../../fixtures/recordings/InfoWalk/2026-06-24_13-56-51utc.zip`},{label:`InfoWalk 3 (14:04:16 UTC)`,url:`../../fixtures/recordings/InfoWalk/2026-06-24_14-04-16utc.zip`},{label:`InfoWalk 4 (14:08:42 UTC)`,url:`../../fixtures/recordings/InfoWalk/2026-06-24_14-08-42utc.zip`},{label:`InfoWalk 5 (14:12:17 UTC)`,url:`../../fixtures/recordings/InfoWalk/2026-06-24_14-12-17utc.zip`},{label:`InfoWalk 6 (14:17:01 UTC)`,url:`../../fixtures/recordings/InfoWalk/2026-06-24_14-17-01utc.zip`}].forEach(e=>{let t=document.createElement(`option`);t.value=e.url,t.textContent=e.label,v.appendChild(t)});let y=document.createElement(`input`);y.type=`file`,y.accept=`.zip`,y.style.display=`none`;let b=M(`Upload Local Walk .ZIP`,()=>y.click()),x=document.createElement(`span`);x.style.fontSize=`0.8rem`,x.style.color=`#8ea1c0`,x.textContent=`Status: Idle`;let S=async e=>{this.replayHarness.attach(this.scene,this.store.geoBridge),x.textContent=`Loading recording...`;try{let t;if(typeof e==`string`){let n=await fetch(e);if(!n.ok)throw Error(`HTTP `+n.status);t=await n.arrayBuffer()}else t=await e.arrayBuffer();x.textContent=`Loaded ${await this.replayHarness.loadZip(t)} samples`,this.replayHarness.play(2)}catch{x.textContent=`Failed to load recording ZIP`}};y.addEventListener(`change`,()=>{let e=y.files?.[0];e&&S(e)}),v.addEventListener(`change`,()=>{this.replayHarness.stop(),S(v.value)});let w=document.createElement(`div`);w.className=`kml-editor__btn-row`;let T=M(`Play Replay ▶`,async()=>{this.replayHarness.getSamples().length===0?await S(v.value):this.replayHarness.play(2)}),E=M(`Pause ❚❚`,()=>{this.replayHarness.pause()});this.replayHarness.onStateChange(e=>{x.textContent=`Status: ${e}`}),this.replayHarness.onSampleChange((e,t)=>{x.textContent=`Step ${t+1}/${this.replayHarness.getSamples().length}`}),w.append(T,E),g.append(_,N(`Walk Recording`,v),b,y,w,x),r.append(a,this.message,d,this.inspectorContainer,g),n.append(r,i),this.host.appendChild(n),this.scene=new O(i),this.registry=new C(this.scene.featureRoot,new m),this.scene.renderer.domElement.addEventListener(`pointerdown`,e=>this.pick(e));let D=document.createElement(`div`);D.className=`kml-editor__zoom-control`,D.innerHTML=`<span style="font-weight:bold;font-size:0.9rem;">+</span><input type="range" min="0.3" max="4.7" step="0.01" value="2.5" class="kml-editor__zoom-slider" title="Zoom in / out"><span style="font-weight:bold;font-size:0.9rem;">−</span>`,i.appendChild(D);let A=D.querySelector(`input`);A.addEventListener(`input`,()=>{let e=10**(5-Number(A.value));this.scene.setZoomDistance(e)}),this.scene.controls.addEventListener(`change`,()=>{let e=this.scene.getZoomDistance();A.value=(5-Math.log10(Math.max(2,e))).toFixed(2)}),this.unsubscribe=this.store.subscribe(e=>{let t=this.store.document,n=t?t.getFeatures():[],r=this.store.container,i=r?r.getAssetProvider():k;this.undoButton.disabled=!e.canUndo,this.redoButton.disabled=!e.canRedo,this.render(n,i,e.selectedFeatureId)}),this.persistence.onStatusChange(e=>{e===`saving`?this.setMessage(`Auto-saving changes to disk…`):e===`saved`?this.setMessage(`All changes auto-saved to file.`):e===`error`&&this.setMessage(`Auto-save failed.`)})}async triggerOpen(){if(this.persistence.hasNativeFileAccess){this.setMessage(`Opening file handle…`);try{let e=await this.persistence.open();await this.store.loadContainer(e),this.setMessage(`Opened '${this.persistence.fileName}'. All edits auto-save directly to disk.`)}catch(e){if(e instanceof Error&&(e.name===`AbortError`||e.message.includes(`aborted`)))return;this.fileInput.click()}}else this.fileInput.click()}async openFile(e){if(!/\.kml|\.kmz$/i.test(e.name)){this.setMessage(`Choose a .kml or .kmz file.`);return}this.setMessage(`Loading…`);try{let t=await this.persistence.open(e);await this.store.loadContainer(t),this.setMessage(`Loaded '${e.name}'. All edits automatically auto-save.`)}catch(e){this.setMessage(e instanceof Error?e.message:`Could not load the file.`)}}dispose(){this.disposed||(this.disposed=!0,this.unsubscribe?.(),this.unsubscribe=null,this.replayHarness.dispose(),this.registry.dispose(),this.scene.dispose(),this.persistence.dispose(),this.host.replaceChildren())}async render(e,t,n){if(this.disposed){this.list.replaceChildren();return}try{await this.registry.reconcile(e,t,this.store.geoBridge)}catch(e){this.setMessage(e instanceof Error?`Preview warning: ${e.message}`:`Preview warning.`)}this.list.replaceChildren(...e.map(e=>{let t=document.createElement(`li`),r=document.createElement(`button`);return r.type=`button`,r.className=`kml-editor__feature-item ${e.id===n?`selected`:``}`,r.innerHTML=`
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:600; font-size:0.85rem;">${e.name||`(unnamed)`}</span>
                    <span class="kml-editor__badge ${e.type}">${e.type}</span>
                </div>
                <div style="font-size:0.7rem; color:#8a99ad; margin-top:0.2rem; font-family:monospace;">ID: ${e.id}</div>
            `,r.addEventListener(`click`,()=>this.store.selectFeature(e.id===n?null:e.id)),t.appendChild(r),t}));let r=n?e.find(e=>e.id===n)??null:null;this.nameInput.value=r?.name??``,this.descriptionInput.value=r?.description??``,this.updateSpatialInputs(r)}updateSpatialInputs(e){if(this.spatialFieldsContainer.replaceChildren(),!e){this.nameInput.disabled=!0,this.descriptionInput.disabled=!0,this.applyButton.disabled=!0,this.focusButton.disabled=!0,this.deleteButton.disabled=!0;return}this.nameInput.disabled=!1,this.descriptionInput.disabled=!1,this.applyButton.disabled=!1,this.focusButton.disabled=!1,this.deleteButton.disabled=!1;let t=document.createElement(`label`);if(t.className=`kml-editor__section-title`,t.textContent=`GEOMETRY / SPATIAL (${e.type.toUpperCase()})`,this.spatialFieldsContainer.appendChild(t),e.type===`marker`){let t=e.position||{lon:0,lat:0,alt:0},n=P(`lon`,t.lon,1e-6),r=P(`lat`,t.lat,1e-6),i=P(`alt`,t.alt,.1);this.spatialFieldsContainer.append(N(`Longitude (°)`,n),N(`Latitude (°)`,r),N(`Altitude (m)`,i))}else if(e.type===`line`)(e.coordinates||[]).forEach((e,t)=>{let n=document.createElement(`div`);n.className=`kml-editor__vertex-row`;let r=document.createElement(`span`);r.textContent=`V${t+1}`,r.style.fontWeight=`bold`,r.style.fontSize=`0.75rem`;let i=P(`v${t}_lon`,e.lon,1e-6),a=P(`v${t}_lat`,e.lat,1e-6),o=P(`v${t}_alt`,e.alt,.1);n.append(r,i,a,o),this.spatialFieldsContainer.appendChild(n)});else if(e.type===`ground-overlay`){let t=e,n=t.latLonBox||{north:0,south:0,east:0,west:0,rotation:0},r=P(`north`,n.north,1e-6),i=P(`south`,n.south,1e-6),a=P(`east`,n.east,1e-6),o=P(`west`,n.west,1e-6),s=P(`rotation`,n.rotation||0,1),c=P(`altitude`,t.altitude||0,.1);this.spatialFieldsContainer.append(N(`North (°)`,r),N(`South (°)`,i),N(`East (°)`,a),N(`West (°)`,o),N(`Rotation (°)`,s),N(`Altitude (m)`,c))}else if(e.type===`model`){let t=e,n=t.location||{lon:0,lat:0,alt:0},r=t.orientation||{heading:0,tilt:0,roll:0},i=t.scale||{x:1,y:1,z:1},a=P(`lon`,n.lon,1e-6),o=P(`lat`,n.lat,1e-6),s=P(`alt`,n.alt,.1),c=P(`heading`,r.heading,1),l=P(`tilt`,r.tilt,1),u=P(`roll`,r.roll,1),d=P(`scaleX`,i.x,.1),f=P(`scaleY`,i.y,.1),p=P(`scaleZ`,i.z,.1);this.spatialFieldsContainer.append(N(`Longitude (°)`,a),N(`Latitude (°)`,o),N(`Altitude (m)`,s),N(`Heading (°)`,c),N(`Tilt (°)`,l),N(`Roll (°)`,u),N(`Scale X`,d),N(`Scale Y`,f),N(`Scale Z`,p))}}pick(t){let n=this.scene.renderer.domElement.getBoundingClientRect(),i=new r((t.clientX-n.left)/n.width*2-1,-((t.clientY-n.top)/n.height)*2+1),a=new e;a.setFromCamera(i,this.scene.camera);let o=a.intersectObjects(this.scene.featureRoot.children,!0)[0];this.store.selectFeature(o?this.registry.findFeatureId(o.object):null)}applyProperties(){let e=this.store.selectedFeatureId;if(!e){this.setMessage(`Select a feature first to edit properties.`);return}let t=this.store.document,n=t?t.getFeatureById(e):null;if(!n){this.setMessage(`Selected feature not found in document.`);return}let r=!1;if(this.nameInput.value!==n.name&&(this.store.executeCommand(h(e,this.nameInput.value)),r=!0),this.descriptionInput.value!==n.description&&(this.store.executeCommand(_(e,this.descriptionInput.value)),r=!0),n.type===`marker`){let t=this.spatialFieldsContainer.querySelector(`input[name="lon"]`),i=this.spatialFieldsContainer.querySelector(`input[name="lat"]`),a=this.spatialFieldsContainer.querySelector(`input[name="alt"]`);if(t&&i&&a){let o=parseFloat(t.value),s=parseFloat(i.value),c=parseFloat(a.value),l=n.position;if(o!==l.lon||s!==l.lat||c!==l.alt){let t={lon:o,lat:s,alt:c},n=this.store.geoBridge.geoToWorld(t,`absolute`);this.store.executeCommand(d(e,n)),r=!0}}}else if(n.type===`line`)n.coordinates.forEach((t,n)=>{let i=this.spatialFieldsContainer.querySelector(`input[name="v${n}_lon"]`),a=this.spatialFieldsContainer.querySelector(`input[name="v${n}_lat"]`),o=this.spatialFieldsContainer.querySelector(`input[name="v${n}_alt"]`);if(i&&a&&o){let s=parseFloat(i.value),c=parseFloat(a.value),l=parseFloat(o.value);if(s!==t.lon||c!==t.lat||l!==t.alt){let t={lon:s,lat:c,alt:l},i=this.store.geoBridge.geoToWorld(t,`absolute`);this.store.executeCommand(S(e,n,i)),r=!0}}});else if(n.type===`ground-overlay`){let t=n,i=this.spatialFieldsContainer.querySelector(`input[name="north"]`),a=this.spatialFieldsContainer.querySelector(`input[name="south"]`),o=this.spatialFieldsContainer.querySelector(`input[name="east"]`),s=this.spatialFieldsContainer.querySelector(`input[name="west"]`),c=this.spatialFieldsContainer.querySelector(`input[name="rotation"]`),l=this.spatialFieldsContainer.querySelector(`input[name="altitude"]`);if(i&&a&&o&&s&&c&&l){let n=parseFloat(i.value),u=parseFloat(a.value),d=parseFloat(o.value),f=parseFloat(s.value),m=parseFloat(c.value),h=parseFloat(l.value),g={north:n,south:u,east:d,west:f,rotation:m};(n!==t.latLonBox.north||u!==t.latLonBox.south||d!==t.latLonBox.east||f!==t.latLonBox.west||h!==t.altitude)&&(this.store.executeCommand(w(e,g,h,t.altitudeMode)),r=!0),m!==(t.latLonBox.rotation||0)&&(this.store.executeCommand(p(e,m)),r=!0)}}else if(n.type===`model`){let t=n,i=this.spatialFieldsContainer.querySelector(`input[name="lon"]`),a=this.spatialFieldsContainer.querySelector(`input[name="lat"]`),o=this.spatialFieldsContainer.querySelector(`input[name="alt"]`),s=this.spatialFieldsContainer.querySelector(`input[name="heading"]`),c=this.spatialFieldsContainer.querySelector(`input[name="tilt"]`),l=this.spatialFieldsContainer.querySelector(`input[name="roll"]`),u=this.spatialFieldsContainer.querySelector(`input[name="scaleX"]`),d=this.spatialFieldsContainer.querySelector(`input[name="scaleY"]`),p=this.spatialFieldsContainer.querySelector(`input[name="scaleZ"]`);if(i&&a&&o){let n=parseFloat(i.value),s=parseFloat(a.value),c=parseFloat(o.value);if(n!==t.location.lon||s!==t.location.lat||c!==t.location.alt){let t={lon:n,lat:s,alt:c};this.store.executeCommand(g(e,t)),r=!0}}if(s&&c&&l){let n=parseFloat(s.value),i=parseFloat(c.value),a=parseFloat(l.value);if(n!==t.orientation.heading||i!==t.orientation.tilt||a!==t.orientation.roll){let t={heading:n,tilt:i,roll:a};this.store.executeCommand(f(e,t)),r=!0}}if(u&&d&&p){let n=parseFloat(u.value),i=parseFloat(d.value),a=parseFloat(p.value);if(n!==t.scale.x||i!==t.scale.y||a!==t.scale.z){let t={x:n,y:i,z:a};this.store.executeCommand(b(e,t)),r=!0}}}r?(this.persistence.notifyChange(),this.setMessage(`Feature properties updated. Auto-saving to file…`)):this.setMessage(`No property changes detected.`)}focusSelected(){let e=this.store.selectedFeatureId;if(!e){this.setMessage(`Select a feature first to focus.`);return}let t=this.registry.getObject(e);t?(this.scene.focusOn(t),this.setMessage(`Focused camera on selected feature.`)):this.setMessage(`Feature object not found in 3D scene.`)}deleteSelected(){let e=this.store.selectedFeatureId;e&&(this.store.executeCommand(y(e)),this.persistence.notifyChange(),this.store.selectFeature(null))}setMessage(e){this.message.textContent=e}};function j(e){return new A(e)}function M(e,t,n=`normal`){let r=document.createElement(`button`);return r.type=`button`,r.className=`kml-editor__btn ${n===`normal`?``:`btn-`+n}`,r.textContent=e,r.addEventListener(`click`,t),r}function N(e,t){let n=document.createElement(`div`);n.className=`kml-editor__form-group`;let r=document.createElement(`label`);return r.className=`kml-editor__form-label`,r.textContent=e,n.append(r,t),n}function P(e,t,n=1e-6){let r=document.createElement(`input`);return r.type=`number`,r.name=e,r.value=String(t),r.step=String(n),r.className=`kml-editor__input`,r}function F(){if(document.getElementById(`kml-editor-styles`))return;let e=document.createElement(`style`);e.id=`kml-editor-styles`,e.textContent=`
        .kml-editor {
            display: grid;
            grid-template-columns: 22rem minmax(0, 1fr);
            height: 100%;
            background: #0d0e15;
            color: #f3f4f6;
            font-family: Outfit, Inter, system-ui, sans-serif;
        }
        .kml-editor aside {
            padding: 1.25rem;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 1rem;
            border-right: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(20, 21, 33, 0.85);
        }
        .kml-editor__viewport { position: relative; min-width: 0; min-height: 0; }
        
        .kml-editor__card {
            background: rgba(26, 28, 44, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 1rem;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }

        .kml-editor__section-title {
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: #00b894;
            font-weight: 700;
        }

        .kml-editor__message {
            font-size: 0.8rem;
            color: #ffd08a;
            margin: 0;
            min-height: 1.2rem;
        }

        .kml-editor__feature-list {
            padding: 0;
            margin: 0;
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 0.35rem;
            max-height: 180px;
            overflow-y: auto;
        }

        .kml-editor__feature-item {
            width: 100%;
            text-align: left;
            padding: 0.5rem 0.75rem;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 8px;
            color: #e9edf5;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .kml-editor__feature-item:hover {
            background: rgba(0, 184, 148, 0.1);
            border-color: rgba(0, 184, 148, 0.3);
        }
        .kml-editor__feature-item.selected {
            background: rgba(0, 184, 148, 0.2);
            border-color: #00b894;
        }

        .kml-editor__badge {
            font-size: 0.65rem;
            text-transform: uppercase;
            padding: 0.15rem 0.4rem;
            border-radius: 4px;
            font-weight: 700;
        }
        .kml-editor__badge.marker { background: rgba(0, 184, 148, 0.25); color: #55efc4; }
        .kml-editor__badge.line { background: rgba(9, 132, 227, 0.25); color: #74b9ff; }
        .kml-editor__badge.ground-overlay { background: rgba(253, 203, 110, 0.25); color: #ffeaa7; }
        .kml-editor__badge.model { background: rgba(162, 155, 254, 0.25); color: #a29bfe; }

        .kml-editor__form-group {
            display: flex;
            flex-direction: column;
            gap: 0.3rem;
        }

        .kml-editor__form-label {
            font-size: 0.75rem;
            color: #9ca3af;
            font-weight: 600;
        }

        .kml-editor input[type="text"],
        .kml-editor input[type="number"],
        .kml-editor textarea {
            background: rgba(10, 11, 18, 0.8);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 6px;
            padding: 0.45rem 0.6rem;
            color: #f3f4f6;
            font-family: inherit;
            font-size: 0.82rem;
        }
        .kml-editor input:focus,
        .kml-editor textarea:focus {
            outline: none;
            border-color: #00b894;
            box-shadow: 0 0 0 2px rgba(0, 184, 148, 0.2);
        }

        .kml-editor__vertex-row {
            display: grid;
            grid-template-columns: 2rem 1fr 1fr 1fr;
            gap: 0.3rem;
            align-items: center;
            margin-bottom: 0.3rem;
        }

        .kml-editor__btn-row {
            display: flex;
            gap: 0.4rem;
            flex-wrap: wrap;
        }

        .kml-editor__btn {
            flex: 1;
            padding: 0.5rem 0.75rem;
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.06);
            color: #f3f4f6;
            font-size: 0.8rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .kml-editor__btn:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.12);
        }
        .kml-editor__btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        .kml-editor__btn.btn-primary {
            background: #00b894;
            border-color: #00b894;
            color: #0d0e15;
        }
        .kml-editor__btn.btn-primary:hover:not(:disabled) {
            background: #55efc4;
        }
        .kml-editor__btn.btn-danger {
            background: rgba(214, 48, 49, 0.2);
            border-color: rgba(214, 48, 49, 0.4);
            color: #ff7675;
        }
        .kml-editor__btn.btn-danger:hover:not(:disabled) {
            background: #d63031;
            color: #fff;
        }

        .kml-editor__zoom-control {
            position: absolute;
            right: 1.25rem;
            top: 50%;
            transform: translateY(-50%);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.5rem;
            background: rgba(16, 19, 26, 0.85);
            border: 1px solid #31405a;
            padding: 0.8rem 0.5rem;
            border-radius: 24px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            backdrop-filter: blur(8px);
            z-index: 10;
            color: #9ca3af;
            user-select: none;
        }
        .kml-editor__zoom-slider {
            writing-mode: bt-lr;
            -webkit-appearance: slider-vertical;
            appearance: slider-vertical;
            width: 18px;
            height: 180px;
            cursor: pointer;
        }
    `,document.head.appendChild(e)}j(document.getElementById(`app`));