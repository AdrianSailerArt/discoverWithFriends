<script setup lang="ts">
/** discoverWithFriends logo: two pins (you + a friend), the filled one with mountains. Same artwork as public/logo.svg. */
withDefaults(defineProps<{ size?: number | string; wordmark?: boolean }>(), { size: 32, wordmark: false })
</script>

<template>
  <span class="logo">
    <svg :width="size" :height="size" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path
        d="M26 61.5C26 61.5 7.5 41.5 7.5 29a18.5 18.5 0 0 1 37 0C44.5 41.5 26 61.5 26 61.5Z"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linejoin="round"
      />
      <g transform="rotate(-4 34 30)">
        <path
          d="M34 57C34 57 15.5 37 15.5 24.5a18.5 18.5 0 0 1 37 0C52.5 37 34 57 34 57Z"
          fill="var(--accent)"
          stroke="currentColor"
          stroke-width="3"
          stroke-linejoin="round"
        />
        <path d="M21 33 28.5 21.5l4.5 6 5-8.5L47 33Z" fill="#fff" />
        <circle cx="42" cy="14" r="3" fill="#fff" />
      </g>
    </svg>
    <span v-if="wordmark" class="word">discover<b class="with">With</b><b>Friends</b></span>
    <span v-else class="sr-only">discoverWithFriends</span>
  </span>
</template>

<style scoped>
.logo {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  color: var(--text);
  line-height: 1;
}
svg {
  flex: none;
  overflow: visible;
}
.word {
  font-weight: 500;
  letter-spacing: -0.02em;
}
.word b {
  font-weight: 800;
}
.with {
  color: var(--accent);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
