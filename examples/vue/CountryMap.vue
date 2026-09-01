<!--
  Vue 3 equivalent of the React example.

  Same two rules apply: dispose() on unmount, and keep the source out of
  reactive state. `shallowRef` rather than `ref` matters here - `ref` would
  deep-proxy an object that owns canvas elements and decoded tile geometry,
  which is both wasteful and a good way to break identity comparisons inside
  the library.
-->

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { MVTSource, MVTOptionsError, DefaultStyles } from 'google-maps-vector-engine';
import type { MVTSourceStats } from 'google-maps-vector-engine';

interface Country {
  fid: number;
  NAME: string;
  CONTINENT: string;
}

const props = defineProps<{ apiKey: string }>();

const container = ref<HTMLDivElement | null>(null);
const source = shallowRef<MVTSource<Country> | null>(null);
const selectedNames = ref<string[]>([]);
const stats = ref<MVTSourceStats | null>(null);
const error = ref<string | null>(null);

onMounted(() => {
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(props.apiKey)}`;
  script.async = true;
  script.onload = createSource;
  document.head.append(script);
});

function createSource() {
  if (!container.value) return;

  const map = new google.maps.Map(container.value, { center: { lat: 20, lng: 0 }, zoom: 3 });

  try {
    source.value = new MVTSource<Country>(map, {
      url: 'https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf',
      sourceMaxZoom: 6,
      clickableLayers: ['countries'],
      cache: true,
      style: DefaultStyles.accessible(),
    });
  } catch (constructionError) {
    if (constructionError instanceof MVTOptionsError) {
      error.value = `Bad option "${constructionError.option}": ${constructionError.message}`;
      return;
    }
    throw constructionError;
  }

  source.value.on('selectionchange', ({ selected }) => {
    selectedNames.value = selected
      .map((id) => source.value?.getFeature(id))
      .filter((feature) => Boolean(feature))
      .map((feature) => feature!.properties.NAME);
  });

  source.value.on('idle', () => {
    stats.value = source.value?.getStats() ?? null;
  });
}

function clear() {
  source.value?.setSelection([]);
}

// Without this, every remount leaves listeners, in-flight requests and decoded
// geometry behind.
onBeforeUnmount(() => {
  source.value?.dispose();
  source.value = null;
});
</script>

<template>
  <p v-if="error" role="alert">{{ error }}</p>

  <div v-else class="layout">
    <aside>
      <h2>Selected</h2>
      <p>{{ selectedNames.length ? selectedNames.join(', ') : 'Nothing selected.' }}</p>
      <button :disabled="!selectedNames.length" @click="clear">Clear</button>

      <dl v-if="stats">
        <dt>visible tiles</dt>
        <dd>{{ stats.visibleTiles }}</dd>
        <dt>features</dt>
        <dd>{{ stats.features }}</dd>
        <dt>in flight</dt>
        <dd>{{ stats.pendingRequests }}</dd>
      </dl>
    </aside>

    <div ref="container" class="map" />
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  height: 100vh;
}

aside {
  padding: 16px;
  overflow-y: auto;
}

.map {
  width: 100%;
  height: 100%;
}
</style>
