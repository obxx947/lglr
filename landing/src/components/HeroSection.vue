<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import * as THREE from 'three'
import gsap from 'gsap'

const canvasRef = ref<HTMLCanvasElement>()
const menuOpen = ref(false)
let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer
let earth: THREE.Mesh, ring: THREE.Group, stars: THREE.Points
let animId: number
const tMouse = { x: 0, y: 0.5 }
const cMouse = { x: 0, y: 0.5 }
let scrollY = 0

function initThree() {
  if (!canvasRef.value) return
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100)
  camera.position.set(0, 0.5, 8)
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, canvas: canvasRef.value })
  renderer.setSize(innerWidth, innerHeight)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2

  // Stars
  const sg = new THREE.BufferGeometry()
  const sc = 3000, sp = new Float32Array(sc * 3)
  for (let i = 0; i < sc * 3; i++) sp[i] = (Math.random() - 0.5) * 40
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.015, transparent: true, opacity: 0.9 }))
  scene.add(stars)

  // Earth
  const loader = new THREE.TextureLoader()
  earth = new THREE.Mesh(new THREE.SphereGeometry(1.6, 80, 80),
    new THREE.MeshStandardMaterial({ map: loader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg'), roughness: 0.8, metalness: 0.1 }))
  scene.add(earth)

  // Atmosphere
  ;[1.62, 1.65].forEach(r => {
    const a = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 64),
      new THREE.ShaderMaterial({
        vertexShader: `varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `varying vec3 vN;void main(){float i=pow(0.6-dot(vN,vec3(0,0,1)),3.0);gl_FragColor=vec4(0.29,0.62,1.0,i*0.35);}`,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
      }))
    scene.add(a)
  })

  // Ring station
  ring = new THREE.Group(); scene.add(ring)
  const rings: [number, number, number, number, number, number?, number?][] = [
    [2.25, 0.08, 0x3a3a40, 0.55, 0.95], [2.33, 0.02, 0xffaa40, 0.2, 0.8, 0x553300, 0.8],
    [2.17, 0.04, 0x2a2a30, 0.7, 0.9], [2.21, 0.01, 0x555560, 0.3, 0.85]
  ]
  rings.forEach(([r, t, c, ro, me, em, ei]) => {
    const g = new THREE.TorusGeometry(r, t, r > 2.2 ? 24 : 8, r > 2.2 ? 160 : 200)
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: ro, metalness: me, emissive: em || 0, emissiveIntensity: ei || 0 })
    ring.add(new THREE.Mesh(g, m))
  })
  ring.add(new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.015, 8, 200), new THREE.MeshBasicMaterial({ color: 0xffcc66 })))
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.08), new THREE.MeshStandardMaterial({ color: 0x4a4a55, roughness: 0.5, metalness: 0.9 }))
    p.position.set(Math.cos(a) * 2.25, Math.sin(a) * 2.25, 0); p.rotation.z = a; ring.add(p)
    const gl = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff9930 }))
    gl.position.set(Math.cos(a) * 2.34, Math.sin(a) * 2.34, 0); ring.add(gl)
  }
  ring.rotation.x = Math.PI / 2

  // Lights
  const sun = new THREE.DirectionalLight(0xffeedd, 3.5); sun.position.set(8, 5, 6); scene.add(sun)
  scene.add(new THREE.DirectionalLight(0x4466aa, 0.6)).position.set(-3, -1, -2)
  scene.add(new THREE.AmbientLight(0x1a1a2e, 1.8))
  const ptL = new THREE.PointLight(0xff9944, 2, 5); ptL.position.set(3, 1, 0); scene.add(ptL)

  animate()
}

function animate() {
  animId = requestAnimationFrame(animate)
  earth.rotation.y += 0.0015; ring.rotation.z -= 0.002; stars.rotation.y += 0.00015
  // Lerp camera
  cMouse.x += (tMouse.x - cMouse.x) * 0.04; cMouse.y += (tMouse.y - cMouse.y) * 0.04
  camera.position.x = cMouse.x * 1.5; camera.position.y = cMouse.y * 1.2
  camera.lookAt(cMouse.x * 0.3, cMouse.y * 0.2, 0)
  // Scroll scale
  const p = Math.min(scrollY / innerHeight, 1)
  const es = 1 - p * 0.5; earth.scale.setScalar(es + (earth.scale.x - es) * 0.06)
  const rs = 1 - p * 0.4; ring.scale.setScalar(rs + (ring.scale.x - rs) * 0.06)
  renderer.render(scene, camera)
}

function onMouseMove(e: MouseEvent) { tMouse.x = (e.clientX / innerWidth - 0.5) * 1.2; tMouse.y = 0.5 + (e.clientY / innerHeight - 0.5) * 0.8 }
function onScroll() { scrollY = window.scrollY }
function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) }

function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }) }
function scrollToFeatures() { document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }) }
onMounted(() => {
  initThree()
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize)
  // GSAP entrance
  gsap.fromTo('.hero-title', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1.2, delay: 0.3, ease: 'power3.out' })
  gsap.fromTo('.hero-sub', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 1, delay: 0.7, ease: 'power2.out' })
  gsap.fromTo('.btn-hero', { opacity: 0, y: 20, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.9, delay: 1.1, ease: 'back.out(1.5)' })
})
onUnmounted(() => {
  cancelAnimationFrame(animId)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResize)
  renderer?.dispose()
})
</script>

<template>
  <div class="hero">
    <canvas ref="canvasRef" class="bg-canvas"></canvas>

    <!-- Hamburger -->
    <div class="hamburger" :class="{ open: menuOpen }" @click="menuOpen = !menuOpen">
      <span></span><span></span><span></span>
    </div>
    <div class="mobile-menu" :class="{ open: menuOpen }">
      <a href="simulator.html" @click="menuOpen = false">⚓ 进入星港</a>
      <a href="#features" @click="menuOpen = false">核心功能</a>
      <a href="#tutorial" @click="menuOpen = false">使用教程</a>
      <a href="#" @click.prevent="menuOpen = false; scrollToTop()">返回顶部</a>
    </div>

    <div class="hero-title">无尽的拉格朗日</div>
    <div class="hero-sub">配 舰 星 港 模 拟 器</div>
    <a href="simulator.html" class="btn-hero">⚓ 进 入 星 港</a>
    <div class="scroll-hint" @click="scrollToFeatures()">▼ 探 索</div>
  </div>
</template>

<style scoped>
.bg-canvas{position:fixed;top:0;left:0;z-index:0;pointer-events:none;width:100vw;height:100vh}
.hero{position:relative;z-index:1;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none}
.hero-title{font-size:clamp(2.2rem,7vw,4.2rem);font-weight:900;background:linear-gradient(180deg,#fff 0%,#4a9eff 35%,#00d4ff 65%,#ffd700 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px;letter-spacing:-0.02em;line-height:1.1;text-shadow:0 0 40px rgba(135,206,250,0.5),0 0 80px rgba(74,158,255,0.3),0 0 120px rgba(0,212,255,0.15)}
.hero-sub{font-size:clamp(0.85rem,2vw,1.2rem);color:rgba(255,255,255,0.5);letter-spacing:10px;margin-bottom:44px}
.btn-hero{pointer-events:auto;padding:16px 52px;font-size:1.05rem;font-weight:600;background:rgba(255,255,255,0.06);backdrop-filter:blur(12px);border:1.2px solid rgba(74,158,255,0.4);border-radius:50px;color:#fff;cursor:pointer;letter-spacing:4px;transition:all 0.5s cubic-bezier(0.22,1,0.36,1);text-decoration:none;display:inline-block;box-shadow:0 0 20px rgba(74,158,255,0.15)}
.btn-hero:hover{background:rgba(74,158,255,0.2);border-color:#4a9eff;box-shadow:0 0 60px rgba(74,158,255,0.4);transform:scale(1.05)}
.scroll-hint{position:absolute;bottom:36px;color:rgba(255,255,255,0.35);font-size:12px;letter-spacing:4px;animation:bounce 2s infinite;pointer-events:auto;cursor:pointer}
@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}

.hamburger{display:none;position:fixed;top:16px;right:16px;z-index:100;width:40px;height:40px;background:rgba(20,30,60,0.4);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.15);border-radius:12px;cursor:pointer;flex-direction:column;align-items:center;justify-content:center;gap:5px}
.hamburger span{display:block;width:20px;height:2px;background:#fff;border-radius:1px;transition:all 0.4s cubic-bezier(0.22,1,0.36,1)}
.hamburger.open span:nth-child(1){transform:rotate(45deg) translateY(5px)}
.hamburger.open span:nth-child(2){opacity:0;transform:scaleX(0)}
.hamburger.open span:nth-child(3){transform:rotate(-45deg) translateY(-5px)}
.mobile-menu{display:none;position:fixed;top:0;right:0;z-index:99;width:85%;max-width:320px;height:100vh;background:rgba(10,10,12,0.96);backdrop-filter:blur(20px);border-left:1px solid rgba(255,255,255,0.08);padding:80px 30px 30px;flex-direction:column;gap:12px;transform:translateX(100%);transition:transform 0.5s cubic-bezier(0.22,1,0.36,1)}
.mobile-menu.open{transform:translateX(0)}
.mobile-menu a{color:rgba(255,255,255,0.7);text-decoration:none;font-size:1rem;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06)}

@media(max-width:768px){.hamburger{display:flex}.mobile-menu{display:flex}}
</style>
