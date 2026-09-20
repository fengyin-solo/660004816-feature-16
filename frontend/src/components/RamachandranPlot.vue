<template>
  <div class="panel">
    <h3>📊 Ramachandran图 (φ-ψ 二面角空间)</h3>
    <div class="plot-body">
      <div class="canvas-wrap">
        <canvas ref="cvs" width="500" height="500" class="plot-canvas"></canvas>
        <div v-if="!hasBasePoints" class="plot-note">当前聚类筛选下没有落点，无法绘制热区</div>
      </div>
      <aside class="density-pane">
        <div class="density-title">🔥 落点密度热区清单</div>
        <div class="density-filters">
          <el-select v-model="regionFilter" size="small" class="region-select">
            <el-option label="全部区域" value="all" />
            <el-option label="α-螺旋" value="alpha-helix" />
            <el-option label="β-折叠" value="beta-sheet" />
            <el-option label="左手螺旋" value="left-helix" />
            <el-option label="禁阻区" value="disallowed" />
          </el-select>
          <div class="energy-filter">
            <span class="filter-label">LJ能量区间 (kcal/mol)</span>
            <el-slider
              v-model="energyFilter" range :min="eMin" :max="eMax" :step="eStep"
              :disabled="!store.result" size="small"
            />
            <span class="energy-text">{{ energyFilter[0].toFixed(2) }} ~ {{ energyFilter[1].toFixed(2) }}</span>
          </div>
        </div>
        <div class="heat-legend">
          <span>低</span>
          <span class="heat-bar"></span>
          <span>高</span>
          <span class="heat-stat" v-if="hasBasePoints">共 {{ scopedCount }} 点 / {{ densityBins.length }} 区</span>
        </div>
        <div v-if="!hasBasePoints" class="density-empty">
          暂无落点数据。请先生成构象采样，或调整上方聚类筛选。
        </div>
        <div v-else-if="densityBins.length === 0" class="density-empty">
          「{{ regionLabel(regionFilter) }}」在能量 {{ energyFilter[0].toFixed(2) }} ~
          {{ energyFilter[1].toFixed(2) }} 区间内没有落点，请放宽区域或数值区间。
        </div>
        <ul v-else class="bin-list">
          <li
            v-for="(b, i) in densityBins" :key="b.key"
            :class="{ active: b.key === selectedBinKey }"
            @click="toggleBin(b.key)"
            :title="`点击在图上高亮该热区（φ ${b.phi0}~${b.phi1}°, ψ ${b.psi0}~${b.psi1}°）`"
          >
            <span class="rank">{{ i + 1 }}</span>
            <span class="bin-rng">φ [{{ b.phi0 }}, {{ b.phi1 }})<br>ψ [{{ b.psi0 }}, {{ b.psi1 }})</span>
            <span class="bin-meta">
              <b>{{ b.count }}</b> 点
              <span class="bar-track"><span class="bar" :style="{ width: barWidth(b.count) }"></span></span>
            </span>
          </li>
        </ul>
      </aside>
    </div>
    <div class="legend">
      <span class="dot a"></span> α-螺旋 <span class="dot b"></span> β-折叠
      <span class="dot l"></span> 左手螺旋 <span class="dot d"></span> 禁阻区
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue"
import { useProteinStore } from "../store/protein"
import type { Conformation } from "../types"
const store = useProteinStore()
const cvs = ref<HTMLCanvasElement>()

const colors: Record<string, string> = { "alpha-helix": "#4ecdc4", "beta-sheet": "#ff6b6b", "left-helix": "#45b7d1", "disallowed": "#ddd" }

// ---- 密度热区参数：30° 一格，12x12，与背景网格线对齐 ----
const NB = 12
const BIN = 360 / NB

interface DensityBin {
  key: string
  ix: number; iy: number
  phi0: number; phi1: number; psi0: number; psi1: number
  count: number
}

// ---- 热区/清单专属筛选（不影响原有落点颜色、选中高亮与 CSV 导出） ----
const regionFilter = ref("all")
const energyFilter = ref<[number, number]>([0, 1])
const selectedBinKey = ref<string | null>(null)

const eMin = computed(() => store.result?.energyRange[0] ?? 0)
const eMax = computed(() => store.result?.energyRange[1] ?? 1)
const eStep = computed(() => Math.max((eMax.value - eMin.value) / 200, 0.001))

// 重新采样后重置筛选，保证热区随数据重算
watch(() => store.result, (r) => {
  if (r) {
    regionFilter.value = "all"
    energyFilter.value = [r.energyRange[0], r.energyRange[1]]
  }
  selectedBinKey.value = null
})

// 聚类筛选后的落点（与图上原有圆点同一范围）
const baseConfs = computed(() =>
  (store.result?.conformations || []).filter(
    c => store.selectedCluster === "all" || c.cluster === store.selectedCluster
  )
)
const hasBasePoints = computed(() => baseConfs.value.length > 0)

// 热区与清单共用的唯一口径：聚类 + 区域 + 能量区间，只算这一遍
const scopedConfs = computed(() => {
  const [lo, hi] = energyFilter.value
  return baseConfs.value.filter(c =>
    (regionFilter.value === "all" || c.region === regionFilter.value) &&
    c.energy >= lo && c.energy <= hi
  )
})
const scopedCount = computed(() => scopedConfs.value.length)

// 由同一份 scopedConfs 做一次密度分箱，热区着色与清单排序都读它
const densityBins = computed<DensityBin[]>(() => {
  const map = new Map<string, DensityBin>()
  for (const c of scopedConfs.value) {
    let ix = Math.floor((c.phi + 180) / BIN)
    let iy = Math.floor((c.psi + 180) / BIN)
    ix = Math.min(NB - 1, Math.max(0, ix))
    iy = Math.min(NB - 1, Math.max(0, iy))
    const key = `${ix}_${iy}`
    let b = map.get(key)
    if (!b) {
      b = {
        key, ix, iy,
        phi0: -180 + ix * BIN, phi1: -180 + (ix + 1) * BIN,
        psi0: -180 + iy * BIN, psi1: -180 + (iy + 1) * BIN,
        count: 0,
      }
      map.set(key, b)
    }
    b.count++
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.iy - b.iy || a.ix - b.ix
  )
})
const maxBinCount = computed(() => densityBins.value[0]?.count ?? 0)
const selectedBin = computed(() => densityBins.value.find(b => b.key === selectedBinKey.value) || null)

// 筛选后高亮格已不存在时清掉高亮，不残留
watch(densityBins, bins => {
  if (selectedBinKey.value && !bins.some(b => b.key === selectedBinKey.value)) {
    selectedBinKey.value = null
  }
})

function toggleBin(key: string) {
  // 同一条重复点击只在「高亮/取消」间切换，绝不叠加高亮
  selectedBinKey.value = selectedBinKey.value === key ? null : key
}
function barWidth(count: number) {
  return `${maxBinCount.value ? Math.round((count / maxBinCount.value) * 100) : 0}%`
}
function regionLabel(r: string) {
  const m: Record<string, string> = {
    all: "全部区域", "alpha-helix": "α-螺旋", "beta-sheet": "β-折叠",
    "left-helix": "左手螺旋", "disallowed": "禁阻区",
  }
  return m[r] || r
}
// 密度深浅配色：浅黄(低) → 红(高)，与 CSS 中 .heat-bar 渐变保持一致
function heatCss(t: number) {
  const g = Math.round(235 - 215 * t)
  const b = Math.round(120 * (1 - t))
  const alpha = 0.16 + 0.52 * t
  return `rgba(255,${g},${b},${alpha})`
}

function draw() {
  const c = cvs.value!; const ctx = c.getContext("2d")!; const W = c.width, H = c.height
  ctx.clearRect(0, 0, W, H)
  ctx.strokeStyle = "#e8e8e8"; ctx.lineWidth = 1
  for (let a = -180; a <= 180; a += 30) {
    let x = ((a + 180) / 360) * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    let y = ((a + 180) / 360) * H; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
  }
  ctx.fillStyle = "rgba(78,205,196,.08)"; ctx.fillRect(((20) / 360) * W, ((120) / 360) * H, (70 / 360) * W, (70 / 360) * H)
  ctx.fillStyle = "rgba(255,107,107,.08)"; ctx.fillRect(((225) / 360) * W, ((0) / 360) * H, (120 / 360) * W, (70 / 360) * H)

  // ---- 密度热区：读取唯一一份 densityBins，画在落点之下 ----
  const bins = densityBins.value
  const maxC = maxBinCount.value
  const cellW = W / NB, cellH = H / NB
  if (maxC > 0) {
    for (const b of bins) {
      ctx.fillStyle = heatCss(b.count / maxC)
      ctx.fillRect(b.ix * cellW, H - (b.iy + 1) * cellH, cellW, cellH)
    }
  }

  ctx.strokeStyle = "#999"; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke()
  ctx.fillStyle = "#666"; ctx.font = "12px sans-serif"
  ctx.fillText("φ →", W - 30, H / 2 - 6); ctx.fillText("ψ ↑", W / 2 + 6, 16)

  // ---- 原有落点：范围/颜色/半径逻辑保持不变（不受热区筛选影响） ----
  const confs: Conformation[] = baseConfs.value
  if (confs.length) {
    const es = confs.map(c => c.energy); const eMinV = Math.min(...es), eMaxV = Math.max(...es)
    for (const cf of confs) {
      const x = ((cf.phi + 180) / 360) * W, y = H - ((cf.psi + 180) / 360) * H
      const t = (cf.energy - eMinV) / (eMaxV - eMinV || 1), r = 3 + t * 3
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = colors[cf.region] || "#999"; ctx.fill()
      ctx.strokeStyle = "rgba(0,0,0,.1)"; ctx.stroke()
    }
  }
  if (store.selectedConformation) {
    const sc = store.selectedConformation
    ctx.beginPath(); ctx.arc(((sc.phi + 180) / 360) * W, H - ((sc.psi + 180) / 360) * H, 8, 0, Math.PI * 2)
    ctx.strokeStyle = "#333"; ctx.lineWidth = 3; ctx.stroke()
  }

  // ---- 清单选中热区的高亮：单格、虚线紫框，重复点同一条也只画一次 ----
  const sb = selectedBin.value
  if (sb) {
    ctx.save()
    ctx.strokeStyle = "#7c3aed"; ctx.lineWidth = 2.5
    ctx.setLineDash([6, 4])
    ctx.strokeRect(sb.ix * cellW + 1.5, H - (sb.iy + 1) * cellH + 1.5, cellW - 3, cellH - 3)
    ctx.restore()
  }
}
onMounted(draw)
watch(
  [() => store.result, () => store.selectedConformation, () => store.selectedCluster,
   regionFilter, energyFilter, selectedBinKey],
  draw, { deep: true }
)
</script>

<style scoped>
.panel { background: #fff; border-radius: 8px; padding: 16px; box-shadow: 0 2px 8px rgba(0, 0, 0, .08); }
.panel h3 { margin-bottom: 12px; color: #333; }
.plot-body { display: flex; gap: 16px; flex-wrap: wrap; align-items: stretch; }
.canvas-wrap { position: relative; flex: 0 0 auto; }
.plot-canvas { display: block; width: min(380px, 100%); height: auto; margin: 0 auto; border: 1px solid #eee; border-radius: 8px; }
.plot-note {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, .72); color: #999; font-size: 13px; text-align: center; padding: 20px;
}
.density-pane { flex: 1 1 220px; min-width: 220px; display: flex; flex-direction: column; gap: 8px; }
.density-title { font-size: 13px; font-weight: 600; color: #333; }
.density-filters { border: 1px solid #f0f0f0; border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; }
.region-select { width: 100%; }
.filter-label { font-size: 12px; color: #666; }
.energy-filter { display: flex; flex-direction: column; gap: 2px; padding: 0 4px; }
.energy-text { font-size: 11px; color: #999; }
.heat-legend { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #999; }
.heat-bar {
  flex: 0 0 90px; height: 8px; border-radius: 4px;
  background: linear-gradient(90deg, rgba(255, 235, 120, .35), rgba(255, 20, 0, .8));
}
.heat-stat { margin-left: auto; color: #666; }
.density-empty { font-size: 12px; color: #999; background: #fafafa; border: 1px dashed #e0e0e0; border-radius: 6px; padding: 12px; line-height: 1.6; }
.bin-list { list-style: none; margin: 0; padding: 0; max-height: 300px; overflow: auto; border: 1px solid #f0f0f0; border-radius: 6px; }
.bin-list li {
  display: flex; gap: 8px; align-items: center; padding: 6px 8px;
  border-bottom: 1px solid #f5f5f5; font-size: 12px; cursor: pointer;
}
.bin-list li:last-child { border-bottom: none; }
.bin-list li:hover { background: #fff7e6; }
.bin-list li.active { background: #f3e8ff; box-shadow: inset 0 0 0 2px #7c3aed; }
.rank { flex: 0 0 22px; color: #999; font-size: 11px; text-align: right; }
.bin-rng { flex: 1 1 auto; color: #555; line-height: 1.4; }
.bin-meta { flex: 0 0 86px; color: #888; font-size: 11px; }
.bin-meta b { color: #d4380d; font-size: 13px; }
.bar-track { display: block; height: 4px; background: #f0f0f0; border-radius: 2px; margin-top: 3px; overflow: hidden; }
.bar { display: block; height: 100%; background: linear-gradient(90deg, rgba(255, 200, 80, .9), rgba(220, 30, 0, .9)); }
.legend { display: flex; gap: 16px; justify-content: center; margin-top: 12px; font-size: 13px; flex-wrap: wrap; }
.legend .dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
.dot.a { background: #4ecdc4 } .dot.b { background: #ff6b6b } .dot.l { background: #45b7d1 } .dot.d { background: #ddd }
</style>
