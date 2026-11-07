import type { BarSeriesOption, PieSeriesOption } from 'echarts/charts'
import type { GridComponentOption, LegendComponentOption, TooltipComponentOption } from 'echarts/components'
import type { ComposeOption } from 'echarts/core'

/** ECharts option limited to the parts bundled in components/EChart.vue */
export type ChartOption = ComposeOption<
  BarSeriesOption | PieSeriesOption | GridComponentOption | LegendComponentOption | TooltipComponentOption
>
