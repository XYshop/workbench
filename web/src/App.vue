<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import init, { generate } from './wasm/json2obj_wasm.js'

type Stats = {
  samples: number
  objects: number
  fields: number
  optionalFields: number
  enums: number
}

type Payload = {
  typescript: string
  zod: string
  stats: Stats
}

const EXAMPLE = `{"id": 1001, "status": "paid", "total": 89.9, "currency": "USD", "items": [{"sku": "KB-01", "qty": 1}], "customer": {"id": 7, "name": "Ada"}, "created_at": "2026-03-01T10:00:00Z"}
{"id": 1002, "status": "pending", "total": 39, "currency": "USD", "items": [{"sku": "HUB-02", "qty": 2}, {"sku": "CBL-03", "qty": 1}], "customer": {"id": 8, "name": "Bob", "vip": true}, "created_at": "2026-03-02T08:30:00Z"}
{"id": 1003, "status": "paid", "total": 120.5, "currency": "EUR", "items": [], "customer": {"id": 7, "name": "Ada"}, "created_at": "2026-03-03T12:15:00Z", "refunded_at": null}
{"id": 1004, "status": "refunded", "total": 15, "currency": "USD", "items": [{"sku": "PAD-04", "qty": 1}], "customer": {"id": 9, "name": "Cara"}, "created_at": "2026-03-04T09:45:00Z", "refunded_at": "2026-03-05T10:00:00Z"}
{"id": 1005, "status": "pending", "total": 64.2, "currency": "EUR", "items": [{"sku": "KB-01", "qty": 2}], "customer": {"id": 8, "name": "Bob"}, "created_at": "2026-03-05T16:20:00Z"}
{"id": 1006, "status": "paid", "total": 210, "currency": "USD", "items": [{"sku": "MON-05", "qty": 1}], "customer": {"id": 7, "name": "Ada", "vip": true}, "created_at": "2026-03-06T11:05:00Z"}`

const input = ref(EXAMPLE)
const rootName = ref('Order')
const detectEnums = ref(true)
const activeTab = ref<'typescript' | 'zod'>('typescript')

const typescript = ref('')
const zod = ref('')
const stats = ref<Stats | null>(null)
const elapsed = ref(0)
const error = ref('')
const copied = ref(false)
const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const ready = init()
let timer: number | undefined

const activeCode = computed(() =>
  activeTab.value === 'typescript' ? typescript.value : zod.value,
)

const lineCount = computed(() =>
  activeCode.value ? activeCode.value.trimEnd().split('\n').length : 0,
)

const highlighted = computed(() => highlight(activeCode.value))

function run() {
  if (!input.value.trim()) {
    typescript.value = ''
    zod.value = ''
    stats.value = null
    error.value = ''
    return
  }

  ready
    .then(() => {
      const start = performance.now()
      try {
        const payload = JSON.parse(
          generate(input.value, rootName.value || 'Root', detectEnums.value),
        ) as Payload
        elapsed.value = performance.now() - start
        typescript.value = payload.typescript
        zod.value = payload.zod
        stats.value = payload.stats
        error.value = ''
      } catch (err) {
        error.value = String(err)
        typescript.value = ''
        zod.value = ''
        stats.value = null
      }
    })
    .catch((err) => {
      error.value = `WASM 加载失败：${String(err)}`
    })
}

function schedule() {
  window.clearTimeout(timer)
  timer = window.setTimeout(run, 200)
}

watch([input, rootName, detectEnums], schedule)
onMounted(() => {
  run()
  window.addEventListener('dragover', (event) => event.preventDefault())
  window.addEventListener('drop', (event) => event.preventDefault())
})

function loadExample() {
  input.value = EXAMPLE
  rootName.value = 'Order'
}

function clearAll() {
  input.value = ''
  stats.value = null
  error.value = ''
  typescript.value = ''
  zod.value = ''
}

function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  readFiles(Array.from(target.files ?? []))
  target.value = ''
}

function onDrop(event: DragEvent) {
  dragging.value = false
  readFiles(Array.from(event.dataTransfer?.files ?? []))
}

function readFiles(files: File[]) {
  const usable = files.filter((file) => /\.(json|jsonl|txt)$/i.test(file.name))
  if (!usable.length) {
    return
  }
  Promise.all(usable.map((file) => file.text())).then((parts) => {
    input.value = parts
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n')
    run()
  })
}

async function copy() {
  if (!activeCode.value) {
    return
  }
  await navigator.clipboard.writeText(activeCode.value)
  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1600)
}

function download() {
  if (!activeCode.value) {
    return
  }
  const base = (rootName.value || 'Root').replace(/[^\w.-]+/g, '-')
  const suffix = activeTab.value === 'typescript' ? '.ts' : '.schema.ts'
  const blob = new Blob([activeCode.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${base}${suffix}`
  link.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function highlight(code: string) {
  if (!code) {
    return ''
  }

  const pattern =
    /(\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:export|import|from|interface|type|const|string|number|boolean|null|unknown|Record)\b)/g

  const out: string[] = []
  let last = 0

  for (const match of code.matchAll(pattern)) {
    const index = match.index ?? 0
    const token = match[0]
    out.push(escapeHtml(code.slice(last, index)))

    if (token.startsWith('//')) {
      out.push(`<span class="tok-comment">${escapeHtml(token)}</span>`)
    } else if (token.startsWith('"') || token.startsWith("'")) {
      out.push(`<span class="tok-string">${escapeHtml(token)}</span>`)
    } else {
      out.push(`<span class="tok-keyword">${escapeHtml(token)}</span>`)
    }

    last = index + token.length
  }

  out.push(escapeHtml(code.slice(last)))
  return out.join('')
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <div class="mark">{ }</div>
        <div class="brand-text">
          <h1>json2obj</h1>
          <p>JSON → TypeScript / Zod</p>
        </div>
      </div>
      <div class="badge">
        <span class="dot"></span>
        本地运行 · 数据不上传
      </div>
    </header>

    <main class="workspace">
      <section
        class="panel input-panel"
        :class="{ dragging }"
        @dragenter.prevent="dragging = true"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <div class="panel-head">
          <div class="panel-title">
            <h2>JSON 样本</h2>
            <span v-if="stats" class="count">{{ stats.samples }} 个样本</span>
          </div>
          <div class="tools">
            <button class="ghost" type="button" @click="loadExample">示例</button>
            <button class="ghost" type="button" @click="fileInput?.click()">上传</button>
            <button class="ghost" type="button" @click="clearAll">清空</button>
          </div>
        </div>

        <textarea
          v-model="input"
          spellcheck="false"
          autocomplete="off"
          aria-label="JSON 输入"
          placeholder="粘贴 JSON，或把 .json / .jsonl 文件拖进来…"
        ></textarea>

        <div class="options">
          <label class="field">
            <span>根类型名</span>
            <input v-model="rootName" class="text-input" spellcheck="false" />
          </label>
          <label class="switch">
            <input v-model="detectEnums" type="checkbox" />
            <span class="track"><span class="thumb"></span></span>
            <span class="switch-label">识别枚举</span>
          </label>
        </div>

        <p class="hint">
          支持一次粘贴多个 JSON 文档（换行分隔）或 JSONL。字段只出现于部分样本时，会自动标记为可选。
        </p>

        <div class="drop-hint">松开以导入 JSON 文件</div>
      </section>

      <section class="panel output-panel">
        <div class="panel-head">
          <div class="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === 'typescript'"
              :class="{ active: activeTab === 'typescript' }"
              @click="activeTab = 'typescript'"
            >
              TypeScript
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === 'zod'"
              :class="{ active: activeTab === 'zod' }"
              @click="activeTab = 'zod'"
            >
              Zod
            </button>
          </div>
          <div class="tools">
            <button class="ghost" type="button" :disabled="!activeCode" @click="download">
              下载
            </button>
            <button class="primary" type="button" :disabled="!activeCode" @click="copy">
              {{ copied ? '已复制' : '复制' }}
            </button>
          </div>
        </div>

        <div v-if="error" class="error">{{ error }}</div>

        <div v-if="stats && !error" class="stats">
          <span><strong>{{ stats.samples }}</strong> 样本</span>
          <span><strong>{{ stats.objects }}</strong> 对象</span>
          <span><strong>{{ stats.fields }}</strong> 字段</span>
          <span><strong>{{ stats.optionalFields }}</strong> 可选</span>
          <span><strong>{{ stats.enums }}</strong> 枚举</span>
          <span class="time">{{ elapsed.toFixed(2) }} ms</span>
        </div>

        <div class="code-wrap">
          <pre v-if="activeCode"><code v-html="highlighted"></code></pre>
          <div v-else class="placeholder">
            <p>在左侧粘贴 JSON，这里会实时生成类型。</p>
          </div>
        </div>

        <footer class="panel-foot">
          <span>{{ lineCount }} 行</span>
          <span>Rust + WebAssembly</span>
        </footer>
      </section>
    </main>

    <footer class="bottom">
      <span>所有解析在浏览器本地完成，不会发起任何网络请求。</span>
      <span>json2obj v0.1</span>
    </footer>

    <input
      ref="fileInput"
      type="file"
      accept=".json,.jsonl,.txt"
      multiple
      hidden
      @change="onFileChange"
    />
  </div>
</template>
