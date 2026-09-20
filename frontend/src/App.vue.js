/// <reference types="../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
import ControlPanel from "./components/ControlPanel.vue";
import RamachandranPlot from "./components/RamachandranPlot.vue";
import ProteinViewer3D from "./components/ProteinViewer3D.vue";
import ConformationTable from "./components/ConformationTable.vue";
import { useProteinStore } from "./store/protein";
const store = useProteinStore();
function handleSample(params) { store.runSampling(params); }
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "app-container" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.header, __VLS_intrinsicElements.header)({
    ...{ class: "app-header" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.p, __VLS_intrinsicElements.p)({
    ...{ class: "subtitle" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.main, __VLS_intrinsicElements.main)({
    ...{ class: "app-main" },
});
/** @type {[typeof ControlPanel, ]} */ ;
// @ts-ignore
const __VLS_0 = __VLS_asFunctionalComponent(ControlPanel, new ControlPanel({
    ...{ 'onSample': {} },
}));
const __VLS_1 = __VLS_0({
    ...{ 'onSample': {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_0));
let __VLS_3;
let __VLS_4;
let __VLS_5;
const __VLS_6 = {
    onSample: (__VLS_ctx.handleSample)
};
var __VLS_2;
if (__VLS_ctx.store.result) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "main-grid" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "plot-area" },
    });
    /** @type {[typeof RamachandranPlot, ]} */ ;
    // @ts-ignore
    const __VLS_7 = __VLS_asFunctionalComponent(RamachandranPlot, new RamachandranPlot({}));
    const __VLS_8 = __VLS_7({}, ...__VLS_functionalComponentArgsRest(__VLS_7));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "viewer-area" },
    });
    /** @type {[typeof ProteinViewer3D, ]} */ ;
    // @ts-ignore
    const __VLS_10 = __VLS_asFunctionalComponent(ProteinViewer3D, new ProteinViewer3D({}));
    const __VLS_11 = __VLS_10({}, ...__VLS_functionalComponentArgsRest(__VLS_10));
}
if (__VLS_ctx.store.result) {
    /** @type {[typeof ConformationTable, ]} */ ;
    // @ts-ignore
    const __VLS_13 = __VLS_asFunctionalComponent(ConformationTable, new ConformationTable({}));
    const __VLS_14 = __VLS_13({}, ...__VLS_functionalComponentArgsRest(__VLS_13));
}
/** @type {__VLS_StyleScopedClasses['app-container']} */ ;
/** @type {__VLS_StyleScopedClasses['app-header']} */ ;
/** @type {__VLS_StyleScopedClasses['subtitle']} */ ;
/** @type {__VLS_StyleScopedClasses['app-main']} */ ;
/** @type {__VLS_StyleScopedClasses['main-grid']} */ ;
/** @type {__VLS_StyleScopedClasses['plot-area']} */ ;
/** @type {__VLS_StyleScopedClasses['viewer-area']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            ControlPanel: ControlPanel,
            RamachandranPlot: RamachandranPlot,
            ProteinViewer3D: ProteinViewer3D,
            ConformationTable: ConformationTable,
            store: store,
            handleSample: handleSample,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
