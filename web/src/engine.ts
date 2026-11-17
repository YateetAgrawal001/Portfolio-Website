import * as THREE from 'three';
import { get, HUD0, reduceMotion, set, type Control, type GameHandle, type Portfolio } from './store';

// The 3D side, ported from the single-file prototype (portfolio-grand-prix.html) with the numbers from PLAN.md section 6.
// Units: 1 world unit = 1 metre, displayed km/h = speed * 3.6. Car-local axes: forward +x, up +y, right +z.
// ponytail: pinned to three r128, the version the prototype was tuned on. Newer releases changed colour management
// and light units, so upgrading means re-tuning every light and texture colour, not just bumping the version.

/** Spline control index of each turn (may be fractional). null = just before the finish line. */
const IDX: (number | null)[] = [0.6, 2, 3.5, 5, 6.5, 8, null];
const W = 15, KERB = 2.4, RUNOFF = 16, ROAD_Y = 0.2, M = 2000, R_TRIGGER = 60;
const FONT = '"Barlow Condensed","Arial Narrow",sans-serif';

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;
interface Els { host: HTMLElement; map: HTMLCanvasElement; blur: HTMLElement; vig: HTMLElement }

/** Throws if WebGL is unavailable; the caller falls back to the list view. */
export function createGame(els: Els, data: Portfolio): GameHandle {
  if (data.stations.length !== IDX.length) throw new Error(`The track has ${IDX.length} turns but the content has ${data.stations.length} stations.`);
  const root = document.documentElement;
  const ac = new AbortController(), sig = { signal: ac.signal };

  /* ---------- Renderer, scene, lights ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const canvas = renderer.domElement;
  canvas.id = 'gl'; canvas.setAttribute('aria-hidden', 'true');
  els.host.prepend(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const bg = new THREE.Color(0x0B0716), fog = new THREE.Fog(0x1A0F2E, 140, 1500);
  scene.background = bg; scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(72, 1, 0.8, 2600);
  const hemi = new THREE.HemisphereLight(0x7A6CC8, 0x241638, 0.75); scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xA9B6FF, 0.55);
  moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024);
  Object.assign(moon.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 320 });
  scene.add(moon, moon.target);
  const poolA = new THREE.PointLight(0xFFE2B0, 1.4, 120, 1.4), poolB = new THREE.PointLight(0xFFE2B0, 1.4, 120, 1.4);
  scene.add(poolA, poolB);
  const spot = new THREE.SpotLight(0xFFF4DC, 1.7, 95, 0.55, 0.6, 1.2); scene.add(spot, spot.target);

  /* ---------- Track: closed spline, arc-length table ---------- */
  const ctrl = [[-225, 0], [150, 0], [300, -120], [240, -300], [60, -360], [-60, -240], [-210, -345], [-390, -270], [-450, -90], [-375, 60]]
    .map(p => new THREE.Vector3(p[0], 0, p[1]));
  const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
  const P: THREE.Vector3[] = [], T: THREE.Vector3[] = [], N: THREE.Vector3[] = [], cum = [0];
  for (let i = 0; i < M; i++) P.push(curve.getPoint(i / M));
  for (let i = 0; i < M; i++) {
    const a = P[(i + M - 1) % M], b = P[(i + 1) % M];
    const t = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    T.push(t); N.push(new THREE.Vector3(-t.z, 0, t.x));
  }
  for (let i = 1; i <= M; i++) cum.push(cum[i - 1] + P[i % M].distanceTo(P[i - 1]));
  const total = cum[M];
  const curv: number[] = [];
  for (let i = 0; i < M; i++) {
    curv.push(Math.acos(Math.max(-1, Math.min(1, T[i].dot(T[(i + 1) % M])))) / Math.max(.01, cum[i + 1] - cum[i]));
  }
  const wrapS = (s: number) => ((s % total) + total) % total;
  /** Signed circular difference, wrapped to [-total/2, total/2]. */
  const circ = (d: number) => ((((d + total / 2) % total) + total) % total) - total / 2;
  const at = { p: new THREE.Vector3(), t: new THREE.Vector3(), n: new THREE.Vector3(), i: 0 };
  /** Point, tangent and right-hand normal at arc length s. Returns one shared object: clone anything you keep past the next call. */
  function sample(s: number) {
    s = wrapS(s);
    let lo = 0, hi = M;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const f = (s - cum[lo]) / Math.max(1e-6, cum[lo + 1] - cum[lo]);
    const a = lo % M, b = (lo + 1) % M;
    at.p.set(P[a].x + (P[b].x - P[a].x) * f, 0, P[a].z + (P[b].z - P[a].z) * f);
    at.t.set(T[a].x + (T[b].x - T[a].x) * f, 0, T[a].z + (T[b].z - T[a].z) * f).normalize();
    at.n.set(-at.t.z, 0, at.t.x);
    at.i = lo;
    return at;
  }
  const ST = data.stations.map((st, i) => {
    const k = IDX[i], s = k === null ? total - 50 : cum[Math.round((k / ctrl.length) * M)];
    const a = sample(s);
    return { turn: st.turn, short: st.short, s, px: a.p.x, pz: a.p.z };
  });

  /* ---------- Textures ---------- */
  function canvasTex(w: number, h: number, draw: Draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d')!, w, h);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const clampTex = <X extends THREE.Texture>(t: X) => { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; };
  const roadTex = canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = '#2A2C34'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { g.fillStyle = Math.random() < .5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.08)'; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
    g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(w * .32, 0, w * .36, h);
    g.fillStyle = '#F2F2F2'; g.fillRect(w * .03, 0, w * .014, h); g.fillRect(w * .956, 0, w * .014, h);
  });
  roadTex.wrapS = THREE.ClampToEdgeWrapping;
  const kerbTex = canvasTex(16, 64, (g, w, h) => { g.fillStyle = '#D7263D'; g.fillRect(0, 0, w, h / 2); g.fillStyle = '#F4F1EC'; g.fillRect(0, h / 2, w, h / 2); });
  kerbTex.wrapS = THREE.ClampToEdgeWrapping;
  const groundTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#1B1726'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3200; i++) { g.fillStyle = Math.random() < .5 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.18)'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  });
  groundTex.repeat.set(220, 220);
  const groundDayTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#BCA678'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3200; i++) { g.fillStyle = Math.random() < .5 ? 'rgba(255,255,255,.08)' : 'rgba(80,60,30,.12)'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  });
  groundDayTex.repeat.set(220, 220);
  const dotTex = clampTex(canvasTex(32, 32, g => { g.beginPath(); g.arc(16, 16, 14, 0, 6.2832); g.fillStyle = '#fff'; g.fill(); }));
  const glowTex = clampTex(canvasTex(64, 64, g => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }));
  /** polygonOffset keeps the stacked road layers from z-fighting. */
  function layer<X extends THREE.Material>(mat: X, f: number) { mat.polygonOffset = true; mat.polygonOffsetFactor = f; mat.polygonOffsetUnits = f; return mat; }
  const roadMat = layer(new THREE.MeshStandardMaterial({ map: roadTex, roughness: .3, metalness: .12, envMapIntensity: .95, side: THREE.DoubleSide }), -2);
  const kerbMat = layer(new THREE.MeshStandardMaterial({ map: kerbTex, roughness: .45, side: THREE.DoubleSide }), -3);
  const sandMat = layer(new THREE.MeshStandardMaterial({ color: 0x4A4258, roughness: .8, side: THREE.DoubleSide }), -1);
  const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: .9 });

  /* ---------- Sky dome ---------- */
  const gradient = (stops: [number, string][]) => clampTex(canvasTex(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    stops.forEach(s => gr.addColorStop(s[0], s[1]));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }));
  const skyTex = gradient([[0, '#04020B'], [.3, '#0f0820'], [.46, '#43185f'], [.5, '#9b2f7c'], [.54, '#43185f'], [1, '#1a0f2e']]);
  const skyDayTex = gradient([[0, '#2B74CF'], [.3, '#5FA9EA'], [.46, '#B9DDF7'], [.5, '#E6F3FC'], [.56, '#CFE3F4'], [1, '#CFE3F4']]);
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2200, 32, 16), skyMat);
  scene.add(sky);
  const starPos: number[] = [];
  for (let i = 0; i < 600; i++) { const th = Math.random() * 6.2832, ph = Math.acos(.05 + Math.random() * .95); starPos.push(Math.sin(ph) * Math.cos(th) * 2000, Math.cos(ph) * 2000, Math.sin(ph) * Math.sin(th) * 2000); }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, color: 0xFFFFFF, transparent: true, opacity: .85, fog: false, depthWrite: false }));
  stars.frustumCulled = false; scene.add(stars);
  const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xFFF1C2, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  sunSpr.scale.set(520, 520, 1); sunSpr.visible = false; scene.add(sunSpr);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(5200, 5200).rotateX(-Math.PI / 2), groundMat);
  ground.receiveShadow = true; scene.add(ground);

  /* ---------- Road, kerbs, runoff, neon barriers: strips that follow the spline ---------- */
  function strip(offA: number, yA: number, offB: number, yB: number, vScale: number, mat: THREE.Material) {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= M; i++) {
      const k = i % M, p = P[k], n = N[k], v = cum[i] / vScale;
      pos.push(p.x + n.x * offA, yA, p.z + n.z * offA, p.x + n.x * offB, yB, p.z + n.z * offB);
      uv.push(0, v, 1, v);
    }
    for (let i = 0; i < M; i++) { const q = i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m);
    return m;
  }
  strip(W / 2 + KERB, .05, W / 2 + RUNOFF, .05, 40, sandMat);
  strip(-(W / 2 + RUNOFF), .05, -(W / 2 + KERB), .05, 40, sandMat);
  const road = strip(-W / 2, ROAD_Y, W / 2, ROAD_Y, 40, roadMat);
  strip(-W / 2 - KERB, .3, -W / 2, .3, 10, kerbMat);
  strip(W / 2, .3, W / 2 + KERB, .3, 10, kerbMat);
  const wallTex = canvasTex(32, 128, (g, w, h) => {
    g.fillStyle = '#0B0814'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#FF2D95'; g.fillRect(14, 0, 14, h / 2);
    g.fillStyle = '#2DE2FF'; g.fillRect(14, h / 2, 14, h / 2);
    g.fillStyle = '#FFFFFF'; g.fillRect(28, 0, 2, h);
  });
  wallTex.wrapS = THREE.ClampToEdgeWrapping;
  const wallMat = new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.DoubleSide });
  [1, -1].forEach(sd => { const off = sd * (W / 2 + KERB + 11); strip(off, .1, off, 1.3, 36, wallMat); });

  /* ---------- Start line and gantry ---------- */
  const s0 = sample(0);
  const startP = s0.p.clone(), startT = s0.t.clone(), startN = s0.n.clone();
  const startYaw = Math.atan2(-startT.x, -startT.z);
  const checker = clampTex(canvasTex(64, 16, g => { for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 8, y * 8, 8, 8); } }));
  const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 3).rotateX(-Math.PI / 2), layer(new THREE.MeshStandardMaterial({ map: checker, roughness: .5 }), -4));
  line.position.set(startP.x, .45, startP.z); line.rotation.y = startYaw; scene.add(line);
  const metal = new THREE.MeshStandardMaterial({ color: 0x2A2E36, roughness: .6, metalness: .3 });
  [-1, 1].forEach(sd => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 13, 10), metal);
    pole.position.set(startP.x + startN.x * sd * (W / 2 + 4), 6.5, startP.z + startN.z * sd * (W / 2 + 4)); pole.castShadow = true; scene.add(pole);
  });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 9, 1.6, 1.6), new THREE.MeshBasicMaterial({ color: 0xFF2D95 }));
  beam.position.set(startP.x, 13, startP.z); beam.rotation.y = startYaw; scene.add(beam);

  /* ---------- Light poles with glow, plus two pooled real lights ---------- */
  const poleSp = 55, poleCount = Math.floor(total / poleSp), poleOff = W / 2 + KERB + RUNOFF + 1;
  const polePos: THREE.Vector3[] = [], glow: number[] = [];
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(.35, .45, 16, 6), metal, poleCount * 2);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, .4, 1), new THREE.MeshBasicMaterial({ color: 0xFFF0D0 }), poleCount * 2);
  {
    const d = new THREE.Object3D();
    for (let i = 0; i < poleCount; i++) {
      const a = sample(i * poleSp);
      for (let q = 0; q < 2; q++) {
        const sd = q ? 1 : -1, x = a.p.x + a.n.x * sd * poleOff, z = a.p.z + a.n.z * sd * poleOff;
        d.position.set(x, 8, z); d.rotation.set(0, 0, 0); d.updateMatrix(); poles.setMatrixAt(i * 2 + q, d.matrix);
        const hx = x - a.n.x * sd * 2.4, hz = z - a.n.z * sd * 2.4;
        d.position.set(hx, 16.2, hz); d.rotation.set(0, Math.atan2(-a.t.z, a.t.x), 0); d.updateMatrix(); heads.setMatrixAt(i * 2 + q, d.matrix);
        glow.push(hx, 16, hz); polePos.push(new THREE.Vector3(hx, 15.5, hz));
      }
    }
    scene.add(poles, heads);
  }
  const lampGeo = new THREE.BufferGeometry(); lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(glow, 3));
  const lampGlow = new THREE.Points(lampGeo, new THREE.PointsMaterial({ size: 30, map: glowTex, color: 0xFFE2B0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  scene.add(lampGlow);

  /* ---------- Grandstands with crowds ---------- */
  const crowdPos: number[] = [], crowdCol: number[] = [];
  const palette = [0xFF2D95, 0x2DE2FF, 0xFFB84D, 0xFFFFFF, 0xE8E8F0, 0x8F7BFF, 0xFF5A5A].map(c => new THREE.Color(c));
  const standMat = new THREE.MeshStandardMaterial({ color: 0x2B2640, roughness: .9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x15121F, roughness: .7, metalness: .2 });
  function neonSign(text: string, color: string) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#07050E'; g.fillRect(0, 0, 1024, 256);
    g.strokeStyle = color; g.lineWidth = 10; g.strokeRect(10, 10, 1004, 236);
    g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 24;
    g.font = '700 150px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 512, 135, 940);
    return new THREE.CanvasTexture(c);
  }
  function makeStand(sc: number, len: number, text: string, color: number, forceSide?: number) {
    const a = sample(sc); const p = a.p.clone(), t = a.t.clone(), n = a.n.clone();
    const ahead = sample(sc + 30).t.clone();
    const side = forceSide || (ahead.dot(n) > 0 ? -1 : 1);
    const o = n.clone().multiplyScalar(side), yaw = Math.atan2(-t.z, t.x);
    const base = W / 2 + KERB + 30, tiers = 5, depth = 3.4, rise = 1.6;
    for (let j = 0; j < tiers; j++) {
      const h = rise * (j + 1), dist = base + j * depth + depth / 2;
      const box = new THREE.Mesh(new THREE.BoxGeometry(len, h, depth), standMat);
      box.position.set(p.x + o.x * dist, h / 2, p.z + o.z * dist); box.rotation.y = yaw; scene.add(box);
      for (let r = 0; r < 2; r++) {
        const dd = base + j * depth + depth * (.3 + .4 * r);
        for (let u = -len / 2 + 1; u < len / 2; u += 1.2) {
          crowdPos.push(p.x + t.x * u + o.x * dd, h + .85, p.z + t.z * u + o.z * dd);
          const c = palette[(Math.random() * palette.length) | 0];
          crowdCol.push(c.r * .75, c.g * .75, c.b * .75);
        }
      }
    }
    const topY = rise * tiers, midDist = base + tiers * depth / 2;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 4, .6, depth * tiers + 6), roofMat);
    roof.position.set(p.x + o.x * midDist, topY + 8, p.z + o.z * midDist); roof.rotation.y = yaw; scene.add(roof);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(len + 4, .35, .35), new THREE.MeshBasicMaterial({ color }));
    stripe.position.set(p.x + o.x * (base - 2), topY + 7.7, p.z + o.z * (base - 2)); stripe.rotation.y = yaw; scene.add(stripe);
    [-1, 1].forEach(e => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(.7, 8, .7), roofMat);
      post.position.set(p.x + t.x * e * (len / 2 + 1) + o.x * (base - 1), topY + 4, p.z + t.z * e * (len / 2 + 1) + o.z * (base - 1)); scene.add(post);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(len * .5, len * .5 / 4), new THREE.MeshBasicMaterial({ map: neonSign(text, '#' + new THREE.Color(color).getHexString()) }));
    const sd = base + tiers * depth + 4;
    sign.position.set(p.x + o.x * sd, topY + 13, p.z + o.z * sd); sign.rotation.y = yaw + (side > 0 ? Math.PI : 0); scene.add(sign);
  }
  makeStand(110, 110, 'NIGHT RACE', 0xFF2D95, -1);
  makeStand(ST[1].s, 70, 'FULL-STACK GP', 0x2DE2FF);
  makeStand(ST[3].s, 70, 'BACKEND', 0xFFB84D);
  makeStand(ST[4].s, 70, data.name.toUpperCase(), 0xFF2D95);
  const crowdGeo = new THREE.BufferGeometry();
  crowdGeo.setAttribute('position', new THREE.Float32BufferAttribute(crowdPos, 3));
  crowdGeo.setAttribute('color', new THREE.Float32BufferAttribute(crowdCol, 3));
  scene.add(new THREE.Points(crowdGeo, new THREE.PointsMaterial({ size: 1.0, map: dotTex, alphaTest: .4, transparent: true, vertexColors: true, sizeAttenuation: true })));
  const FL = 90, flashArr = new Float32Array(FL * 3), flashAttr = new THREE.BufferAttribute(flashArr, 3), flashGeo = new THREE.BufferGeometry();
  flashGeo.setAttribute('position', flashAttr);
  const flashes = new THREE.Points(flashGeo, new THREE.PointsMaterial({ size: 2.6, map: glowTex, color: 0xFFFFFF, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  flashes.frustumCulled = false; scene.add(flashes);
  function shuffleFlashes() {
    const n = crowdPos.length / 3;
    for (let i = 0; i < FL; i++) { const k = ((Math.random() * n) | 0) * 3; flashArr[i * 3] = crowdPos[k]; flashArr[i * 3 + 1] = crowdPos[k + 1] + .4; flashArr[i * 3 + 2] = crowdPos[k + 2]; }
    flashAttr.needsUpdate = true;
  }
  shuffleFlashes();

  /* ---------- Corner signs ---------- */
  ST.forEach(st => {
    const a = sample(st.s), p = a.p.clone(), n = a.n.clone();
    const ahead = sample(st.s + 28).t.clone();
    const side = ahead.dot(n) > 0 ? -1 : 1, d = W / 2 + KERB + RUNOFF + 6;
    const x = p.x + n.x * side * d, z = p.z + n.z * side * d;
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0E0A1A'; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = '#FF2D95'; g.lineWidth = 10; g.strokeRect(10, 10, 492, 236);
    g.fillStyle = '#FFFFFF'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = '#FF2D95'; g.shadowBlur = 18;
    g.font = '700 150px ' + FONT; g.fillText('T' + st.turn, 256, 100);
    g.font = '700 62px ' + FONT; g.fillStyle = '#2DE2FF'; g.shadowColor = '#2DE2FF'; g.fillText(st.short.toUpperCase(), 256, 205, 460);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: true }));
    sp.scale.set(15, 7.5, 1); sp.position.set(x, 10, z); scene.add(sp);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, 6.5, 8), metal);
    post.position.set(x, 3.25, z); scene.add(post);
  });

  /* ---------- Las Vegas style skyline ---------- */
  const bldgs: { mat: THREE.MeshBasicMaterial; tn: THREE.Texture; td: THREE.Texture }[] = [];
  const domeC = document.createElement('canvas'); domeC.width = 256; domeC.height = 128;
  const domeG = domeC.getContext('2d')!, domeTex = new THREE.CanvasTexture(domeC);
  function drawDome(t: number) {
    for (let x = 0; x < 256; x += 4) {
      const hue = (x * 1.3 + t * 50) % 360, lum = 50 + 12 * Math.sin(x * .12 + t * 2);
      domeG.fillStyle = 'hsl(' + hue + ',90%,' + lum + '%)'; domeG.fillRect(x, 0, 4, 128);
    }
    domeTex.needsUpdate = true;
  }
  drawDome(0);
  let beamLight: THREE.Mesh;
  {
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cx = -80, cz = -170;
    const winBase = canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#07060D'; g.fillRect(0, 0, w, h);
      const cols = ['#FFE7A8', '#FFD27A', '#BFEFFF', '#FF9BD0'];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (Math.random() < .55) { g.fillStyle = cols[(Math.random() * 4) | 0]; g.fillRect(x * 8 + 2, y * 8 + 2, 4, 5); }
    });
    const winDay = canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#A9B4C4'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = Math.random() < .2 ? '#7FA6CC' : '#37526F'; g.fillRect(x * 8 + 1, y * 8 + 1, 6, 6); }
    });
    const neon = [0xFF2D95, 0x2DE2FF, 0xFFB84D, 0x8F7BFF];
    for (let i = 0; i < 46; i++) {
      const ang = i / 46 * 6.2832 + (rnd() - .5) * .1, r = 640 + rnd() * 560;
      const w = 40 + rnd() * 70, d = 40 + rnd() * 70, h = 90 + rnd() * 360;
      const tn = winBase.clone(); tn.needsUpdate = true; tn.repeat.set(w / 28, h / 28);
      const td = winDay.clone(); td.needsUpdate = true; td.repeat.set(w / 28, h / 28);
      const mat = new THREE.MeshBasicMaterial({ map: tn });
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      bldgs.push({ mat, tn, td });
      b.position.set(cx + Math.cos(ang) * r, h / 2, cz + Math.sin(ang) * r); b.rotation.y = rnd() * 3; scene.add(b);
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 4, d + 1), new THREE.MeshBasicMaterial({ color: neon[(rnd() * 4) | 0] }));
      band.position.copy(b.position); band.position.y = h + 2; band.rotation.y = b.rotation.y; scene.add(band);
    }
    // glowing dome
    const dome = new THREE.Mesh(new THREE.SphereGeometry(115, 48, 32), new THREE.MeshBasicMaterial({ map: domeTex }));
    dome.position.set(cx + Math.cos(.7) * 900, 80, cz + Math.sin(.7) * 900); scene.add(dome);
    // pyramid with beam
    const pyr = new THREE.Mesh(new THREE.ConeGeometry(130, 170, 4).rotateY(Math.PI / 4), new THREE.MeshBasicMaterial({ color: 0x1D3A55 }));
    const pa = 2.4; pyr.position.set(cx + Math.cos(pa) * 860, 85, cz + Math.sin(pa) * 860); scene.add(pyr);
    beamLight = new THREE.Mesh(new THREE.CylinderGeometry(5, 12, 1200, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xFFF2B0, transparent: true, opacity: .28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beamLight.position.set(pyr.position.x, 700, pyr.position.z); scene.add(beamLight);
    // observation tower
    const ta = 4.3, tx = cx + Math.cos(ta) * 800, tz = cz + Math.sin(ta) * 800;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 7, 340, 10), new THREE.MeshBasicMaterial({ color: 0x2A2640 })); shaft.position.set(tx, 170, tz); scene.add(shaft);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(28, 20, 20, 16), new THREE.MeshBasicMaterial({ color: 0xFF2D95 })); pod.position.set(tx, 350, tz); scene.add(pod);
  }

  /* ---------- Dash display on the steering wheel ---------- */
  const dashC = document.createElement('canvas'); dashC.width = 512; dashC.height = 256;
  const dg = dashC.getContext('2d')!, dashTex = new THREE.CanvasTexture(dashC);
  let dashKey = '';
  function drawDash(kmh: number, gear: string, rpm: number, thr: number, brk: number, nextTxt: string, lap: string) {
    const key = [kmh, gear, Math.round(rpm * 15), Math.round(thr * 10), Math.round(brk * 10), nextTxt, lap].join('|');
    if (key === dashKey) return; dashKey = key;
    dg.fillStyle = '#07080C'; dg.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 15; i++) {
      dg.beginPath(); dg.arc(46 + i * 30.5, 26, 9, 0, 6.2832);
      dg.fillStyle = i < Math.round(rpm * 15) ? (i < 5 ? '#35E06B' : i < 10 ? '#FF3B4E' : '#3DA8FF') : '#20242D'; dg.fill();
    }
    dg.textAlign = 'left'; dg.textBaseline = 'alphabetic';
    dg.fillStyle = '#8B93A3'; dg.font = '600 26px ' + FONT; dg.fillText('GEAR', 24, 88);
    dg.fillStyle = '#FFFFFF'; dg.font = '700 112px ' + FONT; dg.fillText(gear, 24, 184);
    dg.textAlign = 'center'; dg.font = '700 150px ' + FONT; dg.fillText(String(kmh), 296, 176);
    dg.fillStyle = '#8B93A3'; dg.font = '600 28px ' + FONT; dg.fillText('KM/H', 296, 212);
    dg.fillStyle = '#20242D'; dg.fillRect(448, 70, 22, 130); dg.fillRect(480, 70, 22, 130);
    dg.fillStyle = '#35E06B'; dg.fillRect(448, 200 - 130 * thr, 22, 130 * thr);
    dg.fillStyle = '#FF3B4E'; dg.fillRect(480, 200 - 130 * brk, 22, 130 * brk);
    dg.textAlign = 'left'; dg.fillStyle = '#FFD23F'; dg.font = '600 32px ' + FONT; dg.fillText(nextTxt, 24, 244);
    dg.textAlign = 'right'; dg.fillStyle = '#8B93A3'; dg.fillText(lap, 496, 244);
    dashTex.needsUpdate = true;
  }
  drawDash(0, 'N', 0, 0, 0, 'Hold gas to start', 'OUT LAP');

  /* ---------- The cars: built from boxes. Only the player gets a helmet colour, steering wheel and dash. ---------- */
  function makeCarModel(bodyColor: number, player: boolean) {
    const g = new THREE.Group(), wheels: { mesh: THREE.Mesh; r: number }[] = [];
    const red = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: .3, metalness: .45, envMapIntensity: .9 });
    const white = new THREE.MeshStandardMaterial({ color: 0xF4F1EC, roughness: .4, metalness: .2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x16181D, roughness: .6 });
    const yellow = new THREE.MeshStandardMaterial({ color: player ? 0xFFD23F : 0xFFFFFF, roughness: .5 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    const B = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
    add(B(3.0, .55, .8), red, 0, .78, 0);
    add(B(2.1, .3, .44), red, 2.2, .66, 0);
    add(B(1.5, .42, .5), red, -.1, .66, .66);
    add(B(1.5, .42, .5), red, -.1, .66, -.66);
    add(B(1.6, .5, .45), white, -1.0, 1.1, 0);
    const helmet = add(new THREE.SphereGeometry(.22, 16, 12), yellow, .15, 1.14, 0);
    add(B(1.35, .05, .05), dark, .4, 1.52, .36); add(B(1.35, .05, .05), dark, .4, 1.52, -.36);
    add(B(.05, .05, .76), dark, 1.06, 1.5, 0);
    add(B(.06, .5, .06), dark, 1.08, 1.25, 0);
    add(B(.05, .5, .05), dark, -.2, 1.28, .36); add(B(.05, .5, .05), dark, -.2, 1.28, -.36);
    add(B(3.6, .08, 1.5), dark, 0, .46, 0);
    add(B(.55, .07, 2.1), dark, 3.25, .44, 0);
    add(B(.6, .28, .05), red, 3.25, .56, 1.05); add(B(.6, .28, .05), red, 3.25, .56, -1.05);
    add(B(.7, .08, 1.6), dark, -2.0, 1.3, 0);
    add(B(.7, .55, .06), red, -2.0, 1.06, .8); add(B(.7, .55, .06), red, -2.0, 1.06, -.8);
    add(B(.1, .6, .2), dark, -1.9, .98, 0);
    const tail = new THREE.Mesh(B(.1, .2, .34), new THREE.MeshBasicMaterial({ color: 0xFF1030 })); tail.position.set(-2.4, 1.0, 0); g.add(tail);
    const tailGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xFF1030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    tailGlow.scale.set(2.6, 2.6, 1); tailGlow.position.set(-2.5, 1.0, 0); g.add(tailGlow);
    function wheel(x: number, z: number, r: number, w: number) {
      const geo = new THREE.CylinderGeometry(r, r, w, 20); geo.rotateX(Math.PI / 2);
      const tire = new THREE.Mesh(geo, dark); tire.position.set(x, r + .18, z); tire.castShadow = true;
      // two small markers per tyre so the spin is visible
      const mk = new THREE.Mesh(new THREE.BoxGeometry(.16, .06, .03), yellow); mk.position.set(r * .78, 0, w / 2 + .01); tire.add(mk);
      const mk2 = mk.clone(); mk2.position.z = -w / 2 - .01; tire.add(mk2);
      g.add(tire); wheels.push({ mesh: tire, r });
    }
    wheel(1.75, 1.0, .36, .46); wheel(1.75, -1.0, .36, .46);
    wheel(-1.65, 1.08, .4, .62); wheel(-1.65, -1.08, .4, .62);
    const spinGroup = new THREE.Group();
    if (player) {
      const tilt = new THREE.Group(); tilt.position.set(.95, 1.2, 0); tilt.rotation.z = -.4; g.add(tilt);
      tilt.add(spinGroup);
      spinGroup.add(new THREE.Mesh(B(.03, .2, .36), dark));
      [-1, 1].forEach(sd => { const grip = new THREE.Mesh(B(.06, .17, .07), new THREE.MeshStandardMaterial({ color: 0x2B2F38, roughness: .9 })); grip.position.set(0, -.01, sd * .21); spinGroup.add(grip); });
      const dashMesh = new THREE.Mesh(new THREE.PlaneGeometry(.28, .14).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: dashTex, fog: false }));
      dashMesh.position.set(-.02, .02, 0); spinGroup.add(dashMesh);
    }
    return { group: g, wheels, helmet, spinGroup };
  }
  const P1 = makeCarModel(0xD7263D, true);
  const car = P1.group;
  scene.add(car);
  const R1 = makeCarModel(0x1E9BFF, false);
  R1.group.position.set(startP.x, ROAD_Y, startP.z); scene.add(R1.group);

  /* ---------- Rain ---------- */
  const RN = 3200, rh = new Float32Array(RN * 3), rpos = new Float32Array(RN * 6), rainAttr = new THREE.BufferAttribute(rpos, 3), rg = new THREE.BufferGeometry();
  for (let i = 0; i < RN; i++) { rh[i * 3] = (Math.random() - .5) * 110; rh[i * 3 + 1] = Math.random() * 45; rh[i * 3 + 2] = (Math.random() - .5) * 110; }
  rg.setAttribute('position', rainAttr);
  const rainMesh = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xC4D2FF, transparent: true, opacity: .5 }));
  rainMesh.frustumCulled = false; scene.add(rainMesh);
  let isNight = true, envDirty = 0, rainOn = !reduceMotion;
  function setRain(on: boolean) {
    rainOn = on; rainMesh.visible = on; set({ rain: on });
    roadMat.roughness = on ? .26 : .55; fog.near = isNight ? (on ? 110 : 150) : (on ? 170 : 280); envDirty = 6;
  }
  const vel = new THREE.Vector3();
  function updateRain(dt: number) {
    if (!rainOn) return;
    const rx = 4 - vel.x, ry = -48, rz = 1.5 - vel.z;   // rain velocity relative to the camera: streaks lean back with speed
    for (let i = 0; i < RN; i++) {
      let x = rh[i * 3] + rx * dt, y = rh[i * 3 + 1] + ry * dt, z = rh[i * 3 + 2] + rz * dt;
      if (y < 0) { y += 45; x = (Math.random() - .5) * 110; z = (Math.random() - .5) * 110; }
      if (x > 55) x -= 110; else if (x < -55) x += 110;
      if (z > 55) z -= 110; else if (z < -55) z += 110;
      rh[i * 3] = x; rh[i * 3 + 1] = y; rh[i * 3 + 2] = z;
      const p = i * 6; rpos[p] = x; rpos[p + 1] = y; rpos[p + 2] = z; rpos[p + 3] = x - rx * .018; rpos[p + 4] = y - ry * .018; rpos[p + 5] = z - rz * .018;
    }
    rainAttr.needsUpdate = true;
    rainMesh.position.set(camera.position.x, 0, camera.position.z);
  }

  /* ---------- Water spray behind the cars: soft grey-blue puffs, normal blending so they never glow ---------- */
  let sprayK = 1;
  const sprayColor = new THREE.Color(0x7D8798);
  const sprayVS = 'attribute float aAlpha; attribute float aSize; uniform float uScale; varying float vA;\n' +
    'void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }';
  const sprayFS = 'uniform sampler2D map; uniform vec3 color; varying float vA;\n' +
    'void main(){ vec4 tx = texture2D(map, gl_PointCoord); gl_FragColor = vec4(color, tx.a * vA); }';
  function makeSpray(n: number) {
    const pos = new Float32Array(n * 3), v3 = new Float32Array(n * 3), al = new Float32Array(n), sz = new Float32Array(n), life = new Float32Array(n), ttl = new Float32Array(n);
    for (let i = 0; i < n; i++) pos[i * 3 + 1] = -100;
    const aPos = new THREE.BufferAttribute(pos, 3), aAl = new THREE.BufferAttribute(al, 1), aSz = new THREE.BufferAttribute(sz, 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', aPos); geo.setAttribute('aAlpha', aAl); geo.setAttribute('aSize', aSz);
    const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: glowTex }, color: { value: sprayColor }, uScale: { value: 400 } }, vertexShader: sprayVS, fragmentShader: sprayFS, transparent: true, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; scene.add(pts);
    let head = 0;
    return {
      pts, acc: 0,
      emit(x: number, y: number, z: number, vx: number, vy: number, vz: number) {
        const i = head; head = (head + 1) % n; const j = i * 3;
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z; v3[j] = vx; v3[j + 1] = vy; v3[j + 2] = vz;
        life[i] = ttl[i] = .6 + Math.random() * .8;
      },
      update(dt: number) {
        mat.uniforms.uScale.value = canvas.height * .5;
        for (let i = 0; i < n; i++) {
          if (life[i] <= 0) continue;
          life[i] -= dt; const j = i * 3;
          if (life[i] <= 0) { pos[j + 1] = -100; al[i] = 0; continue; }
          v3[j + 1] -= 5 * dt; const dr = 1 - 1.3 * dt; v3[j] *= dr; v3[j + 2] *= dr;
          pos[j] += v3[j] * dt; pos[j + 1] += v3[j + 1] * dt; pos[j + 2] += v3[j + 2] * dt;
          if (pos[j + 1] < .25) { pos[j + 1] = .25; v3[j + 1] *= -.1; }
          const f = life[i] / ttl[i];
          al[i] = Math.sin(Math.min(1, (1 - f) * 6) * 1.5708) * f * .3 * sprayK;
          sz[i] = 1.4 + (1 - f) * 3.2;
        }
        aPos.needsUpdate = true; aAl.needsUpdate = true; aSz.needsUpdate = true;
      },
      clear() {
        for (let i = 0; i < n; i++) { life[i] = 0; pos[i * 3 + 1] = -100; al[i] = 0; }
        aPos.needsUpdate = true; aAl.needsUpdate = true;
      },
    };
  }
  const spray1 = makeSpray(460), spray2 = makeSpray(320), sp3 = new THREE.Vector3();
  function emitSpray(sp: typeof spray1, group: THREE.Group, speed: number, dt: number) {
    if (!rainOn || speed < 10) return;
    sp.acc += speed * 2.1 * dt;
    const yaw = group.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw), lx = Math.sin(yaw), lz = Math.cos(yaw);
    while (sp.acc >= 1) {
      sp.acc -= 1;
      const side = Math.random() < .5 ? -1 : 1, mist = Math.random() < .3;
      if (mist) sp3.set(-2.5, .9, (Math.random() - .5) * .8); else sp3.set(-1.65 - Math.random() * .5, .3, side * 1.08);
      group.localToWorld(sp3);
      const up = mist ? 1.0 + Math.random() * 1.8 : 1.4 + Math.random() * 2.8 + speed * .02;
      const back = speed * (.12 + Math.random() * .1), lt = (Math.random() - .5) * 4 + (mist ? 0 : side * 1.2);
      sp.emit(sp3.x, sp3.y, sp3.z, fx * back + lx * lt, up, fz * back + lz * lt);
    }
  }

  /* ---------- Wet-road reflections: one-off environment capture ---------- */
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { format: THREE.RGBFormat, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCam = new THREE.CubeCamera(1, 2600, cubeRT);
  function captureEnv() {
    // The road samples this very cube map, so drawing it into the capture would be a GL feedback loop.
    const hide = [road, car, R1.group, rainMesh, spray1.pts, spray2.pts], was = hide.map(o => o.visible);
    hide.forEach(o => { o.visible = false; });
    cubeCam.position.set(-80, 18, -170); cubeCam.update(renderer, scene);
    hide.forEach((o, i) => { o.visible = was[i]; });
    roadMat.envMap = cubeRT.texture; roadMat.needsUpdate = true;
    [car, R1.group].forEach(gr => gr.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.metalness > .1) { m.envMap = cubeRT.texture; m.needsUpdate = true; }
    }));
  }

  /* ---------- Minimap ---------- */
  const colors = { ink: '#F4F2FA', accent: '#FF4D8D', panel: '#161225', onAccent: '#14101F' };
  function readColors() {
    const cs = getComputedStyle(root), v = (name: string, d: string) => cs.getPropertyValue(name).trim() || d;
    colors.ink = v('--ink', colors.ink); colors.accent = v('--accent', colors.accent); colors.panel = v('--solid', colors.panel); colors.onAccent = v('--on-accent', colors.onAccent);
  }
  const map = els.map, mctx = map.getContext('2d')!;
  let mScale = 1, mOx = 0, mOz = 0, mSize = 176;
  const minX = Math.min(...P.map(p => p.x)), minZ = Math.min(...P.map(p => p.z));
  const mW = Math.max(...P.map(p => p.x)) - minX, mH = Math.max(...P.map(p => p.z)) - minZ;
  function sizeMap() {
    const css = map.clientWidth || 176, dpr = Math.min(window.devicePixelRatio || 1, 2);
    mSize = css; map.width = css * dpr; map.height = css * dpr; mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mScale = (css - 34) / Math.max(mW, mH); mOx = (css - mW * mScale) / 2; mOz = (css - mH * mScale) / 2;
  }
  const mp = (x: number, z: number) => [mOx + (x - minX) * mScale, mOz + (z - minZ) * mScale];
  function drawMap(carP: THREE.Vector3, rivalP: THREE.Vector3 | null) {
    const { visited, shown } = get();
    mctx.clearRect(0, 0, mSize, mSize);
    mctx.lineJoin = 'round'; mctx.lineCap = 'round';
    mctx.beginPath();
    for (let i = 0; i <= M; i += 8) { const q = mp(P[i % M].x, P[i % M].z); if (i === 0) mctx.moveTo(q[0], q[1]); else mctx.lineTo(q[0], q[1]); }
    mctx.closePath(); mctx.strokeStyle = colors.ink; mctx.globalAlpha = .85; mctx.lineWidth = 5; mctx.stroke(); mctx.globalAlpha = 1;
    const sq = mp(startP.x, startP.z); mctx.fillStyle = colors.ink; mctx.fillRect(sq[0] - 2, sq[1] - 8, 4, 16);
    mctx.font = '700 11px "Barlow Condensed", sans-serif'; mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
    ST.forEach((st, i) => {
      const q = mp(st.px, st.pz), done = visited.includes(i);
      mctx.beginPath(); mctx.arc(q[0], q[1], 9, 0, 6.2832);
      mctx.fillStyle = done ? colors.accent : colors.panel; mctx.fill();
      mctx.lineWidth = 2; mctx.strokeStyle = i === shown ? colors.accent : colors.ink; mctx.stroke();
      mctx.fillStyle = done ? colors.onAccent : colors.ink; mctx.fillText(String(st.turn), q[0], q[1] + .5);
    });
    const dot = (p: THREE.Vector3, fill: string) => { const q = mp(p.x, p.z); mctx.beginPath(); mctx.arc(q[0], q[1], 5, 0, 6.2832); mctx.fillStyle = fill; mctx.fill(); mctx.lineWidth = 2; mctx.strokeStyle = '#fff'; mctx.stroke(); };
    if (rivalP) dot(rivalP, '#2DB3FF');
    dot(carP, colors.accent);
  }
  map.addEventListener('click', e => {
    const r = map.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = 22;
    ST.forEach((st, i) => { const q = mp(st.px, st.pz), d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) teleport(best);
  }, sig);

  /* ---------- Input ---------- */
  const kb: Record<Control, boolean> = { gas: false, brake: false, left: false, right: false };
  const tc: Record<Control, boolean> = { gas: false, brake: false, left: false, right: false };
  const KEYS: Record<string, Control> = { KeyW: 'gas', ArrowUp: 'gas', Space: 'gas', KeyS: 'brake', ArrowDown: 'brake', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (get().listOpen || state === 'intro') return;   // the list view handles its own keys
    if (!e.repeat) {
      if (e.code === 'KeyC') return toggleCam();
      if (e.code === 'KeyR') return setRain(!rainOn);
      if (e.code === 'KeyO') return toggleRival();
      if (e.code === 'KeyE') { const u = get(); if (u.shown >= 0) set({ bannerHidden: !u.bannerHidden }); return; }
    }
    if (e.key === 'Escape') return set({ bannerHidden: true });
    const k = KEYS[e.code]; if (!k) return;
    // Space on a focused button should press the button, not the gas.
    if (e.code === 'Space' && (e.target as Element | null)?.closest?.('button,a,input,textarea')) return;
    kb[k] = true; e.preventDefault();
  }, sig);
  window.addEventListener('keyup', e => { const k = KEYS[e.code]; if (k) kb[k] = false; }, sig);
  window.addEventListener('blur', () => { kb.gas = kb.brake = kb.left = kb.right = tc.gas = tc.brake = tc.left = tc.right = false; }, sig);

  /* ---------- Game state ---------- */
  let state: 'intro' | 'countdown' | 'race' = 'intro';
  const setPhase = (p: typeof state) => { state = p; set({ phase: p }); };
  let camMode: 0 | 1 = 0; // 0 cockpit, 1 chase
  let s = 22, v = 0, lat = 0, latT = 0, yawOff = 0, wheelAng = 0, thrS = 0, brkS = 0, prevS = s, snapCam = true, introAngle = 0, frameNo = 0, flashT = 0, domeT = 0;
  let lapNo = 0, lapRunning = false, lapT = 0, bestLap = 0, pCross = 0, uiT = 0, rivalOn = true, cdTimer = 0, blurOn = false, blurLast = -1, driveTxt = 'Idle';
  const carPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3(), eye = new THREE.Vector3(), look = new THREE.Vector3();
  const lightOff = new THREE.Vector3(50, 95, 30);
  const rival = { s: 44, v: 0, lat: -3.6, laps: 0 };
  const fmt = (x: number) => { const m = Math.floor(x / 60), sec = x - m * 60; return m + ':' + (sec < 10 ? '0' : '') + sec.toFixed(1); };
  /** Rival's unwrapped progress minus the player's. Positive = rival ahead. */
  const gapNow = () => (rival.laps * total + rival.s) - (pCross * total + s);

  function toggleCam() { camMode = camMode ? 0 : 1; snapCam = true; set({ cam: camMode }); }
  function showCard(i: number) {
    const u = get();
    set({ shown: i, bannerHidden: false, visited: u.visited.includes(i) ? u.visited : [...u.visited, i] });
  }
  const resetCard = () => set({ shown: -1, bannerHidden: false });

  function crossLine() {
    pCross++;
    if (!lapRunning) { lapRunning = true; lapNo = 1; lapT = 0; return; }
    if (!bestLap || lapT < bestLap) bestLap = lapT;
    lapNo++; lapT = 0;
  }
  /** Highest curvature over the next samples, looking `span` samples ahead. */
  function curvAhead(sv: number, span: number, step: number) {
    const i = sample(sv).i; let k = 0;
    for (let j = 0; j <= span; j += step) k = Math.max(k, curv[(i + j) % M]);
    return k;
  }
  const cornerLimit = () => Math.max(42, Math.min(95, Math.sqrt(30 / Math.max(curvAhead(s, 14, 2), 1e-4)))) * (rainOn ? .88 : 1);
  function syncRival() { rival.s = wrapS(s + 40); rival.laps = pCross + (rival.s < s ? 1 : 0); rival.lat = -3.6; }
  function collide(dt: number) {
    if (!rivalOn || state !== 'race' || Math.abs(rival.lat - lat) > 2.3) return;
    const d = gapNow();
    if (d > 0 && d < 4.6 && v > rival.v) {
      v += (rival.v * .96 - v) * Math.min(1, dt * 12);
    } else if (d < 0 && d > -4.6 && rival.v > v) {
      rival.v += (v * 1.02 - rival.v) * Math.min(1, dt * 8);
    }
  }
  function updateRival(dt: number) {
    R1.group.visible = rivalOn;
    if (!rivalOn) { rival.v = 0; return; }
    if (state === 'race') {
      const k = curvAhead(rival.s, 60, 6);
      let tgt = Math.min(68, Math.max(22, Math.min(62, Math.sqrt(26 / Math.max(k, 1e-4)))));
      tgt *= Math.max(.86, Math.min(1.1, 1 - gapNow() / 1200));   // rubber band
      rival.v += Math.max(-45 * dt, Math.min(30 * dt, tgt - rival.v));
      const prev = rival.s; rival.s = wrapS(rival.s + rival.v * dt);
      if (prev > total * .9 && rival.s < total * .1) rival.laps++;
      let laneT = Math.sin(rival.s * .012) * 3.2 - 1;
      if (Math.abs(circ(s - rival.s)) < 10 && Math.abs(lat - rival.lat) < 3.4) laneT = Math.max(-5.5, Math.min(5.5, lat > rival.lat ? lat - 3.8 : lat + 3.8));
      rival.lat += (laneT - rival.lat) * (1 - Math.exp(-dt * 2.2));
    }
    const a = sample(rival.s);
    R1.group.position.set(a.p.x + a.n.x * rival.lat, ROAD_Y, a.p.z + a.n.z * rival.lat);
    R1.group.rotation.y = Math.atan2(-a.t.z, a.t.x);
    R1.wheels.forEach(w => { w.mesh.rotation.z -= rival.v * dt / w.r; });
    R1.group.updateMatrixWorld(true);
    emitSpray(spray2, R1.group, rival.v, dt);
  }
  function rivalReset() { rival.s = 44; rival.v = 0; rival.lat = -3.6; rival.laps = 0; updateRival(0); }
  function uiTick(dt: number, kmh: number, gear: string) {
    uiT += dt; if (uiT < .1) return; uiT = 0;
    const gap = gapNow(), you = gap <= 0, ag = Math.abs(gap);
    set({ hud: {
      lap: lapRunning ? String(lapNo) : 'OUT', time: lapRunning ? fmt(lapT) : '--', best: bestLap ? fmt(bestLap) : '--',
      pos: 'P' + (you ? 1 : 2),
      gap: state !== 'race' ? '' : (ag >= total ? Math.floor(ag / total) + ' lap' : (ag / Math.max(20, (v + rival.v) / 2)).toFixed(1) + 's') + (you ? ' ahead' : ' behind'),
      kmh, gear, drive: driveTxt,
    } });
  }
  /** Cockpit only: soft edges that blur more with speed. */
  function setBlur(on: boolean, speed: number) {
    const b = on ? 2 + Math.min(1, speed / 80) * 5 : 0;
    if (on !== blurOn) { blurOn = on; els.blur.style.opacity = on ? '1' : '0'; els.vig.style.opacity = on ? (isNight ? '1' : '.6') : '0'; canvas.style.filter = on ? 'blur(.45px)' : ''; }
    if (on && Math.abs(b - blurLast) > .25) { blurLast = b; els.blur.style.setProperty('--bl', b.toFixed(1) + 'px'); }
  }
  function toggleRival() {
    rivalOn = !rivalOn; set({ rival: rivalOn });
    R1.group.visible = rivalOn; if (rivalOn) syncRival();
  }

  function applyScene(night: boolean) {
    isNight = night;
    root.setAttribute('data-theme', night ? 'dark' : 'light'); readColors();
    bg.set(night ? 0x0B0716 : 0xA8D0F0); fog.color.set(night ? 0x1A0F2E : 0xCFE3F4); fog.far = night ? 1500 : 2100;
    skyMat.map = night ? skyTex : skyDayTex; skyMat.needsUpdate = true;
    stars.visible = night; sunSpr.visible = !night;
    hemi.color.set(night ? 0x7A6CC8 : 0xBFD8FF); hemi.groundColor.set(night ? 0x241638 : 0x6E6A55); hemi.intensity = night ? .75 : 1.0;
    moon.color.set(night ? 0xA9B6FF : 0xFFF1D6); moon.intensity = night ? .55 : 1.2; lightOff.set(night ? 50 : 80, night ? 95 : 140, night ? 30 : 40);
    poolA.visible = night; poolB.visible = night; spot.visible = night;
    lampGlow.visible = night; beamLight.visible = night;
    groundMat.map = night ? groundTex : groundDayTex; groundMat.needsUpdate = true; sandMat.color.set(night ? 0x4A4258 : 0xE1CFA3);
    bldgs.forEach(b => { b.mat.map = night ? b.tn : b.td; b.mat.needsUpdate = true; });
    sprayK = night ? 1 : .9; sprayColor.set(night ? 0x7D8798 : 0xD5DCE6);
    set({ night });
    setRain(night && !reduceMotion);
  }
  /** Back to the grid with a fresh roll of the conditions: night 70% of the time, never persisted. */
  function restart() {
    clearInterval(cdTimer);
    s = 22; v = 0; lat = latT = 0; yawOff = 0; prevS = s; snapCam = true; introAngle = 0;
    lapNo = 0; lapRunning = false; lapT = 0; bestLap = 0; pCross = 0;
    setPhase('intro');
    set({ lights: -1, visited: [], shown: -1, bannerHidden: false, hud: HUD0 });
    rivalReset(); spray1.clear(); spray2.clear();
    applyScene(Math.random() < .7);
  }
  function teleport(i: number) {
    if (state === 'intro') return;
    clearInterval(cdTimer); setPhase('race'); set({ lights: -1 });
    s = wrapS(ST[i].s - 45); prevS = s; v = 0; lat = latT = 0; snapCam = true; lapRunning = false; syncRival(); resetCard();
  }
  function start() {
    if (state !== 'intro') return;
    sizeMap(); snapCam = true; setPhase('countdown');
    let n = 0; set({ lights: 0 });
    cdTimer = window.setInterval(() => {
      if (n < 5) { set({ lights: ++n }); return; }
      clearInterval(cdTimer); set({ lights: 0 }); setPhase('race');
      setTimeout(() => set({ lights: -1 }), 650);
    }, 450);
  }

  function update(dt: number, now: number) {
    const gas = kb.gas || tc.gas, brake = kb.brake || tc.brake;
    const steer = (kb.right || tc.right ? 1 : 0) - (kb.left || tc.left ? 1 : 0);
    if (state === 'race') {
      // The car never moves on its own: gas accelerates, no gas coasts down to a full stop.
      let acc;
      if (gas) acc = v < 88 ? 34 * (1 - v / 88) + 2 : 0; else acc = -(2.2 + .0035 * v * v);
      if (brake) acc -= 70;
      v = Math.max(0, v + acc * dt);
      if (!gas && v < .35) v = 0;
      const cl = cornerLimit(); let scrub = false;
      if (v > cl) { v -= (v - cl) * Math.min(1, dt * 1.6); scrub = true; }
      collide(dt);
      prevS = s; s = wrapS(s + v * dt);
      if (lapRunning) lapT += dt;
      if (prevS > total * .9 && s < total * .1) crossLine();
      if (v > .5) latT = Math.max(-6, Math.min(6, latT + steer * dt * 9 * Math.min(1, v / 12)));
      let best = -1, bd = R_TRIGGER;
      ST.forEach((st, i) => { const d = Math.abs(circ(s - st.s)); if (d < bd) { bd = d; best = i; } });
      const u = get();
      if (best >= 0 && best !== u.shown) showCard(best);
      driveTxt = brake ? 'Brake' : scrub ? 'Understeer' : gas ? 'Gas' : (v > 0 ? 'Coasting' : 'Stopped');
    } else { v = 0; }
    updateRival(dt);

    const a = sample(s);
    lat += (latT - lat) * (1 - Math.exp(-dt * 8));
    carPos.set(a.p.x + a.n.x * lat, 0, a.p.z + a.n.z * lat);
    vel.set(a.t.x * v, 0, a.t.z * v);
    yawOff += ((-steer * .12 * Math.min(1, v / 8)) - yawOff) * (1 - Math.exp(-dt * 6));
    thrS += ((gas ? 1 : 0) - thrS) * (1 - Math.exp(-dt * 10));
    brkS += ((brake ? 1 : 0) - brkS) * (1 - Math.exp(-dt * 10));
    wheelAng += ((-steer * .55) - wheelAng) * (1 - Math.exp(-dt * 8));
    P1.spinGroup.rotation.x = wheelAng;
    car.position.set(carPos.x, ROAD_Y + Math.sin(now * .03) * .01 * Math.min(1, v / 30), carPos.z);
    car.rotation.y = Math.atan2(-a.t.z, a.t.x) + yawOff;
    P1.wheels.forEach(w => { w.mesh.rotation.z -= v * dt / w.r; });
    car.updateMatrixWorld(true);
    emitSpray(spray1, car, v, dt);

    // lights that travel with the car
    spot.position.copy(car.localToWorld(tmp.set(2.6, 1.0, 0)));
    spot.target.position.copy(car.localToWorld(tmp.set(32, 0, 0)));
    moon.position.set(carPos.x + lightOff.x, lightOff.y, carPos.z + lightOff.z); moon.target.position.copy(carPos);
    const pi = (Math.floor(wrapS(s) / poleSp) + 1) % poleCount;
    poolA.position.copy(polePos[pi * 2]); poolB.position.copy(polePos[pi * 2 + 1]);

    // camera
    const cockpit = state !== 'intro' && camMode === 0;
    P1.helmet.visible = !cockpit;
    setBlur(cockpit, v);
    const nearWant = cockpit ? .25 : .8;
    if (camera.near !== nearWant) { camera.near = nearWant; camera.updateProjectionMatrix(); }
    let fov;
    if (state === 'intro') {
      introAngle += dt * .18;
      tmp.set(carPos.x + Math.cos(introAngle) * 20, 7, carPos.z + Math.sin(introAngle) * 20);
      camera.position.lerp(tmp, snapCam ? 1 : 1 - Math.exp(-dt * 2));
      camLook.set(carPos.x, 1.2, carPos.z); camera.lookAt(camLook); fov = 62;
    } else if (cockpit) {
      eye.set(.3, 1.45, 0); car.localToWorld(eye);
      const sh = Math.min(1, v / 40) * .006; eye.y += (Math.random() - .5) * sh; eye.x += (Math.random() - .5) * sh;
      camera.position.copy(eye);
      look.set(30, .9, 0); car.localToWorld(look); camera.lookAt(look);
      camera.rotateZ(-yawOff * .5);
      fov = 80 + v * .09;
    } else {
      // The chase camera is close on purpose (7.5 behind). Do not move it back.
      tmp.set(carPos.x - a.t.x * 7.5, 2.7, carPos.z - a.t.z * 7.5);
      camera.position.lerp(tmp, snapCam ? 1 : 1 - Math.exp(-dt * 6));
      tmp.set(carPos.x + a.t.x * 12, 1.0, carPos.z + a.t.z * 12); camLook.lerp(tmp, snapCam ? 1 : 1 - Math.exp(-dt * 8));
      camera.lookAt(camLook); fov = 64 + v * .12;
    }
    snapCam = false;
    fov = fitFov(fov);
    if (Math.abs(camera.fov - fov) > .05) { camera.fov = fov; camera.updateProjectionMatrix(); }
    sky.position.copy(camera.position);

    // dash and HUD numbers
    const kmh = Math.round(v * 3.6), g = Math.min(8, 1 + Math.floor(v / 11));
    const gearTxt = v < 1 ? 'N' : String(g), rpm = v < 1 ? .08 + thrS * .3 : Math.max(.1, Math.min(1, (v - (g - 1) * 11) / 11));
    let nx = ST[0], nd = 1e9;
    ST.forEach(st => { const d = wrapS(st.s - s); if (d < nd) { nd = d; nx = st; } });
    const lapTxt = (lapRunning ? 'LAP ' + lapNo : 'OUT LAP') + (rivalOn ? '  P' + (gapNow() <= 0 ? 1 : 2) : '');
    drawDash(kmh, gearTxt, rpm, thrS, brkS, 'T' + nx.turn + ' ' + nx.short.toUpperCase() + '  ' + Math.round(nd) + ' m', lapTxt);
    if (state !== 'intro') { drawMap(carPos, rivalOn ? R1.group.position : null); uiTick(dt, kmh, v < 1 ? 'N' : 'G' + g); }

    // scenery
    updateRain(dt);
    spray1.update(dt); spray2.update(dt);
    stars.position.copy(camera.position); sunSpr.position.set(camera.position.x + 700, camera.position.y + 900, camera.position.z - 1300);
    flashT += dt; if (flashT > .14) { flashT = 0; shuffleFlashes(); }
    domeT += dt; if (domeT > .08) { domeT = 0; drawDome(now * .001); }
  }

  // The FOVs above are tuned for landscape. Three.js keeps the vertical FOV fixed, so on a tall phone screen the road
  // would look zoomed in; widen it as the screen gets narrower (half-way to matching landscape, capped at 100°).
  function fitFov(f: number) {
    if (camera.aspect >= 1.2) return f;
    const t = Math.tan(f * Math.PI / 360) * Math.sqrt(1.2 / camera.aspect);
    return Math.min(100, Math.atan(t) * 360 / Math.PI);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); sizeMap();
  }
  window.addEventListener('resize', resize, sig);
  resize();
  camera.position.set(startP.x + 12, 7, startP.z + 22);

  applyScene(Math.random() < .7);
  rivalReset();

  let raf = 0, last = performance.now();
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (get().listOpen) return;   // the list view covers the canvas, so don't burn the GPU behind it
    update(dt, now);
    frameNo++; if (frameNo === 8 || frameNo === 160) captureEnv();
    if (envDirty > 0 && --envDirty === 0) captureEnv();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    touch: tc, start, restart, teleport, toggleCam, toggleRival,
    toggleRain: () => setRain(!rainOn),
    dispose() {
      cancelAnimationFrame(raf); clearInterval(cdTimer); ac.abort();
      // Dropping the context frees every geometry, material and texture on the GPU in one go.
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}
