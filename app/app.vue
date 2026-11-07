<script setup lang="ts">
const initError = useInitError()
</script>

<template>
  <NuxtRouteAnnouncer />
  <main v-if="initError" class="center">
    <div class="card">
      <h2>Verbindung fehlgeschlagen</h2>
      <p class="error">{{ initError }}</p>
    </div>
  </main>
  <NuxtPage v-else :page-key="(route) => route.fullPath" />
</template>

<style scoped>
.center {
  display: grid;
  place-items: center;
  min-height: 100%;
  padding: 16px;
}
</style>
