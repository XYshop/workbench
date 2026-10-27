import { Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { ThemeContext } from './theme'
import { type ToolId, toolRegistry } from './tools/registry'
import './style.css'

type ThemePreference = 'system' | 'light' | 'dark'
type Theme = Exclude<ThemePreference, 'system'>

function readThemePreference(): ThemePreference {
  const saved = window.localStorage.getItem('json2obj-theme')
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

function ToolIcon({ icon }: { icon: 'json' | 'barcode' }) {
  if (icon === 'json')
    return <span className="tool-glyph-json">&#123; &#125;</span>
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4v16M7 4v16m4-16v16m2-16v16m4-16v16m3-16v16" />
    </svg>
  )
}

export default function App() {
  const [activeTool, setActiveTool] = useState<ToolId>('json')
  const [visitedTools, setVisitedTools] = useState<ToolId[]>(['json'])
  const [themePreference, setThemePreference] =
    useState<ThemePreference>(readThemePreference)
  const [systemTheme, setSystemTheme] = useState<Theme>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  )
  const theme = themePreference === 'system' ? systemTheme : themePreference
  const themeLabel =
    themePreference === 'system'
      ? '跟随系统'
      : themePreference === 'light'
        ? '浅色模式'
        : '深色模式'
  const activeDefinition = toolRegistry.find((item) => item.id === activeTool)!

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = (event: MediaQueryListEvent) =>
      setSystemTheme(event.matches ? 'dark' : 'light')
    setSystemTheme(media.matches ? 'dark' : 'light')
    media.addEventListener('change', updateSystemTheme)
    return () => media.removeEventListener('change', updateSystemTheme)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }, [theme])

  useEffect(() => {
    window.localStorage.setItem('json2obj-theme', themePreference)
  }, [themePreference])

  const cycleTheme = () => {
    setThemePreference(theme === 'dark' ? 'light' : 'dark')
  }

  const openTool = (toolId: ToolId) => {
    setActiveTool(toolId)
    setVisitedTools((visited) =>
      visited.includes(toolId) ? visited : [...visited, toolId]
    )
  }

  return (
    <ThemeContext.Provider value={theme}>
      <div className="app-shell">
        <div className="app-layout">
          <aside className="tool-sidebar" aria-label="工具导航">
            <div className="brand">
              <div className="mark">&#123; &#125;</div>
              <div className="brand-text">
                <h1>DevKit</h1>
                <p>LOCAL DEVELOPER TOOLS</p>
              </div>
            </div>
            <p className="sidebar-label">工具箱</p>
            <nav className="tool-nav">
              {toolRegistry.map((tool) => (
                <button
                  key={tool.id}
                  className={`tool-nav-item ${activeTool === tool.id ? 'active' : ''}`}
                  aria-current={activeTool === tool.id ? 'page' : undefined}
                  type="button"
                  onClick={() => openTool(tool.id)}
                >
                  <span className="tool-nav-icon">
                    <ToolIcon icon={tool.icon} />
                  </span>
                  <span className="tool-nav-copy">
                    <strong>{tool.name}</strong>
                    <small>{tool.description}</small>
                  </span>
                </button>
              ))}
            </nav>
            <div className="sidebar-note">
              <span className="sidebar-note-mark">✳</span>
              <span>
                更多实用工具
                <br />
                持续加入
              </span>
            </div>
          </aside>

          <main className="tool-main">
            <header className="main-toolbar">
              <div className="tool-heading">
                <div>
                  <p className="tool-breadcrumb">
                    DEVKIT <span>/</span> {activeDefinition.name}
                  </p>
                  <h2>{activeDefinition.name}</h2>
                  <p>{activeDefinition.description}</p>
                </div>
              </div>
              <div className="header-actions">
                <button
                  className="theme-toggle"
                  type="button"
                  aria-label={`切换主题，当前为${themeLabel}`}
                  title={`主题：${themeLabel}（点击切换）`}
                  onClick={cycleTheme}
                >
                  {theme === 'dark' ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                    </svg>
                  )}
                </button>
              </div>
            </header>
            {toolRegistry
              .filter((tool) => visitedTools.includes(tool.id))
              .map((tool) => {
                const Tool = tool.component
                return (
                  <div
                    className="tool-instance"
                    hidden={tool.id !== activeTool}
                    key={tool.id}
                  >
                    <Suspense
                      fallback={
                        <div className="tool-loading">正在加载工具…</div>
                      }
                    >
                      <Tool />
                    </Suspense>
                  </div>
                )
              })}
          </main>
        </div>
      </div>
    </ThemeContext.Provider>
  )
}
