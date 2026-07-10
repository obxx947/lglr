<script setup lang="ts">
import { onMounted, ref } from 'vue'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const statsRef = ref<HTMLElement>()
const countRef = ref<HTMLElement>()

const features = [
  { icon: '⚓', title: '舰队配队', desc: '4个舰队编组(护航/被护航×2)+轰炸编队。点击舰船chip进行模块切换、武器强化、舰载机搭载。🪡缝合模式忽略服役上限。', tags: ['moduleGroup', '舰载机', '缝合'] },
  { icon: '⚔️', title: '战斗模拟', desc: '护航/轰炸双模式。四舰队实时对战，完整锁定→冷却→攻击三阶段。直射/投射区分，实弹破甲/能量穿盾，暴击/拦截/系统损毁。', tags: ['护航免疫', '轰炸', '10x速'] },
  { icon: '📚', title: '舰船图鉴', desc: '163艘舰船完整数据库。17艘超主力舰moduleGroup多槽切换。7分类筛选+搜索，自定义舰船创建管理。', tags: ['7分类', '模块详情', '自定义'] },
  { icon: '🌌', title: '永恒战场', desc: '实时即时制战斗。前中后排三线站位，每舰3艘编组。4个手动技能：前突/后撤/集火/伤害提升。', tags: ['三排', '实时技能', '组选择'] },
  { icon: '🗺️', title: '盟战模拟', desc: '2D星域沙盘。调动/攻击/封锁/驻守4大任务。轰炸+地形+城池AI。时间倍速+暂停控制。', tags: ['Canvas', '4任务', '城池AI'] },
  { icon: '⚡', title: '强化与方案', desc: '每武器独立强化(单发+/锁定-/冷却-/暴击/暴伤/HP/能抗)。模块方案保存/加载/删除。旗舰系统。', tags: ['独立强化', '方案管理', '旗舰'] },
]

const steps = [
  { n: '1', t: '舰队配队', d: '点击面板→展开编辑→添加舰船→切换模块→强化武器→搭载舰载机→保存方案' },
  { n: '2', t: '战斗模拟', d: '配队自动同步→选护航/轰炸→调整速度→开始战斗→实时日志' },
  { n: '3', t: '舰船图鉴', d: '按类型筛选→点击查看完整参数→⚙️自定义分类创建专属舰船' },
  { n: '4', t: '永恒战场', d: '选舰队来源→初始化→用4个技能指挥实时战斗' },
  { n: '5', t: '盟战模拟', d: '编辑模板→部署地图→框选单位→下达任务→模拟推演' },
  { n: '6', t: '模块方案', d: '点击舰船chip→调整配置→保存方案→一键加载切换' },
]

onMounted(() => {
  document.querySelectorAll('.glass-card, .step-card').forEach((el, i) => {
    gsap.fromTo(el, { opacity: 0, y: 40 }, {
      opacity: 1, y: 0, duration: 0.7, delay: i * 0.04,
      scrollTrigger: { trigger: el, start: 'top 88%', toggleActions: 'play none none none' }
    })
  })
  if (countRef.value) {
    gsap.fromTo(countRef.value, { innerText: 0 }, {
      innerText: 163, duration: 2, snap: { innerText: 1 },
      scrollTrigger: { trigger: statsRef.value, start: 'top 80%' }
    })
  }
})
</script>

<template>
  <div class="content">
    <div class="content-inner">
      <div ref="statsRef" class="stats liquid-glass" id="stats">
        <div class="stat"><div ref="countRef" class="sn">163</div><div class="sl">艘舰船</div></div>
        <div class="stat"><div class="sn2">17</div><div class="sl">超主力舰</div></div>
        <div class="stat"><div class="sn2">6</div><div class="sl">功能模块</div></div>
        <div class="stat"><div class="sn2">24</div><div class="sl">源码数据文件</div></div>
      </div>

      <div class="section-title text-glow" id="features"><span>核 心 功 能</span></div>
      <div class="cards-grid">
        <div v-for="f in features" :key="f.title" class="glass-card liquid-glass">
          <div class="ci">{{ f.icon }}</div>
          <div class="ct">{{ f.title }}</div>
          <div class="cd">{{ f.desc }}</div>
          <div class="tags"><span v-for="t in f.tags" :key="t">{{ t }}</span></div>
        </div>
      </div>

      <div class="section-title text-glow" id="tutorial"><span>使 用 教 程</span></div>
      <div class="steps">
        <div v-for="s in steps" :key="s.n" class="step-card liquid-glass">
          <div class="sn">{{ s.n }}</div>
          <div class="st">{{ s.t }}</div>
          <div class="sd">{{ s.d }}</div>
        </div>
      </div>

      <div class="footer">游戏名:能二 | 编号:10636401507 | 无尽的拉格朗日 配舰星港模拟器 | Vue3 + Vite + TS</div>
    </div>
  </div>
</template>

<style scoped>
.content{position:relative;z-index:2;background:linear-gradient(180deg,transparent 0%,rgba(5,8,20,0.97) 12%,#0a0a0c 100%);padding:60px 20px 80px}
.content-inner{max-width:1200px;margin:0 auto;position:relative;z-index:1}
.section-title{text-align:center;font-size:clamp(1.5rem,3vw,2rem);font-weight:800;margin:50px 0 30px;letter-spacing:3px}
.section-title span{background:linear-gradient(135deg,#4a9eff,#00d4ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.text-glow{text-shadow:0 0 40px rgba(135,206,250,0.5),0 0 80px rgba(74,158,255,0.3),0 0 120px rgba(0,212,255,0.15)}

.cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;margin-bottom:40px}
.glass-card{padding:28px 24px;transition:all 0.5s cubic-bezier(0.22,1,0.36,1);cursor:default}
.glass-card:hover{background:rgba(30,50,80,0.25);transform:translateY(-4px);box-shadow:0 12px 40px rgba(74,158,255,0.15)}
.ci{font-size:2.2rem;margin-bottom:14px}
.ct{font-size:1.05rem;font-weight:700;margin-bottom:8px;color:#e0e8ff}
.cd{font-size:0.82rem;color:rgba(200,210,230,0.6);line-height:1.65}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
.tags span{padding:4px 10px;background:rgba(74,158,255,0.1);border:1px solid rgba(74,158,255,0.25);border-radius:20px;font-size:0.68rem;color:#8bc4ff}

.steps{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:40px}
.step-card{padding:20px 16px;text-align:center;transition:all 0.5s cubic-bezier(0.22,1,0.36,1)}
.sn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;background:linear-gradient(135deg,#4a9eff,#00d4ff);border-radius:50%;font-weight:800;font-size:0.85rem;color:#000;margin-bottom:10px}
.st{font-size:0.9rem;font-weight:700;margin-bottom:6px}
.sd{font-size:0.75rem;color:rgba(200,210,230,0.5);line-height:1.5}

.stats{display:flex;flex-wrap:wrap;justify-content:center;gap:40px;margin:40px 0;padding:24px}
.stat{text-align:center}
.sn2{font-size:1.3rem;font-weight:900;background:linear-gradient(135deg,#ffd700,#ff9f43);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sl{font-size:0.72rem;color:rgba(200,210,230,0.5);margin-top:4px;letter-spacing:1px}

.liquid-glass{background:rgba(20,30,60,0.15);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:none;box-shadow:inset 0 1px 1px rgba(255,255,255,0.08);position:relative;overflow:hidden;border-radius:16px}
.liquid-glass::before{content:'';position:absolute;inset:0;border-radius:inherit;padding:1.2px;background:linear-gradient(180deg,rgba(74,158,255,0.35) 0%,rgba(0,212,255,0.12) 25%,rgba(255,255,255,0) 45%,rgba(255,255,255,0) 55%,rgba(0,212,255,0.12) 75%,rgba(74,158,255,0.35) 100%);-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}

.footer{text-align:center;padding:30px;color:rgba(255,255,255,0.25);font-size:0.65rem;letter-spacing:3px}
@media(max-width:768px){.cards-grid,.steps{grid-template-columns:1fr}.stats{gap:24px}}
</style>
