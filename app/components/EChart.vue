<script setup lang="ts">
// Thin wrapper around Apache ECharts (tree-shaken: only bar + pie charts are bundled).
import { BarChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { init, use, type ECharts } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { ChartOption } from '~/lib/charts'

use([BarChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{ option: ChartOption; height?: string; label: string }>()

const el = ref<HTMLDivElement>()
let chart: ECharts | null = null
let resizeObserver: ResizeObserver | null = null
let colorScheme: MediaQueryList | null = null

/** Text/line colours follow the app theme (CSS variables), incl. dark mode. */
function themed(option: ChartOption): ChartOption {
  const css = getComputedStyle(document.documentElement)
  const text = css.getPropertyValue('--text').trim() || '#1d1d1f'
  const muted = css.getPropertyValue('--muted').trim() || '#4a515b'
  const border = css.getPropertyValue('--border').trim() || '#b0b0b0'
  const surface = css.getPropertyValue('--surface').trim() || '#f5f5f7'
  const font = css.getPropertyValue('--font').trim() || 'system-ui'
  return {
    textStyle: { fontFamily: font, color: text },
    tooltip: {
      backgroundColor: surface,
      borderColor: css.getPropertyValue('--line').trim() || '#000',
      textStyle: { color: text, fontFamily: font },
    },
    legend: { textStyle: { color: muted } },
    ...option,
    // axis colours only where axes exist
    ...(option.xAxis ? { xAxis: withAxisColors(option.xAxis, muted, border) } : {}),
    ...(option.yAxis ? { yAxis: withAxisColors(option.yAxis, muted, border) } : {}),
  } as ChartOption
}

function withAxisColors(axis: unknown, muted: string, border: string) {
  const style = (a: Record<string, unknown>) => ({
    axisLabel: { color: muted },
    axisLine: { lineStyle: { color: border } },
    splitLine: { lineStyle: { color: border, opacity: 0.5 } },
    ...a,
  })
  return Array.isArray(axis) ? axis.map(style) : style(axis as Record<string, unknown>)
}

function render() {
  if (!chart) return
  chart.setOption(themed(props.option), true)
}

onMounted(() => {
  chart = init(el.value!, undefined, { renderer: 'canvas' })
  render()
  resizeObserver = new ResizeObserver(() => chart?.resize())
  resizeObserver.observe(el.value!)
  colorScheme = matchMedia('(prefers-color-scheme: dark)')
  colorScheme.addEventListener('change', render)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  colorScheme?.removeEventListener('change', render)
  chart?.dispose()
  chart = null
})

watch(() => props.option, render, { deep: true })
</script>

<template>
  <div ref="el" class="chart" role="img" :aria-label="label" :style="{ height: height ?? '240px' }" />
</template>

<style scoped>
.chart {
  width: 100%;
}
</style>
