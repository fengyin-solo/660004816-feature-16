/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
import { ref, computed, watch, onMounted } from "vue";
import { useProteinStore } from "../store/protein";
const store = useProteinStore();
const cvs = ref();
const colors = { "alpha-helix": "#4ecdc4", "beta-sheet": "#ff6b6b", "left-helix": "#45b7d1", "disallowed": "#ddd" };
const REGIONS = [
    { value: "alpha-helix", label: "α-螺旋" },
    { value: "beta-sheet", label: "β-折叠" },
    { value: "left-helix", label: "左手螺旋" },
    { value: "disallowed", label: "禁阻区" },
];
const GRID = 24; // φ/ψ 各 -180~180°，划分 24×24 个密度箱（每箱 15°）
/* ---------- 本地筛选（只作用于热区与定位清单的口径） ---------- */
const regionFilter = ref("all");
const energyRange = ref(store.result ? [store.result.energyRange[0], store.result.energyRange[1]] : [0, 1]);
const highlightKey = ref(null); // 清单点击的密集位置（按箱去重，只保留一个）
/* ---------- 唯一口径：基础集 -> 筛选集 -> 密度箱，热区与清单都从这里取数 ---------- */
// 1) 与原图一致：先过全局聚类筛选
const baseConfs = computed(() => (store.result?.conformations || []).filter(c => store.selectedCluster === "all" || c.cluster === store.selectedCluster));
// 2) 再过本地的区域 + 能量区间筛选
const filteredConfs = computed(() => {
    const [emin, emax] = energyRange.value;
    return baseConfs.value.filter(c => (regionFilter.value === "all" || c.region === regionFilter.value) && c.energy >= emin && c.energy <= emax);
});
// 3) 分箱聚合 —— 全组件只在这里算一次密度，热区绘制和定位清单共用此结果
const densityBins = computed(() => {
    const bins = new Map();
    for (const cf of filteredConfs.value) {
        const col = clamp(Math.floor(((cf.phi + 180) / 360) * GRID), 0, GRID - 1);
        const row = clamp(GRID - 1 - Math.floor(((cf.psi + 180) / 360) * GRID), 0, GRID - 1);
        const key = row * GRID + col;
        let bin = bins.get(key);
        if (!bin) {
            bin = { key, col, row, count: 0, energySum: 0, phiCenter: 0, psiCenter: 0, avgEnergy: 0, regions: {}, dominant: "disallowed" };
            bins.set(key, bin);
        }
        bin.count++;
        bin.energySum += cf.energy;
        bin.regions[cf.region] = (bin.regions[cf.region] || 0) + 1;
    }
    const out = [];
    for (const b of bins.values()) {
        const phiCenter = -180 + ((b.col + 0.5) / GRID) * 360;
        const psiCenter = -180 + ((GRID - 1 - b.row + 0.5) / GRID) * 360;
        const dominant = Object.entries(b.regions).sort((a, z) => z[1] - a[1])[0]?.[0] ?? "disallowed";
        out.push({ key: b.key, col: b.col, row: b.row, count: b.count, phiCenter, psiCenter, avgEnergy: b.energySum / b.count, regions: b.regions, dominant });
    }
    // 按密度（箱内落点数）降序，密度相同则均能低者靠前
    return out.sort((a, b) => b.count - a.count || a.avgEnergy - b.avgEnergy);
});
const maxDensity = computed(() => densityBins.value.reduce((m, b) => Math.max(m, b.count), 0));
const regionOptions = computed(() => REGIONS.map(r => ({ ...r, count: baseConfs.value.filter(c => c.region === r.value).length })));
// 滑杆边界（eMin===eMax 时撑开一点，避免 range 滑杆失效）
const sliderBounds = computed(() => {
    const r = store.result?.energyRange ?? [0, 1];
    return r[0] === r[1] ? [r[0] - 0.01, r[1] + 0.01] : [r[0], r[1]];
});
const emptyNote = computed(() => {
    if (!store.result)
        return { title: "暂无采样数据", hint: "请先点击「生成构象采样」。", canReset: false };
    if (baseConfs.value.length === 0)
        return { title: "当前聚类筛选下没有落点", hint: "没有任何落点可用于密度统计，请在上方聚类筛选中切换。", canReset: false };
    if (filteredConfs.value.length === 0) {
        const regionName = regionFilter.value === "all" ? "全部区域" : REGIONS.find(r => r.value === regionFilter.value)?.label ?? regionFilter.value;
        return {
            title: "筛选后没有落点",
            hint: `「${regionName}」在能量 ${energyRange.value[0].toFixed(2)} ~ ${energyRange.value[1].toFixed(2)} 区间内没有落点，该类为空，热区未绘制。请放宽条件。`,
            canReset: true,
        };
    }
    return null;
});
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function regionLabel(r) { return REGIONS.find(x => x.value === r)?.label ?? r; }
function regionColor(r) { return colors[r] ?? "#999"; }
function compositionTitle(b) {
    return Object.entries(b.regions)
        .sort((a, z) => z[1] - a[1])
        .map(([reg, n]) => `${regionLabel(reg)} ${n} 点`)
        .join(" · ");
}
function toggleBin(key) { highlightKey.value = highlightKey.value === key ? null : key; }
function resetFilters() {
    regionFilter.value = "all";
    const r = store.result?.energyRange;
    energyRange.value = r ? [r[0], r[1]] : [0, 1];
}
// 密度色阶（YlOrRd：浅黄 → 橙 → 深红），透明度也随密度加深
function heatColor(t) {
    const stops = [[255, 255, 204], [254, 178, 76], [237, 74, 36]];
    const seg = t < 0.5 ? 0 : 1;
    const lt = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
    const s0 = stops[seg], s1 = stops[seg + 1];
    const r = Math.round(s0[0] + (s1[0] - s0[0]) * lt);
    const g = Math.round(s0[1] + (s1[1] - s0[1]) * lt);
    const bl = Math.round(s0[2] + (s1[2] - s0[2]) * lt);
    return `rgba(${r},${g},${bl},${(0.12 + 0.62 * t).toFixed(3)})`;
}
function draw() {
    const c = cvs.value;
    const ctx = c.getContext("2d");
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    // 网格
    ctx.strokeStyle = "#e8e8e8";
    ctx.lineWidth = 1;
    for (let a = -180; a <= 180; a += 30) {
        let x = ((a + 180) / 360) * W;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
        let y = ((a + 180) / 360) * H;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
    }
    // 区域底纹（原图行为保留）
    ctx.fillStyle = "rgba(78,205,196,.08)";
    ctx.fillRect(((20) / 360) * W, ((120) / 360) * H, (70 / 360) * W, (70 / 360) * H);
    ctx.fillStyle = "rgba(255,107,107,.08)";
    ctx.fillRect(((225) / 360) * W, ((0) / 360) * H, (120 / 360) * W, (70 / 360) * H);
    // 密度热区：直接使用清单同一份 densityBins，不再另行计算
    if (densityBins.value.length > 0) {
        const cellW = W / GRID, cellH = H / GRID;
        for (const b of densityBins.value) {
            const t = Math.sqrt(b.count / (maxDensity.value || 1));
            ctx.fillStyle = heatColor(t);
            ctx.fillRect(b.col * cellW - 0.5, b.row * cellH - 0.5, cellW + 1, cellH + 1);
        }
    }
    // 坐标轴与标签
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.fillStyle = "#666";
    ctx.font = "12px sans-serif";
    ctx.fillText("φ →", W - 30, H / 2 - 6);
    ctx.fillText("ψ ↑", W / 2 + 6, 16);
    // 原始落点：颜色、能量半径逻辑完全不变（仅受原全局聚类筛选影响）
    const confs = baseConfs.value;
    if (confs.length > 0) {
        const es = confs.map(c => c.energy);
        const eMin = Math.min(...es), eMax = Math.max(...es);
        for (const cf of confs) {
            const x = ((cf.phi + 180) / 360) * W, y = H - ((cf.psi + 180) / 360) * H;
            const t = (cf.energy - eMin) / (eMax - eMin || 1), r = 3 + t * 3;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = colors[cf.region] || "#999";
            ctx.fill();
            ctx.strokeStyle = "rgba(0,0,0,.1)";
            ctx.stroke();
        }
    }
    // 清单定位高亮：按密度箱画一个圈，箱内重复落点共用同一个圈，不叠加
    if (highlightKey.value !== null) {
        const b = densityBins.value.find(x => x.key === highlightKey.value);
        if (b) {
            const cellW = W / GRID, cellH = H / GRID;
            ctx.beginPath();
            ctx.arc((b.col + 0.5) * cellW, (b.row + 0.5) * cellH, cellW * 0.72, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255,152,0,.10)";
            ctx.fill();
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = "#ff8800";
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
    // 原有选中构象高亮（行为不变）
    if (store.selectedConformation) {
        const sc = store.selectedConformation;
        ctx.beginPath();
        ctx.arc(((sc.phi + 180) / 360) * W, H - ((sc.psi + 180) / 360) * H, 8, 0, Math.PI * 2);
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 3;
        ctx.stroke();
    }
}
onMounted(draw);
// 原有数据源变化仍触发重绘
watch(() => [store.result, store.selectedConformation, store.selectedCluster], draw, { deep: true });
// 密度口径或清单高亮变化时重绘：筛选切换 -> densityBins 重算 -> 热区自动跟着重算
watch([densityBins, highlightKey], draw);
// 重新采样后重置本地筛选与高亮
watch(() => store.result, () => { resetFilters(); highlightKey.value = null; });
// 筛选导致被高亮的密度箱消失时，同步取消高亮
watch(densityBins, bins => {
    if (highlightKey.value !== null && !bins.some(b => b.key === highlightKey.value))
        highlightKey.value = null;
});
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['ctrl-row']} */ ;
/** @type {__VLS_StyleScopedClasses['ctrl-row']} */ ;
/** @type {__VLS_StyleScopedClasses['bin-row']} */ ;
/** @type {__VLS_StyleScopedClasses['bin-row']} */ ;
/** @type {__VLS_StyleScopedClasses['bin-row']} */ ;
/** @type {__VLS_StyleScopedClasses['bin-row']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['rank']} */ ;
/** @type {__VLS_StyleScopedClasses['bin-row']} */ ;
/** @type {__VLS_StyleScopedClasses['active']} */ ;
/** @type {__VLS_StyleScopedClasses['count-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['comp-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['legend']} */ ;
/** @type {__VLS_StyleScopedClasses['dot']} */ ;
/** @type {__VLS_StyleScopedClasses['dot']} */ ;
/** @type {__VLS_StyleScopedClasses['dot']} */ ;
/** @type {__VLS_StyleScopedClasses['dot']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "panel" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h3, __VLS_intrinsicElements.h3)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "plot-wrap" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "canvas-box" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.canvas, __VLS_intrinsicElements.canvas)({
    ref: "cvs",
    width: "500",
    height: "500",
    ...{ class: "plot-canvas" },
});
/** @type {typeof __VLS_ctx.cvs} */ ;
if (__VLS_ctx.emptyNote) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "plot-empty" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty-title" },
    });
    (__VLS_ctx.emptyNote.title);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty-hint" },
    });
    (__VLS_ctx.emptyNote.hint);
    if (__VLS_ctx.emptyNote.canReset) {
        const __VLS_0 = {}.ElButton;
        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
        // @ts-ignore
        const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
            ...{ 'onClick': {} },
            size: "small",
            type: "primary",
            plain: true,
        }));
        const __VLS_2 = __VLS_1({
            ...{ 'onClick': {} },
            size: "small",
            type: "primary",
            plain: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_1));
        let __VLS_4;
        let __VLS_5;
        let __VLS_6;
        const __VLS_7 = {
            onClick: (__VLS_ctx.resetFilters)
        };
        __VLS_3.slots.default;
        var __VLS_3;
    }
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "density-side" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "density-controls" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "ctrl-row" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "ctrl-label" },
});
const __VLS_8 = {}.ElSelect;
/** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
// @ts-ignore
const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({
    modelValue: (__VLS_ctx.regionFilter),
    size: "small",
    ...{ style: {} },
}));
const __VLS_10 = __VLS_9({
    modelValue: (__VLS_ctx.regionFilter),
    size: "small",
    ...{ style: {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_9));
__VLS_11.slots.default;
const __VLS_12 = {}.ElOption;
/** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
// @ts-ignore
const __VLS_13 = __VLS_asFunctionalComponent(__VLS_12, new __VLS_12({
    label: "全部区域",
    value: "all",
}));
const __VLS_14 = __VLS_13({
    label: "全部区域",
    value: "all",
}, ...__VLS_functionalComponentArgsRest(__VLS_13));
for (const [r] of __VLS_getVForSourceType((__VLS_ctx.regionOptions))) {
    const __VLS_16 = {}.ElOption;
    /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
    // @ts-ignore
    const __VLS_17 = __VLS_asFunctionalComponent(__VLS_16, new __VLS_16({
        key: (r.value),
        label: (`${r.label} (${r.count})`),
        value: (r.value),
    }));
    const __VLS_18 = __VLS_17({
        key: (r.value),
        label: (`${r.label} (${r.count})`),
        value: (r.value),
    }, ...__VLS_functionalComponentArgsRest(__VLS_17));
}
var __VLS_11;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "ctrl-row" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "ctrl-label" },
});
const __VLS_20 = {}.ElSlider;
/** @type {[typeof __VLS_components.ElSlider, typeof __VLS_components.elSlider, ]} */ ;
// @ts-ignore
const __VLS_21 = __VLS_asFunctionalComponent(__VLS_20, new __VLS_20({
    modelValue: (__VLS_ctx.energyRange),
    range: true,
    size: "small",
    min: (__VLS_ctx.sliderBounds[0]),
    max: (__VLS_ctx.sliderBounds[1]),
    step: (0.01),
    ...{ style: {} },
}));
const __VLS_22 = __VLS_21({
    modelValue: (__VLS_ctx.energyRange),
    range: true,
    size: "small",
    min: (__VLS_ctx.sliderBounds[0]),
    max: (__VLS_ctx.sliderBounds[1]),
    step: (0.01),
    ...{ style: {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_21));
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "ctrl-row range-text" },
});
(__VLS_ctx.energyRange[0].toFixed(2));
(__VLS_ctx.energyRange[1].toFixed(2));
const __VLS_24 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
    ...{ 'onClick': {} },
    link: true,
    size: "small",
}));
const __VLS_26 = __VLS_25({
    ...{ 'onClick': {} },
    link: true,
    size: "small",
}, ...__VLS_functionalComponentArgsRest(__VLS_25));
let __VLS_28;
let __VLS_29;
let __VLS_30;
const __VLS_31 = {
    onClick: (__VLS_ctx.resetFilters)
};
__VLS_27.slots.default;
var __VLS_27;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "list-head" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "list-sub" },
});
(__VLS_ctx.densityBins.length);
(__VLS_ctx.filteredConfs.length);
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "density-list" },
});
if (__VLS_ctx.emptyNote) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "list-empty" },
    });
    if (!__VLS_ctx.store.result) {
    }
    else if (__VLS_ctx.baseConfs.length === 0) {
    }
    else {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.br)({});
    }
}
for (const [b, i] of __VLS_getVForSourceType((__VLS_ctx.densityBins))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.toggleBin(b.key);
            } },
        key: (b.key),
        ...{ class: "bin-row" },
        ...{ class: ({ active: __VLS_ctx.highlightKey === b.key }) },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "rank" },
    });
    (i + 1);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "count-badge" },
    });
    (b.count);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "comp-bar" },
        title: (__VLS_ctx.compositionTitle(b)),
    });
    for (const [n, reg] of __VLS_getVForSourceType((b.regions))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.i, __VLS_intrinsicElements.i)({
            key: (reg),
            ...{ style: ({ width: (n / b.count * 100) + '%', background: __VLS_ctx.regionColor(reg) }) },
        });
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "bin-desc" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "bin-region" },
        ...{ style: ({ color: __VLS_ctx.regionColor(b.dominant) }) },
    });
    (__VLS_ctx.regionLabel(b.dominant));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "bin-angles" },
    });
    (b.phiCenter.toFixed(0));
    (b.psiCenter.toFixed(0));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "bin-energy" },
    });
    (b.avgEnergy.toFixed(2));
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "heat-legend" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "heat-bar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "legend" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "dot a" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "dot b" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "dot l" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "dot d" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "legend-hl" },
});
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['plot-wrap']} */ ;
/** @type {__VLS_StyleScopedClasses['canvas-box']} */ ;
/** @type {__VLS_StyleScopedClasses['plot-canvas']} */ ;
/** @type {__VLS_StyleScopedClasses['plot-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-title']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-hint']} */ ;
/** @type {__VLS_StyleScopedClasses['density-side']} */ ;
/** @type {__VLS_StyleScopedClasses['density-controls']} */ ;
/** @type {__VLS_StyleScopedClasses['ctrl-row']} */ ;
/** @type {__VLS_StyleScopedClasses['ctrl-label']} */ ;
/** @type {__VLS_StyleScopedClasses['ctrl-row']} */ ;
/** @type {__VLS_StyleScopedClasses['ctrl-label']} */ ;
/** @type {__VLS_StyleScopedClasses['ctrl-row']} */ ;
/** @type {__VLS_StyleScopedClasses['range-text']} */ ;
/** @type {__VLS_StyleScopedClasses['list-head']} */ ;
/** @type {__VLS_StyleScopedClasses['list-sub']} */ ;
/** @type {__VLS_StyleScopedClasses['density-list']} */ ;
/** @type {__VLS_StyleScopedClasses['list-empty']} */ ;
/** @type {__VLS_StyleScopedClasses['bin-row']} */ ;
/** @type {__VLS_StyleScopedClasses['rank']} */ ;
/** @type {__VLS_StyleScopedClasses['count-badge']} */ ;
/** @type {__VLS_StyleScopedClasses['comp-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['bin-desc']} */ ;
/** @type {__VLS_StyleScopedClasses['bin-region']} */ ;
/** @type {__VLS_StyleScopedClasses['bin-angles']} */ ;
/** @type {__VLS_StyleScopedClasses['bin-energy']} */ ;
/** @type {__VLS_StyleScopedClasses['heat-legend']} */ ;
/** @type {__VLS_StyleScopedClasses['heat-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['legend']} */ ;
/** @type {__VLS_StyleScopedClasses['dot']} */ ;
/** @type {__VLS_StyleScopedClasses['a']} */ ;
/** @type {__VLS_StyleScopedClasses['dot']} */ ;
/** @type {__VLS_StyleScopedClasses['b']} */ ;
/** @type {__VLS_StyleScopedClasses['dot']} */ ;
/** @type {__VLS_StyleScopedClasses['l']} */ ;
/** @type {__VLS_StyleScopedClasses['dot']} */ ;
/** @type {__VLS_StyleScopedClasses['d']} */ ;
/** @type {__VLS_StyleScopedClasses['legend-hl']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            store: store,
            cvs: cvs,
            regionFilter: regionFilter,
            energyRange: energyRange,
            highlightKey: highlightKey,
            baseConfs: baseConfs,
            filteredConfs: filteredConfs,
            densityBins: densityBins,
            regionOptions: regionOptions,
            sliderBounds: sliderBounds,
            emptyNote: emptyNote,
            regionLabel: regionLabel,
            regionColor: regionColor,
            compositionTitle: compositionTitle,
            toggleBin: toggleBin,
            resetFilters: resetFilters,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
