import { defineStore } from 'pinia';
import { ref } from 'vue';
import axios from 'axios';
export const useProteinStore = defineStore('protein', () => {
    const loading = ref(false);
    const result = ref(null);
    const selectedConformation = ref(null);
    const selectedCluster = ref('all');
    async function runSampling(params) {
        loading.value = true;
        try {
            const { data } = await axios.post('/api/sample', params);
            result.value = data;
            selectedConformation.value = null;
            selectedCluster.value = 'all';
        }
        finally {
            loading.value = false;
        }
    }
    function selectConformation(conf) { selectedConformation.value = conf; }
    function filterByCluster(cluster) { selectedCluster.value = cluster; }
    return { loading, result, selectedConformation, selectedCluster, runSampling, selectConformation, filterByCluster };
});
