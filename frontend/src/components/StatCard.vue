<script setup>
defineProps({
  label: String,
  value: String,
  hint: String,
  icon: String,
  tone: { type: String, default: 'purple' },
})
</script>

<template>
  <article class="stat-card">
    <div class="stat-top">
      <span class="stat-label">{{ label }}</span>
      <span class="stat-icon" :class="tone">{{ icon }}</span>
    </div>
    <div class="stat-value">{{ value }}</div>
    <div class="stat-hint">{{ hint }}</div>
  </article>
</template>
