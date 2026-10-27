import { lazy, type LazyExoticComponent, type ComponentType } from 'react'

const JsonTool = lazy(() => import('./json/JsonTool'))
const BarcodeTool = lazy(() => import('./barcode/BarcodeTool'))

export type ToolDefinition = {
  id: string
  name: string
  description: string
  icon: 'json' | 'barcode'
  component: LazyExoticComponent<ComponentType>
}

export const toolRegistry = [
  {
    id: 'json',
    name: 'JSON 转换',
    description: '从 JSON 样本生成 TypeScript 类型和 Zod schema。',
    icon: 'json',
    component: JsonTool
  },
  {
    id: 'barcode',
    name: '条码生成',
    description: '生成二维码与 Code 128 条形码，并导出 SVG 或 PNG。',
    icon: 'barcode',
    component: BarcodeTool
  }
] satisfies ToolDefinition[]

export type ToolId = (typeof toolRegistry)[number]['id']
