import * as THREE from "three";

THREE.ColorManagement.enabled = false;

let SIM_W, SIM_H;
const LAYERS = 28;

const INTRO_DUR = 2.6;
let introT0 = null;
const easeOutCubic = x => 1 - Math.pow(1 - x, 3);

const cfg = { size: 280, depth: 0.0, dissolve: 0 };
const rig = { rotX: -0.76, rotY: 0.09, rotZ: 0.61, fov: 22 };

const TEX_W = 1024, TEX_H = 512;
function makeGlyphTexture() {
	const c = document.createElement("canvas");
	c.width = TEX_W; c.height = TEX_H;
	const ctx = c.getContext("2d");
	ctx.clearRect(0, 0, TEX_W, TEX_H);
	ctx.fillStyle = "#fff";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = `900 ${cfg.size}px "Arial Black", Impact, sans-serif`;
	ctx.fillText("RUNK", TEX_W / 2, TEX_H / 2);
	const tex = new THREE.CanvasTexture(c);
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	return tex;
}

const renderer = new THREE.WebGLRenderer({
	canvas: document.querySelector(".webgl"),
	antialias: true,
});

const uiToggle = document.getElementById("ui-toggle");
if (uiToggle) {
	uiToggle.addEventListener("click", () => {
		const hidden = document.body.classList.toggle("ui-hidden");
		uiToggle.setAttribute("aria-pressed", String(!hidden));
		uiToggle.textContent = hidden ? "show UI" : "hide UI";
	});
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const textScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
	rig.fov,
	window.innerWidth / window.innerHeight,
	0.1,
	100,
);
camera.position.set(0, 0, 7.5);
camera.lookAt(0, 0, 0);

let glyphTex = makeGlyphTexture();
const textGroup = new THREE.Group();
textScene.add(textGroup);

const frontCol = new THREE.Color(0x4d0d0b);
const backCol = new THREE.Color(0x190303);

function buildTextStack() {
	while (textGroup.children.length) {
		const m = textGroup.children.pop();
		m.geometry.dispose();
		m.material.dispose();
	}
	const W = 7.6, H = W * (TEX_H / TEX_W);
	const n = cfg.depth <= 0.001 ? 1 : LAYERS;
	for (let i = 0; i < n; i++) {
		const t = n === 1 ? 0 : i / (n - 1);
		const mat = new THREE.MeshBasicMaterial({
			map: glyphTex,
			transparent: true,
			alphaTest: 0.5,
			color: frontCol.clone().lerp(backCol, t),
			side: THREE.DoubleSide,
		});
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
		mesh.position.z = -t * cfg.depth;
		textGroup.add(mesh);
	}
}
buildTextStack();

const rtTextOpts = {
	minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
	format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false,
};
const rtSimOpts = {
	minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
	format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
};

let rtText, rtA, rtB;
function makeTargets() {
	SIM_H = 768;
	SIM_W = Math.max(256, Math.round(SIM_H * window.innerWidth / window.innerHeight));
	const dpr = Math.min(window.devicePixelRatio, 2);
	const TXT_W = Math.floor(window.innerWidth * dpr);
	const TXT_H = Math.floor(window.innerHeight * dpr);
	if (rtText) { rtText.dispose(); rtA.dispose(); rtB.dispose(); }
	rtText = new THREE.WebGLRenderTarget(TXT_W, TXT_H, rtTextOpts);
	rtA = new THREE.WebGLRenderTarget(SIM_W, SIM_H, rtSimOpts);
	rtB = new THREE.WebGLRenderTarget(SIM_W, SIM_H, rtSimOpts);
	if (simMat) simMat.uniforms.uTexel.value.set(1 / SIM_W, 1 / SIM_H);
	if (typeof compMat !== "undefined") {
		compMat.uniforms.uTexelC.value.set(1 / TXT_W, 1 / TXT_H);
		compMat.uniforms.uTexelS.value.set(1 / SIM_W, 1 / SIM_H);
	}
}

const simScene = new THREE.Scene();
const simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const simMat = new THREE.ShaderMaterial({
	uniforms: {
		uPrev: { value: null },
		uSrc: { value: null },
		uTexel: { value: new THREE.Vector2(1, 1) },
		uTime: { value: 0 },
		uFrame: { value: 0 },
	},
	vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
  `,
	fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uPrev, uSrc;
    uniform vec2 uTexel;
    uniform float uTime, uFrame;

    const float NECK_FADE  = 0.030;
    const float NECK_KEEP  = 0.035;
    const float DROP_REACH = 5.2;
    const float TENSION    = 0.16;

    float hash(vec2 p){
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(float x){
      float i = floor(x), f = fract(x);
      float a = hash(vec2(i, 0.)), b = hash(vec2(i + 1., 0.));
      return mix(a, b, f * f * (3. - 2. * f));
    }

    void main(){
      float a0 = texture2D(uSrc, vUv).a;
      float a1 = texture2D(uSrc, vUv + vec2(uTexel.x * 2.5, 0.)).a;
      float a2 = texture2D(uSrc, vUv - vec2(uTexel.x * 2.5, 0.)).a;
      float a3 = texture2D(uSrc, vUv + vec2(0., uTexel.y * 2.5)).a;
      float a4 = texture2D(uSrc, vUv - vec2(0., uTexel.y * 2.5)).a;
      float srcA = max(max(a0, a1), max(max(a2, a3), a4));
      float src  = smoothstep(0.03, 0.16, srcA) * 0.95;
      float prev = texture2D(uPrev, vUv).r;

      float col  = vUv.x * 1024.0;

      float visc = noise(col * 0.035) * 0.5
                 + noise(col * 0.13 + 7.0) * 0.25
                 + noise(col * 0.06 + uTime * 0.07) * 0.25;

      float wob = ((noise(col * 0.08 + uTime * 0.15) - 0.5)
                +  (noise(vUv.y * 38.0 + col * 0.013 + uTime * 0.45) - 0.5) * 0.7)
                * uTexel.x * 2.2;
      float grav = 1.0 + (1.0 - vUv.y) * 1.5;
      float up1 = texture2D(uPrev, vUv + vec2(wob,        uTexel.y * grav        )).r;
      float up2 = texture2D(uPrev, vUv + vec2(wob * 1.6,  uTexel.y * 2.0 * grav  )).r;
      float up3 = texture2D(uPrev, vUv + vec2(wob * 2.3,  uTexel.y * 3.2 * grav  )).r;
      float speedN = noise(col * 0.045 + uTime * 0.12);
      float pull = mix(up1, up2, smoothstep(0.45, 0.80, speedN));
      pull = mix(pull, max(pull, up3), smoothstep(0.70, 0.97, speedN));

      float wayAbove = texture2D(uPrev, vUv + vec2(0., uTexel.y * 10.0 * grav)).r;
      float detached = (1.0 - smoothstep(0.04, 0.22, wayAbove))
                     * smoothstep(0.06, 0.30, pull)
                     * (1.0 - src);
      float upFar = texture2D(uPrev, vUv + vec2(wob * 2.0, uTexel.y * DROP_REACH * grav)).r;
      pull = max(pull, upFar * detached);

      float lf = texture2D(uPrev, vUv + vec2(-uTexel.x, uTexel.y * 0.4)).r;
      float rt = texture2D(uPrev, vUv + vec2( uTexel.x, uTexel.y * 0.4)).r;
      float side = max(lf, rt) * (0.944 + visc * 0.035);

      float screenAbove = texture2D(uPrev, vUv + vec2(0.,  uTexel.y)).r;
      float screenBelow = texture2D(uPrev, vUv + vec2(0., -uTexel.y)).r;
      float blur = (lf + rt + screenAbove + screenBelow) * 0.25;

      float lf2 = texture2D(uPrev, vUv + vec2(-uTexel.x * 2.5, 0.)).r;
      float rt2 = texture2D(uPrev, vUv + vec2( uTexel.x * 2.5, 0.)).r;
      float thin    = 1.0 - smoothstep(0.05, 0.35, max(lf2, rt2));
      float hanging = smoothstep(0.15, 0.50, screenAbove)
                    * smoothstep(0.15, 0.50, screenBelow);
      float neck   = thin * hanging * (1.0 - src);
      float breakN = smoothstep(0.45, 0.85, noise(col * 0.05 + uTime * 0.55));
      float pinch  = neck * breakN;

      float keep = 0.980 + visc * 0.019 - pinch * NECK_KEEP;
      float fall = pull * keep;

      float head = pull * (1.0 - smoothstep(0.02, 0.30, screenBelow));
      fall = max(fall, head);

      float flow = 0.36 + visc * 0.44 + 0.18 * noise(col * 0.02 + uTime * 0.30);
      flow = min(1.0, flow + detached * 0.30);

      float target = max(fall, side);
      float v = mix(prev, target, flow);
      v = mix(v, blur, TENSION);
      v = max(v, prev * (0.9965 - pinch * NECK_FADE));
      v = min(v, 1.0);
      v = max(v, src);

      gl_FragColor = vec4(v, 0., 0., 1.);
    }
  `,
});
simScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMat));

const compScene = new THREE.Scene();
const compMat = new THREE.ShaderMaterial({
	uniforms: {
		uSim: { value: null },
		uText: { value: null },
		uTime: { value: 0 },
		uDissolve: { value: cfg.dissolve },
		uTexelC: { value: new THREE.Vector2(1, 1) },
		uTexelS: { value: new THREE.Vector2(1, 1) },
	},
	vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
  `,
	fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uSim, uText;
    uniform float uTime, uDissolve;
    uniform vec2 uTexelC, uTexelS;

    const float FAT_R   = 2.5;
    const float FAT_CAP = 0.42;

    float hash(vec2 p){
      return fract(sin(dot(p, vec2(269.5, 183.3)) + uTime) * 43758.5453);
    }
    float hash2(vec2 p){
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise2(vec2 p){
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3. - 2. * f);
      float a = hash2(i), b = hash2(i + vec2(1,0));
      float c = hash2(i + vec2(0,1)), d = hash2(i + vec2(1,1));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    void main(){
      float v = texture2D(uSim, vUv).r;
      vec4 tc = texture2D(uText, vUv);

      vec2 fo = uTexelS * FAT_R;
      float vb = v * 0.28
        + (texture2D(uSim, vUv + vec2(fo.x, 0.)).r
        +  texture2D(uSim, vUv - vec2(fo.x, 0.)).r
        +  texture2D(uSim, vUv + vec2(0., fo.y)).r
        +  texture2D(uSim, vUv - vec2(0., fo.y)).r) * 0.13
        + (texture2D(uSim, vUv + fo * 0.707).r
        +  texture2D(uSim, vUv - fo * 0.707).r
        +  texture2D(uSim, vUv + vec2(fo.x, -fo.y) * 0.707).r
        +  texture2D(uSim, vUv + vec2(-fo.x, fo.y) * 0.707).r) * 0.05;
      float fat = smoothstep(0.12, 0.44, vb) * FAT_CAP;
      float hiBand = smoothstep(0.72, 0.86, v);
      v = max(v, fat * (1.0 - hiBand));

      float inText = smoothstep(0.25, 0.75, tc.a);
      float dripMask = 1.0 - smoothstep(0.89, 0.925, v) * (1.0 - uDissolve * inText);
      float fall1 = noise2(vec2(vUv.x * 70.0, vUv.y * 7.0 + uTime * 1.6));
      float fall2 = noise2(vec2(vUv.x * 28.0, vUv.y * 3.5 + uTime * 0.8));
      float stream = fall1 * 0.55 + fall2 * 0.45;

      vec3 deepBlue = vec3(0.02, 0.10, 0.45);
      vec3 cyan     = vec3(0.20, 0.95, 1.00);
      vec3 white    = vec3(0.92, 1.00, 1.00);
      vec3 hotRed   = vec3(0.95, 0.18, 0.05);

      vec3 fluid = vec3(0.);
      fluid = mix(fluid, deepBlue, smoothstep(0.03, 0.18, v));
      fluid = mix(fluid, cyan,     smoothstep(0.18, 0.50, v));
      fluid = mix(fluid, white,    smoothstep(0.50, 0.66, v));
      fluid = mix(fluid, hotRed,   smoothstep(0.68, 0.78, v));
      vec3 textRed = vec3(0.42, 0.075, 0.067);
      fluid = mix(fluid, textRed,  smoothstep(0.80, 0.88, v));
      fluid = mix(fluid, vec3(1.0, 0.34, 0.10), smoothstep(0.905, 0.928, v));

      float glow = smoothstep(0.12, 0.5, v) * (1. - smoothstep(0.55, 0.85, v));
      fluid += cyan * glow * 0.35;

      fluid *= mix(1.0, 0.78 + 0.34 * stream, dripMask);

      vec3 col = vec3(0.020, 0.022, 0.028);
      float fluidA = smoothstep(0.03, 0.10, v);
      fluidA *= smoothstep(0.0, 0.12, vUv.y);
      col = mix(col, fluid, fluidA);

      vec3 tcol = tc.rgb / max(tc.a, 0.001);
      float ta = smoothstep(0.25, 0.75, tc.a);
      col = mix(col, tcol, ta * (1.0 - uDissolve));

      float grainMask = max(fluidA, ta);
      col += (hash(gl_FragCoord.xy * 0.7) - 0.5) * 0.10 * grainMask;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
compScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat));

makeTargets();

function clearSim() {
	renderer.setRenderTarget(rtA); renderer.setClearColor(0x000000, 0); renderer.clear();
	renderer.setRenderTarget(rtB); renderer.clear();
	renderer.setRenderTarget(null);
	frame = 0;
	introT0 = null;
}
function rebuildText() {
	const old = glyphTex;
	glyphTex = makeGlyphTexture();
	old.dispose();
	buildTextStack();
	clearSim();
}
const _W = 7.6, _H = _W * (TEX_H / TEX_W);
const _corners = [
	new THREE.Vector3(-_W / 2, -_H / 2, 0), new THREE.Vector3(_W / 2, -_H / 2, 0),
	new THREE.Vector3(_W / 2, _H / 2, 0), new THREE.Vector3(-_W / 2, _H / 2, 0),
];
const _v = new THREE.Vector3();
function recenterTextX() {
	textGroup.position.x = 0;
	textGroup.updateMatrixWorld(true);
	const a = _v.set(0, 0, 0).project(camera).x;
	const b = _v.set(1, 0, 0).project(camera).x;
	const ndcPerWorld = b - a;
	for (let it = 0; it < 4; it++) {
		let min = Infinity, max = -Infinity;
		for (const c of _corners) {
			_v.copy(c).applyEuler(textGroup.rotation);
			_v.x += textGroup.position.x;
			_v.project(camera);
			if (_v.x < min) min = _v.x;
			if (_v.x > max) max = _v.x;
		}
		const centerNdc = (min + max) * 0.5;
		if (Math.abs(centerNdc) < 0.0005) break;
		textGroup.position.x -= centerNdc / ndcPerWorld;
	}
}
function applyRig() {
	textGroup.rotation.set(rig.rotX, rig.rotY, rig.rotZ);
	camera.fov = rig.fov;
	camera.updateProjectionMatrix();
	recenterTextX();
}
function bindSlider(id, obj, key, labelId, fmt, onChange) {
	const el = document.getElementById(id);
	const lab = document.getElementById(labelId);
	const update = () => {
		obj[key] = parseFloat(el.value);
		lab.textContent = fmt(obj[key]);
		onChange();
	};
	el.addEventListener("input", update);
	lab.textContent = fmt(obj[key]);
}
bindSlider("size", cfg, "size", "vSize", v => v + "px", rebuildText);
bindSlider("dissolve", cfg, "dissolve", "vDissolve", v => Math.round(v * 100) + "%",
					 () => { compMat.uniforms.uDissolve.value = cfg.dissolve; });
bindSlider("rotX", rig, "rotX", "vRotX", v => v.toFixed(2) + " rad", applyRig);
bindSlider("rotY", rig, "rotY", "vRotY", v => v.toFixed(2) + " rad", applyRig);
bindSlider("rotZ", rig, "rotZ", "vRotZ", v => v.toFixed(2) + " rad", applyRig);
bindSlider("fov", rig, "fov", "vFov", v => v + "°", applyRig);
document.getElementById("reset").addEventListener("click", clearSim);
applyRig();

let frame = 0;
let running = true;
let startMs = performance.now();
clearSim();

document.addEventListener("visibilitychange", () => {
	if (document.hidden) {
		running = false;
		pausedMs = performance.now();
	} else if (!running) {
		startMs += performance.now() - pausedMs;
		running = true;
		animate();
	}
});
let pausedMs = 0;

function animate() {
	if (!running) return;
	requestAnimationFrame(animate);
	const t = (performance.now() - startMs) / 1000;

	if (introT0 === null) introT0 = t;
	const ip = Math.min((t - introT0) / INTRO_DUR, 1);
	if (ip < 1) {
		const e = easeOutCubic(ip);
		compMat.uniforms.uDissolve.value = 1.0 + (cfg.dissolve - 1.0) * e;
		textGroup.scale.setScalar(1.0 + (1.0 - e) * 0.07);
	} else {
		compMat.uniforms.uDissolve.value = cfg.dissolve;
		textGroup.scale.setScalar(1.0);
	}

	renderer.setRenderTarget(rtText);
	renderer.setClearColor(0x000000, 0);
	renderer.clear();
	renderer.render(textScene, camera);

	for (let i = 0; i < 4; i++) {
		simMat.uniforms.uPrev.value = rtA.texture;
		simMat.uniforms.uSrc.value = rtText.texture;
		simMat.uniforms.uTime.value = t;
		simMat.uniforms.uFrame.value = frame++;
		renderer.setRenderTarget(rtB);
		renderer.render(simScene, simCam);
		[rtA, rtB] = [rtB, rtA];
	}

	renderer.setRenderTarget(null);
	compMat.uniforms.uSim.value = rtA.texture;
	compMat.uniforms.uText.value = rtText.texture;
	compMat.uniforms.uTime.value = t;
	renderer.render(compScene, simCam);
}
animate();

let resizeTimer;
window.addEventListener("resize", () => {
	clearTimeout(resizeTimer);
	resizeTimer = setTimeout(() => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
		makeTargets();
		recenterTextX();
		clearSim();
	}, 150);
});