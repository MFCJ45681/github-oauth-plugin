'use strict'

/**
 * Smoke test for the browser bundle: the UMD wrapper must hand a factory to
 * window.__ModuleLoader__, the factory must return apply/inject, and apply must
 * register the sidebar tab plus its pane slot through the documented services.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

function loadBundle (options = {}) {
  let captured
  const appended = []
  global.window = {
    __ModuleLoader__: { load: (definition) => { captured = definition } },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true
  }
  global.document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: (node) => appended.push(node) }
  }
  const clientPath = path.join(__dirname, '..', 'lib', 'client.js')
  delete require.cache[clientPath]
  require(clientPath)
  assert.ok(captured, 'bundle must call window.__ModuleLoader__.load')
  assert.equal(captured.id, '@local/github-oauth')
  const factoryExports = captured.factory((name) => {
    if (name === 'react') {
      return {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
        useEffect: (fn) => {
          if (Array.isArray(options.collectEffects)) options.collectEffects.push(fn)
        },
        useCallback: (fn) => fn,
        useRef: (initial) => ({ current: initial }),
        useMemo: (fn) => fn()
      }
    }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        Menu: (props) => ({ type: 'Menu', props }),
        IconChevronDownOutlineRegular: (props) => ({ type: 'Chevron', props })
      }
    }
    throw new Error(`unexpected require(${name})`)
  })
  return { factoryExports, appended }
}

test('bundle registers apply and inject contracts', () => {
  const { factoryExports, appended } = loadBundle()
  assert.equal(typeof factoryExports.apply, 'function')
  assert.deepEqual(factoryExports.inject, ['slots', 'sidebarRightTabs'])
  assert.equal(appended.length, 0, 'factory evaluation stays side-effect free')
})

test('apply registers the tab definition, pane slot and settings section', () => {
  const { factoryExports, appended } = loadBundle()
  const tabs = []
  const slots = []
  const effects = []
  const ctx = {
    sidebarRightTabs: { register: (definition) => { tabs.push(definition); return () => {} } },
    slots: {
      register: (definition, component) => { slots.push({ definition, component }); return () => {} },
      inject: (_key, callback) => callback()
    },
    effect: (run, label) => { effects.push(label); return run() }
  }

  factoryExports.apply(ctx)

  assert.equal(effects.length, 4)
  assert.equal(appended.length, 1, 'apply injects the panel style once')
  assert.equal(appended[0].id, 'dsh-github-oauth-style')
  assert.match(appended[0].textContent, /\.gho-panel/)
  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].id, '@local/github-oauth')
  assert.equal(tabs[0].kind, 'github-oauth')
  assert.equal(tabs[0].priority, 'extension')
  assert.equal(tabs[0].title(), 'GitHub')
  assert.equal(tabs[0].guide[0].id, 'github-oauth')
  assert.equal(tabs[0].guide[0].order, 40)
  assert.equal(tabs[0].guide[0].title(), 'GitHub')

  assert.equal(slots.length, 3)
  assert.equal(slots[0].definition.name, 'sidebar.right.pane.tab')
  assert.equal(slots[0].definition.key, '@local/github-oauth')
  assert.equal(typeof slots[0].component, 'function', 'the pane renders a React component')

  assert.equal(slots[1].definition.name, 'settings.section')
  assert.equal(slots[1].definition.id, 'github-oauth')
  assert.equal(slots[1].definition.order, 60)
  assert.equal(slots[1].definition.label(), 'GitHub')
  assert.equal(typeof slots[1].component, 'function', 'the settings section renders a React component')

  assert.equal(slots[2].definition.name, 'conversation.input.left')
  assert.equal(slots[2].definition.id, 'github-accounts')
  assert.equal(slots[2].definition.order, 40)
  assert.equal(typeof slots[2].component, 'function', 'the composer control renders a React component')
})

test('the composer menu falls back to /status when /accounts is missing', async () => {
  const effects = []
  const { factoryExports } = loadBundle({ collectEffects: effects })
  let composer
  factoryExports.apply({
    sidebarRightTabs: { register: () => () => {} },
    slots: {
      register: (definition, candidate) => {
        if (definition.name === 'conversation.input.left') composer = candidate
        return () => {}
      },
      inject: (_key, callback) => callback()
    },
    effect: (run) => run()
  })
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    if (String(url).endsWith('/accounts')) {
      return new Response(JSON.stringify({ error: 'not found', code: 'E_NOT_FOUND' }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      })
    }
    if (String(url).endsWith('/status')) {
      return new Response(JSON.stringify({
        ok: true,
        status: { connected: true, account: { login: 'octocat', name: 'The Octocat', avatarUrl: '' }, scopes: ['repo'] }
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    throw new Error('unexpected ' + url)
  }
  try {
    const tree = composer({})
    assert.equal(tree.props.className, 'gho-cm')
    effects.forEach((fn) => { fn() })
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.ok(calls.some((url) => url.endsWith('/accounts')), 'tries the 0.9 endpoint first')
    assert.ok(calls.some((url) => url.endsWith('/status')), 'degrades to /status on 404')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('the composer account menu renders a trigger and a login entry', () => {
  const { factoryExports } = loadBundle()
  const components = {}
  factoryExports.apply({
    sidebarRightTabs: { register: () => () => {} },
    slots: {
      register: (definition, candidate) => {
        if (definition.name === 'conversation.input.left') components.composer = candidate
        return () => {}
      },
      inject: (_key, callback) => callback()
    },
    effect: (run) => run()
  })
  assert.equal(typeof components.composer, 'function')
  const tree = components.composer({})
  assert.equal(tree.type, 'span')
  assert.equal(tree.props.className, 'gho-cm')
  const kids = tree.children[0]
  const menu = kids[0]
  assert.equal(typeof menu.type, 'function', 'the primitive Menu component is used')
  assert.equal(menu.props.side, 'top')
  assert.equal(menu.props.portal, true)
  const ids = menu.props.items.map((item) => item.id)
  assert.deepEqual(ids, ['add'], 'an empty vault only offers the login entry')
  assert.equal(menu.props.anchor.type, 'button')
  const text = JSON.stringify(menu.props.anchor)
  assert.match(text, /连接 GitHub/)
})

test('the panel component renders the unconfigured state', () => {
  const { factoryExports } = loadBundle()
  let component
  factoryExports.apply({
    sidebarRightTabs: { register: () => () => {} },
    slots: {
      register: (_definition, candidate) => {
        if (_definition.name === 'sidebar.right.pane.tab') component = candidate
        return () => {}
      },
      inject: (_key, callback) => callback()
    },
    effect: (run) => run()
  })
  assert.equal(typeof component, 'function')
  const tree = component({})
  assert.equal(tree.type, 'div')
  assert.equal(tree.props.className, 'gho-panel')
  const text = JSON.stringify(tree)
  assert.match(text, /GitHub/)
})
