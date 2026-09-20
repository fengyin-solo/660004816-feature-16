<template>
  <div class="panel">
    <h3>📊 Ramachandran图 (φ-ψ 二面角空间)</h3>
    <div class="plot-wrap">
      <!-- 左侧：落点图 + 密度热区（热区与清单共用 densityBins 这一份口径） -->
      <div class="canvas-box">
        <canvas ref="cvs" width="500" height="500" class="plot-canvas"></canvas>
        <div v-if="emptyNote" class="plot-empty">
          <div class="empty-title">🕳️ {{ emptyNote.title }}</div>
          <div class="empty-hint">{{ emptyNote.hint }}</div>
          <el-button v-if="emptyNote.canReset" size="small" type="primary" plain @click="resetFilters">重置区域/能量筛选</el-button>
        </div>
      </div>

      <!-- 右侧：筛选 + 按密度排序的定位清单 -->
      <div class="density-side">
        <div class="density-controls">
          <div class="ctrl-row">
            <span class="ctrl-label">落点区域</span>
            <el-select v-model="regionFilter" size="small" style="flex:1">
              <el-option label="全部区域" value="all" />
              <el-option
                v-for="r in regionOptions" :key="r.value"
                :label="`${r.label} (${r.count})`" :value="r.value"
              />
            </el-select>
          </div>
          <div class="ctrl-row">
            <span class="ctrl-label">LJ能量区间</span>
            <el-slider
              v-model="energyRange" range size="small"
              :min="sliderBounds[0]" :max="sliderBounds[1]" :step="0.01"
              style="flex:1;margin:0 8px"
            />
          </div>
          <div class="ctrl-row range-text">
            {{ energyRange[0].toFixed(2) }} ~ {{ energyRange[1].toFixed(2) }} kcal/mol
            <el-button link size="small" @click="resetFilters">重置</el-button>
          </div>
        </div>

        <div class="list-head">
          🔥 密度定位清单
          <span class="list-sub">{{ densityBins.length }} 个密集位置 · {{ filteredConfs.length }} 个落点</span>
        </div>
        <div class="density-list">
          <div v-if="emptyNote" class="list-empty">
            <template v-if="!store.result">请先生成构象采样。</template>
            <template v-else-if="baseConfs.length === 0">当前聚类筛选下没有落点，请先在上方聚类筛选中选择「全部」。</template>
            <template v-else>
              当前筛选组合下没有落点，热区暂无可绘制内容。<br />
              请放宽区域或能量区间后重试。
            </template>
          </div>
          <div
            v-for="(b, i) in densityBins" :key="b.key"
            class="bin-row" :class="{ active: highlightKey === b.key }"
            @click="toggleBin(b.key)"
          >
            <span class="rank">{{ i + 1 }}</span>
            <span class="count-badge">{{ b.count }} 点</span>
            <span class="comp-bar" :title="compositionTitle(b)">
              <i
                v-for="(n, reg) in b.regions" :key="reg"
                :style="{ width: (n / b.count * 100) + '%', background: regionColor(reg) }"
              ></i>
            </span>
            <span class="bin-desc">
              <span class="bin-region" :style="{ color: regionColor(b.dominant) }">● {{ regionLabel(b.dominant) }}</span>
              <span class="bin-angles">φ {{ b.phiCenter.toFixed(0) }}° / ψ {{ b.psiCenter.toFixed(0) }}°</span>
              <span class="bin-energy">均能 {{ b.avgEnergy.toFixed(2) }}</span>
            </span>
          </div>
        </div>

        <div class="heat-legend">
          <span>密度低</span>
          <span class="heat-bar"></span>
          <span>密度高</span>
        </div>
      </div>
    </div>
    <div class="legend">
      <span class="dot a"></span> α-螺旋 <span class="dot b"></span> β-折叠
      <span class="dot l"></span> 左手螺旋 <span class="dot d"></span> 禁阻区
      <span class="legend-hl"></span> 清单定位高亮
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
const REGIONS = [
  { value: "alpha-helix", label: "α-螺旋" },
  { value: "beta-sheet", label: "β-折叠" },
  { value: "left-helix", label: "左手螺旋" },
  { value: "disallowed", label: "禁阻区" },
]
const GRID = 24 // φ/ψ 各 -180~180°，划分 24×24 个密度箱（每箱 15°）

interface DensityBin {
  key: number
  col: number
  row: number
  count: number
  phiCenter: number
  psiCenter: number
  avgEnergy: number
  regions: Record<string, number>
  dominant: string
}

/* ---------- 本地筛选（只作用于热区与定位清单的口径） ---------- */
const regionFilter = ref<string>("all")
const energyRange = ref<number[]>(
  store.result ? [store.result.energyRange[0], store.result.energyRange[1]] : [0, 1]
)
const highlightKey = ref<number | null>(null) // 清单点击的密集位置（按箱去重，只保留一个）

/* ---------- 唯一口径：基础集 -> 筛选集 -> 密度箱，热区与清单都从这里取数 ---------- */
// 1) 与原图一致：先过全局聚类筛选
const baseConfs = computed<Conformation[]>(() =>
  (store.result?.conformations || []).filter(
    c => store.selectedCluster === "all" || c.cluster === store.selectedCluster
  )
)
// 2) 再过本地的区域 + 能量区间筛选
const filteredConfs = computed<Conformation[]>(() => {
  const [emin, emax] = energyRange.value
  return baseConfs.value.filter(
    c => (regionFilter.value === "all" || c.region === regionFilter.value) && c.energy >= emin && c.energy <= emax
  )
})
// 3) 分箱聚合 —— 全组件只在这里算一次密度，热区绘制和定位清单共用此结果
const densityBins = computed<DensityBin[]>(() => {
  const bins = new Map<number, DensityBin & { energySum: number }>()
  for (const cf of filteredConfs.value) {
    const col = clamp(Math.floor(((cf.phi + 180) / 360) * GRID), 0, GRID - 1)
    const row = clamp(GRID - 1 - Math.floor(((cf.psi + 180) / 360) * GRID), 0, GRID - 1)
    const key = row * GRID + col
    let bin = bins.get(key)
    if (!bin) {
      bin = { key, col, row, count: 0, energySum: 0, phiCenter: 0, psiCenter: 0, avgEnergy: 0, regions: {}, dominant: "disallowed" }
      bins.set(key, bin)
    }
    bin.count++
    bin.energySum += cf.energy
    bin.regions[cf.region] = (bin.regions[cf.region] || 0) + 1
  }
  const out: DensityBin[] = []
  for (const b of bins.values()) {
    const phiCenter = -180 + ((b.col + 0.5) / GRID) * 360
    const psiCenter = -180 + ((GRID - 1 - b.row + 0.5) / GRID) * 360
    const dominant = Object.entries(b.regions).sort((a, z) => z[1] - a[1])[0]?.[0] ?? "disallowed"
    out.push({ key: b.key, col: b.col, row: b.row, count: b.count, phiCenter, psiCenter, avgEnergy: b.energySum / b.count, regions: b.regions, dominant })
  }
  // 按密度（箱内落点数）降序，密度相同则均能低者靠前
  return out.sort((a, b) => b.count - a.count || a.avgEnergy - b.avgEnergy)
})
const maxDensity = computed(() => densityBins.value.reduce((m, b) => Math.max(m, b.count), 0))

const regionOptions = computed(() =>
  REGIONS.map(r => ({ ...r, count: baseConfs.value.filter(c => c.region === r.value).length }))
)

// 滑杆边界（eMin===eMax 时撑开一点，避免 range 滑杆失效）
const sliderBounds = computed<[number, number]>(() => {
  const r = store.result?.energyRange ?? [0, 1]
  return r[0] === r[1] ? [r[0] - 0.01, r[1] + 0.01] : [r[0], r[1]]
})

const emptyNote = computed<{ title: string; hint: string; canReset: boolean } | null>(() => {
  if (!store.result) return { title: "暂无采样数据", hint: "请先点击「生成构象采样」。", canReset: false }
  if (baseConfs.value.length === 0)
    return { title: "当前聚类筛选下没有落点", hint: "没有任何落点可用于密度统计，请在上方聚类筛选中切换。", canReset: false }
  if (filteredConfs.value.length === 0) {
    const regionName = regionFilter.value === "all" ? "全部区域" : REGIONS.find(r => r.value === regionFilter.value)?.label ?? regionFilter.value
    return {
      title: "筛选后没有落点",
      hint: `「${regionName}」在能量 ${energyRange.value[0].toFixed(2)} ~ ${energyRange.value[1].toFixed(2)} 区间内没有落点，该类为空，热区未绘制。请放宽条件。`,
      canReset: true,
    }
  }
  return null
})

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }
function regionLabel(r: string) { return REGIONS.find(x => x.value === r)?.label ?? r }
function regionColor(r: string) { return colors[r] ?? "#999" }
function compositionTitle(b: DensityBin) {
  return Object.entries(b.regions)
    .sort((a, z) => z[1] - a[1])
    .map(([reg, n]) => `${regionLabel(reg)} ${n} 点`)
    .join(" · ")
}
function toggleBin(key: number) { highlightKey.value = highlightKey.value === key ? null : key }
function resetFilters() {
  regionFilter.value = "all"
  const r = store.result?.energyRange
  energyRange.value = r ? [r[0], r[1]] : [0, 1]
}

// 密度色阶（YlOrRd：浅黄 → 橙 → 深红），透明度也随密度加深
function heatColor(t: number): string {
  const stops: [number, number, number][] = [[255, 255, 204], [254, 178, 76], [237, 74, 36]]
  const seg = t < 0.5 ? 0 : 1
  const lt = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5
  const s0 = stops[seg], s1 = stops[seg + 1]
  const r = Math.round(s0[0] + (s1[0] - s0[0]) * lt)
  const g = Math.round(s0[1] + (s1[1] - s0[1]) * lt)
  const bl = Math.round(s0[2] + (s1[2] - s0[2]) * lt)
  return `rgba(${r},${g},${bl},${(0.12 + 0.62 * t).toFixed(3)})`
}

function draw() {
  const c = cvs.value!; const ctx = c.getContext("2d")!; const W = c.width, H = c.height
  ctx.clearRect(0, 0, W, H)
  // 网格
  ctx.strokeStyle = "#e8e8e8"; ctx.lineWidth = 1
  for (let a = -180; a <= 180; a += 30) {
    let x = ((a + 180) / 360) * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    let y = ((a + 180) / 360) * H; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
  }
  // 区域底纹（原图行为保留）
  ctx.fillStyle = "rgba(78,205,196,.08)"; ctx.fillRect(((20) / 360) * W, ((120) / 360) * H, (70 / 360) * W, (70 / 360) * H)
  ctx.fillStyle = "rgba(255,107,107,.08)"; ctx.fillRect(((225) / 360) * W, ((0) / 360) * H, (120 / 360) * W, (70 / 360) * H)

  // 密度热区：直接使用清单同一份 densityBins，不再另行计算
  if (densityBins.value.length > 0) {
    const cellW = W / GRID, cellH = H / GRID
    for (const b of densityBins.value) {
      const t = Math.sqrt(b.count / (maxDensity.value || 1))
      ctx.fillStyle = heatColor(t)
      ctx.fillRect(b.col * cellW - 0.5, b.row * cellH - 0.5, cellW + 1, cellH + 1)
    }
  }

  // 坐标轴与标签
  ctx.strokeStyle = "#999"; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke()
  ctx.fillStyle = "#666"; ctx.font = "12px sans-serif"
  ctx.fillText("φ →", W - 30, H / 2 - 6); ctx.fillText("ψ ↑", W / 2 + 6, 16)

  // 原始落点：颜色、能量半径逻辑完全不变（仅受原全局聚类筛选影响）
  const confs = baseConfs.value
  if (confs.length > 0) {
    const es = confs.map(c => c.energy); const eMin = Math.min(...es), eMax = Math.max(...es)
    for (const cf of confs) {
      const x = ((cf.phi + 180) / 360) * W, y = H - ((cf.psi + 180) / 360) * H
      const t = (cf.energy - eMin) / (eMax - eMin || 1), r = 3 + t * 3
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = colors[cf.region] || "#999"; ctx.fill()
      ctx.strokeStyle = "rgba(0,0,0,.1)"; ctx.stroke()
    }
  }

  // 清单定位高亮：按密度箱画一个圈，箱内重复落点共用同一个圈，不叠加
  if (highlightKey.value !== null) {
    const b = densityBins.value.find(x => x.key === highlightKey.value)
    if (b) {
      const cellW = W / GRID, cellH = H / GRID
      ctx.beginPath()
      ctx.arc((b.col + 0.5) * cellW, (b.row + 0.5) * cellH, cellW * 0.72, 0, Math.PI * 2)
      ctx.fillStyle = "rgba(255,152,0,.10)"; ctx.fill()
      ctx.setLineDash([6, 4]); ctx.strokeStyle = "#ff8800"; ctx.lineWidth = 2.5; ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // 原有选中构象高亮（行为不变）
  if (store.selectedConformation) {
    const sc = store.selectedConformation
    ctx.beginPath(); ctx.arc(((sc.phi + 180) / 360) * W, H - ((sc.psi + 180) / 360) * H, 8, 0, Math.PI * 2)
    ctx.strokeStyle = "#333"; ctx.lineWidth = 3; ctx.stroke()
  }
}

onMounted(draw)
// 原有数据源变化仍触发重绘
watch(() => [store.result, store.selectedConformation, store.selectedCluster], draw, { deep: true })
// 密度口径或清单高亮变化时重绘：筛选切换 -> densityBins 重算 -> 热区自动跟着重算
watch([densityBins, highlightKey], draw)
// 重新采样后重置本地筛选与高亮
watch(() => store.result, () => { resetFilters(); highlightKey.value = null })
// 筛选导致被高亮的密度箱消失时，同步取消高亮
watch(densityBins, bins => {
  if (highlightKey.value !== null && !bins.some(b => b.key === highlightKey.value)) highlightKey.value = null
})
</script>

<style scoped>
.panel { background: #fff; border-radius: 8px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.panel h3 { margin-bottom: 12px; color: #333; }
.plot-wrap { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.canvas-box { position: relative; flex: 0 0 auto; }
.plot-canvas { display: block; border: 1px solid #eee; border-radius: 8px; }
.plot-empty {
  position: absolute; inset: 0; display: flex; flex-direction: column; gap: 10px;
  align-items: center; justify-content: center; text-align: center; padding: 24px;
  background: rgba(255,255,255,.82); border-radius: 8px;
}
.empty-title { font-size: 15px; font-weight: 600; color: #333; }
.empty-hint { font-size: 13px; color: #888; line-height: 1.6; max-width: 320px; }

.density-side { flex: 1 1 300px; min-width: 280px; display: flex; flex-direction: column; }
.density-controls { border: 1px solid #eee; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
.ctrl-row { display: flex; align-items: center; font-size: 13px; }
.ctrl-row + .ctrl-row { margin-top: 8px; }
.ctrl-label { color: #555; width: 86px; flex: 0 0 auto; }
.range-text { justify-content: space-between; color: #999; padding-left: 0; }

.list-head { font-size: 14px; font-weight: 600; color: #333; display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.list-sub { font-size: 12px; font-weight: 400; color: #999; }
.density-list { max-height: 402px; overflow-y: auto; border: 1px solid #eee; border-radius: 8px; }
.list-empty { padding: 20px 14px; font-size: 13px; color: #999; line-height: 1.7; text-align: center; }
.bin-row {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px; cursor: pointer;
  border-bottom: 1px solid #f2f2f2; font-size: 12px; transition: background .15s;
}
.bin-row:last-child { border-bottom: none; }
.bin-row:hover { background: #faf7f0; }
.bin-row.active { background: #fff3e0; box-shadow: inset 3px 0 0 #ff8800; }
.rank { width: 22px; flex: 0 0 auto; text-align: right; color: #aaa; font-variant-numeric: tabular-nums; }
.bin-row.active .rank { color: #ff8800; font-weight: 700; }
.count-badge {
  flex: 0 0 auto; min-width: 42px; text-align: center; padding: 1px 6px;
  background: #f0f2f5; border-radius: 10px; color: #444; font-weight: 600;
}
.bin-row.active .count-badge { background: #ffe0b2; color: #e65100; }
.comp-bar { flex: 0 0 64px; height: 8px; border-radius: 4px; display: flex; overflow: hidden; background: #f5f5f5; }
.comp-bar i { display: block; height: 100%; }
.bin-desc { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.bin-region { font-size: 12px; font-weight: 600; }
.bin-angles, .bin-energy { color: #888; font-variant-numeric: tabular-nums; }

.heat-legend { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: #999; }
.heat-bar {
  flex: 1; height: 10px; border-radius: 5px;
  background: linear-gradient(to right, rgba(255,255,204,.12), rgb(254,178,76), rgb(237,74,36));
}

.legend { display: flex; gap: 16px; justify-content: center; margin-top: 12px; font-size: 13px; flex-wrap: wrap; }
.legend .dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
.dot.a { background: #4ecdc4; } .dot.b { background: #ff6b6b; } .dot.l { background: #45b7d1; } .dot.d { background: #ddd; }
.legend-hl {
  display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 4px;
  border: 2px dashed #ff8800; background: rgba(255,152,0,.12); vertical-align: middle;
}
</style>
