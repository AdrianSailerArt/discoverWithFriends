<script setup lang="ts">
import { VOTES } from '~/lib/constants'
import type { Member, Vote, VoteValue } from '~/lib/types'

const props = defineProps<{
  votes: Vote[]
  membersById: Record<string, Member>
  myId: string
}>()

const emit = defineEmits<{ vote: [value: VoteValue | null] }>()

const mine = computed(() => props.votes.find((v) => v.user_id === props.myId)?.value ?? null)

const options = computed(() =>
  VOTES.map((o) => {
    const voters = props.votes.filter((v) => v.value === o.value)
    return {
      ...o,
      count: voters.length,
      names: voters.map((v) => props.membersById[v.user_id]?.display_name ?? '?').join(', '),
    }
  }),
)

function toggle(value: VoteValue) {
  emit('vote', mine.value === value ? null : value)
}
</script>

<template>
  <div class="votes" @click.stop>
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      class="vote"
      :class="{ active: mine === o.value }"
      :title="o.names ? `${o.label}: ${o.names}` : o.label"
      :aria-pressed="mine === o.value"
      :aria-label="o.label"
      @click="toggle(o.value)"
    >
      <span>{{ o.emoji }}</span>
      <span v-if="o.count" class="count">{{ o.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.votes {
  display: inline-flex;
  gap: 4px;
}
.vote {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: var(--radius-tag);
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  font-size: 0.85rem;
}
.vote:hover {
  background: var(--surface-2);
}
@media (pointer: coarse) {
  .votes {
    gap: 6px;
  }
  .vote {
    min-height: 36px;
    min-width: 44px;
    justify-content: center;
    padding: 4px 10px;
    font-size: 0.95rem;
  }
}
.vote.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.count {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
</style>
