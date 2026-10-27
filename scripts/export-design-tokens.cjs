const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/theme.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const moduleContext = { exports: {} }
vm.runInNewContext(compiled, { module: moduleContext, exports: moduleContext.exports })
const { brand, appTokens, semantic, readerThemes } = moduleContext.exports
const token = value => ({ value, type: 'color' })
const group = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, token(value)]))
const data = {
  brand: group(brand),
  app: Object.fromEntries(Object.entries(appTokens).map(([mode, values]) => [mode, group(values)])),
  status: group(semantic),
  reader: Object.fromEntries(Object.entries(readerThemes).map(([mode, values]) => [mode, group(Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'label')))])),
}
const kebab = key => key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())
const declarations = (prefix, values) => Object.entries(values).map(([key, value]) => `  --${prefix}-${kebab(key)}: ${value};`).join('\n')
const appNames = { canvas: 'bg-canvas', surface: 'bg-surface', surfaceSubtle: 'bg-surface-subtle', textPrimary: 'text-primary', textSecondary: 'text-secondary', textTertiary: 'text-tertiary', borderSubtle: 'border-subtle', borderStrong: 'border-strong' }
const appVars = mode => declarations('app', Object.fromEntries(Object.entries(appTokens[mode]).map(([key, value]) => [appNames[key], value])))
const css = [
  '/* Generated from src/theme.ts. Run node scripts/export-design-tokens.cjs to update. */',
  `:root {\n${declarations('color-brand', brand)}\n${declarations('color-status', semantic)}\n${appVars('light')}\n}`,
  `[data-theme="dark"] {\n${appVars('dark')}\n}`,
  ...Object.entries(readerThemes).map(([mode, values]) => `.reader-theme-${mode} {\n${declarations('reader', { bg: values.bg, text: values.text, meta: values.meta, overlay: values.overlay })}\n}`),
].join('\n\n') + '\n'
fs.mkdirSync(path.join(root, 'design'), { recursive: true })
fs.writeFileSync(path.join(root, 'design/tokens.json'), JSON.stringify(data, null, 2) + '\n')
fs.writeFileSync(path.join(root, 'design/tokens.css'), css)
console.log('Generated design/tokens.json and design/tokens.css')
