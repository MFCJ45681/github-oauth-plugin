window.__ModuleLoader__.load({
  id: '@local/github-oauth',
  factory: function (require) {
    'use strict'

    var React = require('react')
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    var h = React.createElement

    var BASE = '/plugins/github-oauth'
    var PROJECT_URL = 'https://github.com/MFCJ45681/github-oauth-plugin'
    var ACCOUNTS_EVENT = 'dsh-github-oauth-accounts'
    var STYLE_ID = 'dsh-github-oauth-style'
    // One bootstrap request paints the whole panel; reopening it within the TTL
    // reuses the last payload instead of waiting on the network again.
    var BOOTSTRAP_TTL_MS = 15000
    var bootstrapCache = null

    var CSS = [
      '.gho-panel{display:flex;flex-direction:column;gap:14px;padding:14px;font-size:13px;color:var(--dsw-alias-label-primary,#1f2328);height:100%;box-sizing:border-box;overflow:auto}',
      '.gho-settings{display:flex;flex-direction:column;gap:16px;padding:2px 2px 16px;font-size:13px;color:var(--dsw-alias-label-primary,#1f2328);max-width:760px}',
      '.gho-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.gho-title{font-size:14px;font-weight:600;letter-spacing:.01em;display:flex;align-items:center;gap:7px}',
      '.gho-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#9aa0a6);flex:none}',
      '.gho-dot.on{background:var(--dsw-alias-state-success-primary,#2da44e)}',
      '.gho-dot.off{background:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.gho-muted{color:var(--dsw-alias-label-secondary,#57606a);font-size:12px;line-height:1.65}',
      '.gho-card{border:1px solid var(--dsw-alias-border-l1,rgba(31,35,40,.12));border-radius:var(--dsw-radius-md,10px);padding:12px;background:var(--dsw-alias-bg-layer-1,transparent);display:flex;flex-direction:column;gap:10px}',
      '.gho-account{display:flex;align-items:center;gap:10px}',
      '.gho-avatar{width:36px;height:36px;border-radius:50%;flex:none;background:var(--dsw-alias-bg-layer-2,rgba(31,35,40,.08));object-fit:cover}',
      '.gho-login{font-weight:600}',
      '.gho-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.gho-stack{display:flex;flex-direction:column;gap:8px}',
      '.gho-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(31,35,40,.16));background:transparent;color:inherit;border-radius:var(--dsw-radius-sm,7px);padding:6px 11px;font:inherit;font-size:12px;cursor:pointer;transition:background .12s ease;white-space:nowrap}',
      '.gho-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(31,35,40,.06))}',
      '.gho-btn[disabled]{opacity:.5;cursor:not-allowed}',
      '.gho-btn.primary{background:var(--dsw-alias-button-primary-fill,#1f883d);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}',
      '.gho-btn.primary:hover{filter:brightness(1.06)}',
      '.gho-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.gho-input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(31,35,40,.16));background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;border-radius:var(--dsw-radius-sm,7px);padding:7px 9px;font:inherit;font-size:12px}',
      '.gho-input:focus{outline:2px solid var(--dsw-alias-button-primary-fill,#1f883d);outline-offset:-1px}',
      '.gho-input.narrow{width:auto;flex:1 1 180px}',
      '.gho-error{border:1px solid var(--dsw-alias-state-error-primary,#cf222e);color:var(--dsw-alias-state-error-primary,#cf222e);border-radius:var(--dsw-radius-sm,7px);padding:8px 10px;font-size:12px;line-height:1.5;white-space:pre-wrap}',
      '.gho-ok{color:var(--dsw-alias-state-success-primary,#2da44e);font-size:12px}',
      '.gho-list{display:flex;flex-direction:column;gap:2px}',
      '.gho-repo{padding:7px 8px;border-radius:var(--dsw-radius-sm,7px);display:flex;flex-direction:column;gap:2px;text-decoration:none;color:inherit}',
      '.gho-repo:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(31,35,40,.06))}',
      '.gho-repo-name{font-weight:600;display:flex;align-items:center;gap:6px}',
      '.gho-repo-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#6e7781);display:flex;gap:8px;flex-wrap:wrap}',
      '.gho-pill{font-size:10px;font-weight:600;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgba(31,35,40,.16));color:var(--dsw-alias-label-secondary,#57606a)}',
      '.gho-pill.on{border-color:transparent;background:var(--dsw-alias-state-success-primary,#2da44e);color:var(--dsw-alias-label-primary-foreground,#fff)}',
      '.gho-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1,rgba(31,35,40,.16));border-radius:999px;padding:2px 8px;font-size:11px;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.gho-chip button{appearance:none;border:0;background:transparent;color:inherit;font:inherit;line-height:1;cursor:pointer;padding:0 0 0 2px;opacity:.7}',
      '.gho-chip button:hover{opacity:1}',
      '.gho-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;word-break:break-all;line-height:1.5;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.gho-sep{height:1px;background:var(--dsw-alias-border-l1,rgba(31,35,40,.1));margin:2px 0}',
      '.gho-cm{display:inline-flex;align-items:center;gap:6px;min-width:0;max-height:28px;line-height:1;vertical-align:middle}',
      '.gho-cm-trigger{appearance:none;border:1px solid rgba(31,35,40,.12);background:#ffffff;color:#1f2328;font:inherit;font-size:12px;height:28px;display:inline-flex;align-items:center;gap:6px;padding:0 10px;border-radius:999px;cursor:pointer;max-width:200px;min-width:0;box-shadow:0 1px 2px rgba(31,35,40,.10),0 0 0 1px rgba(31,35,40,.03);transition:background .12s ease,border-color .12s ease,box-shadow .12s ease}',
      '.gho-cm-trigger.compact{width:28px;min-width:28px;max-width:28px;padding:0;gap:0;justify-content:center}',
      '.gho-cm-trigger:hover{background:#f6f8fa;border-color:rgba(31,35,40,.2)}',
      '.gho-cm-trigger.flat{box-shadow:none}',
      '.gho-cm-trigger:active{background:#eef1f4}',
      '.gho-btn.on{border-color:var(--dsw-alias-button-primary-fill,#1f2328);background:var(--dsw-alias-button-primary-fill,#1f2328);color:var(--dsw-alias-label-primary-foreground,#ffffff)}',
      '.gho-switch{appearance:none;border:0;padding:0;margin:0;width:36px;height:20px;border-radius:999px;background:rgba(31,35,40,.18);position:relative;flex:none;cursor:pointer;transition:background .16s ease}',
      '.gho-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.24);transition:transform .16s ease}',
      '.gho-switch.on{background:var(--dsw-alias-button-primary-fill,#1f2328)}',
      '.gho-switch.on::after{transform:translateX(16px)}',
      '.gho-switch:focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill,#1f2328);outline-offset:2px}',
      '.gho-setting{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(31,35,40,.08))}',
      '.gho-setting-text{min-width:0}',
      '.gho-setting-title{font-size:13px;font-weight:600}',
      '.gho-cm-avatar{width:16px!important;height:16px!important;max-width:16px!important;max-height:16px!important;min-width:16px;min-height:16px;border-radius:50%;object-fit:cover;flex:0 0 16px;display:block;background:var(--dsw-alias-bg-layer-2,rgba(31,35,40,.08))}',
      '.gho-cm-mark{width:16px;height:16px;border-radius:4px;flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;background:var(--dsw-alias-bg-layer-2,rgba(31,35,40,.1));color:var(--dsw-alias-label-secondary,#57606a)}',
      '.gho-cm-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.gho-cm-chevron{display:inline-flex;align-items:center;opacity:.7}',
      '.gho-cm-chevron svg{width:10px;height:10px}',
      '.gho-cm-item{display:inline-flex;align-items:center;gap:6px;min-width:0}',
      '.gho-cm-login{font-weight:600}',
      '.gho-cm-name{color:var(--dsw-alias-label-tertiary,#6e7781);font-size:11px;overflow:hidden;text-overflow:ellipsis;max-width:180px}',
      '.gho-cm-plus{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;font-size:13px;font-weight:600}',
      '.gho-cm-status{font-size:11px;color:var(--dsw-alias-label-tertiary,#6e7781);margin-left:6px}',
      '.gho-license{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#6e7781);margin-top:10px}',
      '.gho-license-link{color:inherit;text-decoration:none;border-bottom:1px dotted currentColor}',
      '.gho-license-link:hover{color:var(--dsw-alias-label-primary,#1f2328)}',
      '.gho-license-sep{opacity:.5}'
    ].join('\n')

    function ensureStyle () {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID)) return
      var style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    function request (path, options) {
      var init = options || {}
      return fetch(BASE + path, {
        method: init.method || 'GET',
        headers: init.body ? { 'content-type': 'application/json' } : undefined,
        body: init.body ? JSON.stringify(init.body) : undefined,
        credentials: 'same-origin',
        cache: 'no-store'
      }).then(function (response) {
        return response.text().then(function (text) {
          var payload = null
          try { payload = text === '' ? null : JSON.parse(text) } catch (e) { payload = null }
          if (!response.ok) {
            var message = payload && payload.error ? payload.error : 'HTTP ' + response.status
            var hint = payload && payload.hint ? '\n' + payload.hint : ''
            var failure = new Error(message + hint)
            failure.status = response.status
            failure.code = payload && payload.code ? payload.code : ''
            throw failure
          }
          if (payload === null) {
            // A 200 that is not JSON means the host answered with its SPA
            // fallback (or an empty body): surface it instead of rendering an
            // empty panel.
            var parseFailure = new Error('无法解析插件后端的响应（HTTP 200，非 JSON）；请确认 DSH 已加载 @local/github-oauth 的路由。')
            parseFailure.status = response.status
            parseFailure.code = 'E_PARSE'
            throw parseFailure
          }
          return payload
        })
      })
    }

    function formatError (error) {
      if (!error) return ''
      if (error.code === 'E_NOT_FOUND') return error.message
      if (error.code === 'E_METHOD') return error.message
      if (error.status === 404) {
        return '插件后端还没更新（HTTP 404）。重启 DSH 后该功能即可用。'
      }
      if (error.name === 'TypeError' && /fetch|network/i.test(error.message)) {
        return '无法连接插件后端（' + BASE + ' 路由未注册？）。确认 @local/github-oauth 已安装并重启了 dsh。'
      }
      return error.message || String(error)
    }

    var AVATAR_STYLE = {
      width: 36,
      height: 36,
      minWidth: 36,
      minHeight: 36,
      maxWidth: 36,
      maxHeight: 36,
      borderRadius: '50%',
      objectFit: 'cover',
      flex: '0 0 36px',
      display: 'block'
    }
    var AVATAR_SMALL_STYLE = {
      width: 16,
      height: 16,
      minWidth: 16,
      minHeight: 16,
      maxWidth: 16,
      maxHeight: 16,
      borderRadius: '50%',
      objectFit: 'cover',
      flex: '0 0 16px',
      display: 'block'
    }

    function Avatar (props) {
      if (!props.src) {
        return h('div', { className: 'gho-avatar', style: AVATAR_STYLE, 'aria-hidden': 'true' })
      }
      return h('img', {
        className: 'gho-avatar',
        src: props.src,
        alt: '',
        width: 36,
        height: 36,
        style: AVATAR_STYLE,
        referrerPolicy: 'no-referrer'
      })
    }

    /**
     * One shared data source for both surfaces: connection status, vault
     * preferences and the recent repository list, plus every mutation.
     */
    function useGitHub () {
      var statusHook = React.useState(null)
      var status = statusHook[0]
      var setStatus = statusHook[1]
      var prefsHook = React.useState(null)
      var prefs = prefsHook[0]
      var setPrefs = prefsHook[1]
      var reposHook = React.useState([])
      var repos = reposHook[0]
      var setRepos = reposHook[1]
      var errorHook = React.useState('')
      var error = errorHook[0]
      var setError = errorHook[1]
      var busyHook = React.useState(true)
      var busy = busyHook[0]
      var setBusy = busyHook[1]
      var reposLoadingHook = React.useState(false)
      var reposLoading = reposLoadingHook[0]
      var setReposLoading = reposLoadingHook[1]

      var alive = React.useRef(true)
      var seq = React.useRef(0)

      React.useEffect(function () {
        alive.current = true
        return function () { alive.current = false }
      }, [])

      var load = React.useCallback(function (options) {
        var silent = options && options.silent === true
        var ticket = ++seq.current
        var warm = bootstrapCache !== null && Date.now() - bootstrapCache.at < BOOTSTRAP_TTL_MS
        if (!silent) setBusy(true)
        var pending = warm ? Promise.resolve(bootstrapCache.payload) : request('/bootstrap')
        return pending
          .then(function (payload) {
            if (!alive.current || ticket !== seq.current) return null
            if (!warm) bootstrapCache = { at: Date.now(), payload: payload }
            var next = payload && payload.status ? payload.status : null
            setStatus(next)
            setPrefs(payload && payload.preferences ? payload.preferences : null)
            if (payload && Array.isArray(payload.repos)) setRepos(payload.repos)
            setError('')
            return next
          })
          .catch(function (err) {
            if (alive.current && ticket === seq.current) setError(formatError(err))
            return null
          })
          .then(function (next) {
            if (!silent && alive.current && ticket === seq.current) setBusy(false)
            return next
          })
      }, [])

      var loadRepos = React.useCallback(function () {
        var ticket = ++seq.current
        setReposLoading(true)
        return request('/repos?limit=100')
          .then(function (payload) {
            if (!alive.current || ticket !== seq.current) return
            setRepos(payload && Array.isArray(payload.repos) ? payload.repos : [])
          })
          .catch(function (err) {
            if (!alive.current || ticket !== seq.current) return
            setRepos([])
            var message = formatError(err)
            if (message.indexOf('E_NOT_CONNECTED') < 0 && message.indexOf('not connected') < 0) setError(message)
          })
          .then(function () {
            if (alive.current && ticket === seq.current) setReposLoading(false)
          })
      }, [])

      React.useEffect(function () {
        ensureStyle()
        load()
      }, [load])

      React.useEffect(function () {
        function onChanged (event) {
          var detail = event && event.detail ? event.detail : null
          if (detail && detail.status) {
            // The sender already knows the new state: adopt it and skip a
            // redundant /bootstrap that would hit GitHub again.
            bootstrapCache = null
            seq.current += 1
            setStatus(detail.status)
            if (detail.preferences) setPrefs(detail.preferences)
            setError('')
            return
          }
          bootstrapCache = null
          load({ silent: true })
        }
        window.addEventListener(ACCOUNTS_EVENT, onChanged)
        return function () { window.removeEventListener(ACCOUNTS_EVENT, onChanged) }
      }, [load])

      var connected = status ? status.connected : false
      React.useEffect(function () {
        if (!connected || repos.length > 0) return undefined
        loadRepos()
        return undefined
      }, [connected, repos.length, loadRepos])

      React.useEffect(function () {
        if (!status || !status.configured || status.connected) return undefined
        var budget = 5 * 60 * 1000
        var lastTick = Date.now()
        var stopped = false
        var timer = null
        function poll () {
          if (stopped) return
          var visible = typeof document === 'undefined' || document.visibilityState !== 'hidden'
          var now = Date.now()
          // Time spent on the GitHub tab does not consume the budget: a 2FA
          // round trip would otherwise exhaust it before the callback lands.
          if (visible) budget -= now - lastTick
          lastTick = now
          if (budget <= 0) {
            stopped = true
            if (timer !== null) clearInterval(timer)
            return
          }
          if (!visible) return
          request('/status')
            .then(function (payload) {
              if (stopped) return
              if (payload && payload.status && payload.status.connected) {
                stopped = true
                if (timer !== null) clearInterval(timer)
                bootstrapCache = null
                setStatus(payload.status)
              }
            })
            .catch(function () {})
        }
        timer = setInterval(poll, 2000)
        return function () {
          stopped = true
          if (timer !== null) clearInterval(timer)
        }
      }, [status && status.configured, status && status.connected])

      /**
       * Open the GitHub authorize page in a popup. A blank popup may be passed
       * in when it had to be opened synchronously (popup blockers only allow
       * that inside the click handler).
       */
      function login (options) {
        var popup = options && options.popup ? options.popup : null
        if (status && status.configured === false) {
          if (popup) { try { popup.close() } catch (error) {} }
          setError('还没有配置 GitHub OAuth App：先填写 Client ID / Secret，或使用内置默认应用。')
          return null
        }
        var opened = popup
        if (opened) {
          try { opened.location.href = BASE + '/start' } catch (error) { opened = null }
        } else {
          try { opened = window.open(BASE + '/start', '_blank') } catch (error) { opened = null }
        }
        if (!opened) {
          setError('浏览器拦截了授权弹窗：请允许本站弹窗后重试，页面不会跳转离开。')
          return null
        }
        try { opened.opener = null } catch (error) {}
        return opened
      }

      function logout () {
        bootstrapCache = null
        setBusy(true)
        return request('/logout', { method: 'POST' })
          .then(function (payload) {
            setStatus(payload && payload.status ? payload.status : null)
            setRepos([])
            notifyAccountsChanged(payload || null)
            return payload
          })
          .catch(function (err) {
            setError(formatError(err))
            return null
          })
          .then(function (payload) {
            setBusy(false)
            return payload
          })
      }

      function switchAccount () {
        // Popup blockers require the window.open call to happen inside the
        // click handler; open it blank now and point it at /start later.
        var popup = null
        try { popup = window.open('', '_blank') } catch (error) { popup = null }
        return logout().then(function (payload) {
          if (payload) return login({ popup: popup })
          if (popup) { try { popup.close() } catch (error) {} }
          return null
        })
      }

      function switchTo (login) {
        setBusy(true)
        setError('')
        return request('/accounts/switch', { method: 'POST', body: { login: login } })
          .then(function (payload) {
            if (payload && payload.status) {
              bootstrapCache = null
              setStatus(payload.status)
            }
            notifyAccountsChanged(payload || null)
            return payload
          })
          .catch(function (err) {
            setError(formatError(err))
            return null
          })
          .then(function (payload) {
            setBusy(false)
            return payload
          })
      }

      function removeAccount (login) {
        setBusy(true)
        setError('')
        return request('/accounts/remove', { method: 'POST', body: { login: login } })
          .then(function (payload) {
            if (payload && payload.status) {
              bootstrapCache = null
              setStatus(payload.status)
            }
            notifyAccountsChanged(payload || null)
            return payload
          })
          .catch(function (err) {
            setError(formatError(err))
            return null
          })
          .then(function (payload) {
            setBusy(false)
            return payload
          })
      }

      function applyConfig (body) {
        bootstrapCache = null
        setError('')
        return request('/config', { method: 'POST', body: body })
          .then(function (payload) {
            if (payload && payload.status) setStatus(payload.status)
            notifyAccountsChanged(payload || null)
            return payload
          })
      }

      function saveConfig (clientId, clientSecret) {
        return applyConfig({ mode: 'custom', clientId: clientId, clientSecret: clientSecret })
      }

      function useDefaultApp () {
        return applyConfig({ mode: 'default' })
      }

      function savePrefs (patch) {
        bootstrapCache = null
        setError('')
        return request('/preferences', { method: 'POST', body: patch })
          .then(function (payload) {
            if (payload && payload.preferences) setPrefs(payload.preferences)
            notifyAccountsChanged(payload || null)
            return payload ? payload.preferences : null
          })
      }

      function refresh () {
        bootstrapCache = null
        return load().then(function (next) {
          return next && next.connected ? loadRepos() : undefined
        })
      }

      return {
        status: status,
        prefs: prefs,
        repos: repos,
        error: error,
        busy: busy,
        reposLoading: reposLoading,
        setError: setError,
        login: login,
        logout: logout,
        switchAccount: switchAccount,
        switchTo: switchTo,
        removeAccount: removeAccount,
        saveConfig: saveConfig,
        useDefaultApp: useDefaultApp,
        savePrefs: savePrefs,
        refresh: refresh
      }
    }

    function Dot (props) {
      if (props.connected) return h('span', { className: 'gho-dot on' })
      if (props.configured) return h('span', { className: 'gho-dot off' })
      return h('span', { className: 'gho-dot' })
    }

    function CredentialsCard (props) {
      var isDefault = props.authSource === 'default'
      var editingHook = React.useState(false)
      var editing = editingHook[0]
      var setEditing = editingHook[1]
      var idHook = React.useState('')
      var idValue = idHook[0]
      var setId = idHook[1]
      var secretHook = React.useState('')
      var secretValue = secretHook[0]
      var setSecret = secretHook[1]
      var busyHook = React.useState(false)
      var busy = busyHook[0]
      var setBusy = busyHook[1]
      var errorHook = React.useState('')
      var error = errorHook[0]
      var setError = errorHook[1]

      function submit (event) {
        event.preventDefault()
        if (idValue.trim() === '' || secretValue.trim() === '') {
          setError('Client ID 和 Client Secret 都要填。')
          return
        }
        setBusy(true)
        setError('')
        props.onSave(idValue.trim(), secretValue.trim())
          .then(function () {
            setId('')
            setSecret('')
            setEditing(false)
          })
          .catch(function (err) { setError(formatError(err)) })
          .then(function () { setBusy(false) })
      }

      function useDefaultNow () {
        setBusy(true)
        setError('')
        props.onUseDefault()
          .catch(function (err) { setError(formatError(err)) })
          .then(function () { setBusy(false) })
      }

      function useSavedCustom () {
        setBusy(true)
        setError('')
        props.onUseSavedCustom()
          .catch(function (err) { setError(formatError(err)) })
          .then(function () { setBusy(false) })
      }

      return h('div', { className: 'gho-card' },
        h('div', { className: 'gho-row' },
          h('div', { className: 'gho-label' }, 'OAuth App'),
          h('span', { className: 'gho-pill' + (isDefault ? ' on' : '') },
            isDefault ? '内置默认（推荐）' : '自定义')),
        h('div', { className: 'gho-muted' },
          isDefault
            ? '正在使用插件内置的默认 OAuth App（client_id ' + (props.masked || '…') +
              '），无需在 GitHub 上创建应用即可登录。令牌仍由你的 GitHub 账号在授权页明确批准。'
            : '正在使用自定义 OAuth App（client_id ' + (props.masked || '…') + '）。'),
        isDefault
          ? null
          : h('div', { className: 'gho-muted' },
              '自定义应用的 Authorization callback URL 必须填 ',
              h('span', { className: 'gho-code' }, window.location.origin + BASE + '/callback'),
              '。'),
        h('div', { className: 'gho-muted' },
          'Client Secret 与访问令牌都用 AES-256-GCM 加密后写入本机 vault，磁盘上不会出现明文。'),
        h('div', { className: 'gho-row' },
          isDefault
            ? h('button', {
                className: 'gho-btn',
                type: 'button',
                onClick: function () { setEditing(true) }
              }, '使用自定义 OAuth App')
            : h('button', {
                className: 'gho-btn primary',
                type: 'button',
                disabled: busy,
                onClick: useDefaultNow
              }, busy ? '切换中…' : '改用内置默认（推荐）'),
          !isDefault
            ? h('button', {
                className: 'gho-btn',
                type: 'button',
                onClick: function () { setEditing(!editing) }
              }, editing ? '取消编辑' : '更换自定义凭据')
            : null,
          isDefault && props.hasCustomApp
            ? h('button', {
                className: 'gho-btn',
                type: 'button',
                disabled: busy,
                onClick: useSavedCustom
              }, '切回已保存的自定义应用（' + (props.customMasked || '') + '）')
            : null),
        editing
          ? h('form', { className: 'gho-stack', onSubmit: submit },
              h('input', {
                className: 'gho-input',
                'aria-label': 'OAuth App Client ID',
                placeholder: 'Client ID（Ov23li…）',
                autoComplete: 'off',
                spellCheck: false,
                value: idValue,
                onChange: function (event) { setId(event.target.value) }
              }),
              h('input', {
                className: 'gho-input',
                'aria-label': 'OAuth App Client Secret',
                placeholder: 'Client Secret',
                type: 'password',
                autoComplete: 'off',
                value: secretValue,
                onChange: function (event) { setSecret(event.target.value) }
              }),
              h('div', { className: 'gho-row' },
                h('button', { className: 'gho-btn primary', type: 'submit', disabled: busy },
                  busy ? '加密保存中…' : '加密保存并启用'),
                h('button', {
                  className: 'gho-btn',
                  type: 'button',
                  onClick: function () {
                    setEditing(false)
                    setId('')
                    setSecret('')
                    setError('')
                  }
                }, '取消')))
          : null,
        error ? h('div', { className: 'gho-error', role: 'alert' }, error) : null
      )
    }

    function AccountCard (props) {
      var status = props.status || {}
      var connected = status.connected === true
      var account = status.account || null
      var scopes = Array.isArray(status.scopes) ? status.scopes : []
      return h('div', { className: 'gho-card' },
        h('div', { className: 'gho-row' },
          h('div', { className: 'gho-label' }, 'GitHub 账号'),
          h('span', { className: 'gho-pill' + (connected ? ' on' : '') }, connected ? '已连接' : '未连接')),
        connected
          ? h('div', { className: 'gho-account' },
              h(Avatar, { src: account ? account.avatarUrl : '' }),
              h('div', null,
                h('div', { className: 'gho-login' }, '@' + (account ? account.login : 'unknown')),
                h('div', { className: 'gho-muted' }, scopes.length > 0 ? scopes.join(', ') : '未报告授权范围')))
          : h('div', { className: 'gho-muted' },
              status.configured
                ? '尚未登录。点“使用 GitHub 登录”会打开新标签页，授权完成后本页会自动刷新。'
                : '先在上方填写 OAuth App 的 Client ID 与 Client Secret。'),
        h('div', { className: 'gho-row' },
          status.configured && !connected
            ? h('button', { className: 'gho-btn primary', type: 'button', onClick: props.onLogin }, '使用 GitHub 登录')
            : null,
          connected
            ? h('button', { className: 'gho-btn', type: 'button', onClick: props.onSwitchAccount }, '更换账号')
            : null,
          connected
            ? h('button', { className: 'gho-btn', type: 'button', onClick: props.onLogout, disabled: props.busy }, '断开连接')
            : null),
        connected && status.tokenExpiresAt
          ? h('div', { className: 'gho-muted' },
              '令牌到期：' + status.tokenExpiresAt + (status.canRefresh ? '（到期前自动续期）' : '（到期后需重新授权）'))
          : null
      )
    }

    function AccountsCard (props) {
      var accounts = Array.isArray(props.accounts) ? props.accounts : []
      if (accounts.length === 0) return null
      return h('div', { className: 'gho-card' },
        h('div', { className: 'gho-row' },
          h('div', { className: 'gho-label' }, '已保存的 GitHub 账户'),
          h('span', { className: 'gho-pill' }, String(accounts.length))),
        h('div', { className: 'gho-list' }, accounts.map(function (entry) {
          var scopes = Array.isArray(entry.scopes) ? entry.scopes : []
          return h('div', { key: entry.login, className: 'gho-row', style: { justifyContent: 'space-between' } },
            h('div', { className: 'gho-account' },
              h('img', {
                className: 'gho-cm-avatar',
                src: entry.avatarUrl,
                alt: '',
                width: 16,
                height: 16,
                style: AVATAR_SMALL_STYLE,
                referrerPolicy: 'no-referrer'
              }),
              h('div', null,
                h('div', { className: 'gho-login' }, '@' + entry.login,
                  entry.active ? h('span', { className: 'gho-pill on', style: { marginLeft: 6 } }, '当前') : null),
                h('div', { className: 'gho-muted' },
                  (entry.name ? entry.name + ' · ' : '') + (scopes.length > 0 ? scopes.join(', ') : '未报告授权范围')))),
            h('div', { className: 'gho-row' },
              entry.active ? null : h('button', {
                className: 'gho-btn',
                type: 'button',
                disabled: props.busy,
                onClick: function () { props.onSwitch(entry.login) }
              }, '切换'),
              h('button', {
                className: 'gho-btn',
                type: 'button',
                disabled: props.busy,
                onClick: function () { props.onRemove(entry.login) }
              }, '移除')))
        }))
      )
    }

    function Switch (props) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': props.checked ? 'true' : 'false',
        'aria-label': props.label,
        title: props.label,
        className: 'gho-switch' + (props.checked ? ' on' : ''),
        onClick: function () { props.onChange(!props.checked) }
      })
    }

    function ComposerControls () {
      var modeHook = React.useState(composerMode())
      var mode = modeHook[0]
      var setModeState = modeHook[1]
      var shadowHook = React.useState(composerShadow())
      var shadow = shadowHook[0]
      var setShadowState = shadowHook[1]
      return h('div', { className: 'gho-card' },
        h('div', { className: 'gho-label' }, '输入框 GitHub 按钮'),
        h('div', { className: 'gho-setting' },
          h('div', { className: 'gho-setting-text' },
            h('div', { className: 'gho-setting-title' }, '显示用户名'),
            h('div', { className: 'gho-muted' }, '关闭时按钮只显示头像，点击后再展开账户列表。')),
          h(Switch, {
            label: '显示用户名',
            checked: mode === 'label',
            onChange: function (next) {
              var value = next ? 'label' : 'avatar'
              setComposerMode(value)
              setModeState(value)
            }
          })),
        h('div', { className: 'gho-setting' },
          h('div', { className: 'gho-setting-text' },
            h('div', { className: 'gho-setting-title' }, '按钮阴影'),
            h('div', { className: 'gho-muted' }, '给按钮加一层淡淡的投影。')),
          h(Switch, {
            label: '按钮阴影',
            checked: shadow,
            onChange: function (next) {
              setComposerShadow(next)
              setShadowState(next)
            }
          })))
    }

    function RepoEditor (props) {
      var prefs = props.prefs || { defaultRepo: '', pinnedRepos: [] }
      var datalistId = React.useMemo(function () {
        return 'gho-repo-options-' + Math.random().toString(36).slice(2, 9)
      }, [])
      var defaultHook = React.useState(prefs.defaultRepo || '')
      var defaultRepo = defaultHook[0]
      var setDefaultRepo = defaultHook[1]
      var pinnedHook = React.useState('')
      var pinnedInput = pinnedHook[0]
      var setPinnedInput = pinnedHook[1]
      var busyHook = React.useState(false)
      var busy = busyHook[0]
      var setBusy = busyHook[1]
      var errorHook = React.useState('')
      var error = errorHook[0]
      var setError = errorHook[1]
      var noteHook = React.useState('')
      var note = noteHook[0]
      var setNote = noteHook[1]

      React.useEffect(function () {
        setDefaultRepo(prefs.defaultRepo || '')
      }, [prefs.defaultRepo])

      function changeDefault (value) {
        setNote('')
        setBusy(true)
        setError('')
        props.onSave({ defaultRepo: value })
          .then(function () { setNote(value === '' ? '已清除默认仓库。' : '默认仓库已保存。') })
          .catch(function (err) { setError(formatError(err)) })
          .then(function () { setBusy(false) })
      }

      function addPinned () {
        var value = pinnedInput.trim()
        if (value === '') return
        var next = (prefs.pinnedRepos || []).concat([value])
        setBusy(true)
        setError('')
        props.onSave({ pinnedRepos: next })
          .then(function () {
            setPinnedInput('')
            setNote('已固定 ' + value + '。')
          })
          .catch(function (err) { setError(formatError(err)) })
          .then(function () { setBusy(false) })
      }

      function removePinned (name) {
        setBusy(true)
        setError('')
        props.onSave({ pinnedRepos: (prefs.pinnedRepos || []).filter(function (item) { return item !== name }) })
          .then(function () { setNote('已移除 ' + name + '。') })
          .catch(function (err) { setError(formatError(err)) })
          .then(function () { setBusy(false) })
      }

      return h('div', { className: 'gho-card' },
        h('div', { className: 'gho-label' }, '默认仓库'),
        h('div', { className: 'gho-muted' },
          'github_repo / github_issues / github_pulls / github_file / github_create_issue 省略 repo 参数时使用它。'),
        h('div', { className: 'gho-row' },
          h('input', {
            className: 'gho-input narrow',
            'aria-label': '固定仓库 owner/name',
            list: datalistId,
            placeholder: 'owner/name',
            autoComplete: 'off',
            spellCheck: false,
            value: defaultRepo,
            onChange: function (event) { setDefaultRepo(event.target.value) }
          }),
          h('button', {
            className: 'gho-btn primary',
            type: 'button',
            disabled: busy || defaultRepo.trim() === (prefs.defaultRepo || ''),
            onClick: function () { changeDefault(defaultRepo.trim()) }
          }, '保存'),
          prefs.defaultRepo
            ? h('button', {
                className: 'gho-btn',
                type: 'button',
                disabled: busy,
                onClick: function () { setDefaultRepo(''); changeDefault('') }
              }, '清除')
            : null),
        h('datalist', { id: datalistId },
          (props.repos || []).map(function (repo) {
            return h('option', { key: repo.fullName, value: repo.fullName })
          })),
        h('div', { className: 'gho-sep' }),
        h('div', { className: 'gho-label' }, '固定仓库'),
        h('div', { className: 'gho-muted' }, '只影响设置页与侧边栏的展示顺序，方便在多个项目间切换。'),
        (prefs.pinnedRepos || []).length === 0
          ? h('div', { className: 'gho-muted' }, '还没有固定仓库。')
          : h('div', { className: 'gho-row' },
              (prefs.pinnedRepos || []).map(function (name) {
                return h('span', { className: 'gho-chip', key: name },
                  name,
                  h('button', {
                    type: 'button',
                    title: '移除',
                    'aria-label': '移除 ' + name,
                    disabled: props.busy === true,
                    onClick: function () { removePinned(name) }
                  }, '×'))
              })),
        h('div', { className: 'gho-row' },
          h('input', {
            className: 'gho-input narrow',
            'aria-label': '固定仓库 owner/name',
            list: datalistId,
            placeholder: 'owner/name',
            autoComplete: 'off',
            spellCheck: false,
            value: pinnedInput,
            onChange: function (event) { setPinnedInput(event.target.value) }
          }),
          h('button', { className: 'gho-btn', type: 'button', disabled: busy || pinnedInput.trim() === '', onClick: addPinned }, '添加固定仓库')),
        error ? h('div', { className: 'gho-error', role: 'alert' }, error) : null,
        note ? h('div', { className: 'gho-ok', 'aria-live': 'polite' }, note) : null
      )
    }

    /** Project attribution shown in both the settings page and the sidebar panel. */
    function LicenseNote (props) {
      return h('div', { className: 'gho-license' },
        h('span', null, '基于 MIT 许可证开源'),
        h('span', { className: 'gho-license-sep', 'aria-hidden': 'true' }, '·'),
        h('a', {
          className: 'gho-license-link',
          href: PROJECT_URL,
          target: '_blank',
          rel: 'noreferrer noopener'
        }, 'github.com/MFCJ45681/github-oauth-plugin'),
        props && props.detail === false
          ? null
          : h('span', null, '可自由使用、修改与分发；OAuth 凭据与 token 只加密保存在本机。')
      )
    }

    function SettingsSection (props) {
      var gh = useGitHub()
      var status = gh.status
      var configured = status ? status.configured : false

      return h('div', { className: 'gho-settings' },
        h('div', { className: 'gho-head' },
          h('div', { className: 'gho-title' }, h(Dot, {
            configured: configured,
            connected: status ? status.connected : false
          }), 'GitHub'),
          h('button', { className: 'gho-btn', type: 'button', onClick: gh.refresh, disabled: gh.busy }, gh.busy ? '刷新中…' : '刷新')),
        h('div', { className: 'gho-muted' },
          '这里的改动立即生效：更换 OAuth App、切换 GitHub 账号、设置默认仓库与固定仓库。'),
        gh.error ? h('div', { className: 'gho-error', role: 'alert' }, gh.error) : null,
        !status && gh.busy ? h('div', { className: 'gho-muted' }, '读取连接状态…') : null,

        h(CredentialsCard, {
          hasCredentials: configured,
          masked: status ? status.clientIdMasked : '',
          authSource: status ? status.authSource : 'default',
          hasCustomApp: status ? status.hasCustomApp === true : false,
          customMasked: status ? status.customClientIdMasked : '',
          onSave: gh.saveConfig,
          onUseDefault: gh.useDefaultApp,
          onUseSavedCustom: function () { return gh.saveConfig('', '') }
        }),

        h(AccountsCard, {
          accounts: status && Array.isArray(status.accounts) ? status.accounts : [],
          busy: gh.busy,
          onSwitch: gh.switchTo,
          onRemove: gh.removeAccount
        }),

        h(ComposerControls, {}),

        h(AccountCard, {
          status: status,
          busy: gh.busy,
          onLogin: gh.login,
          onLogout: gh.logout,
          onSwitchAccount: gh.switchAccount
        }),

        h(RepoEditor, {
          prefs: gh.prefs,
          repos: gh.repos,
          onSave: gh.savePrefs
        }),

        status
          ? h('div', { className: 'gho-muted' },
              '加密：AES-256-GCM · 密钥来源 ' + ((status.vault || {}).keySource || 'file') + ' · 凭据库 ',
              h('span', { className: 'gho-code' }, (status.vault || {}).path || ''))
          : null,

        h(LicenseNote, {})
      )
    }

    function RepoList (props) {
      if (props.loading) return h('div', { className: 'gho-muted' }, '加载仓库中…')
      if (props.repos.length === 0) return h('div', { className: 'gho-muted' }, '没有可显示的仓库（授权范围可能不含 repo）。')
      return h('div', { className: 'gho-list' },
        props.repos.map(function (repo) {
          return h('a', {
            key: repo.fullName,
            className: 'gho-repo',
            href: repo.htmlUrl,
            target: '_blank',
            rel: 'noreferrer noopener'
          },
          h('div', { className: 'gho-repo-name' },
            repo.private ? h('span', { className: 'gho-pill' }, 'private') : null,
            repo.fullName),
          repo.description ? h('div', { className: 'gho-muted' }, repo.description) : null,
          h('div', { className: 'gho-repo-meta' },
            h('span', null, '★ ' + repo.stars),
            repo.language ? h('span', null, repo.language) : null,
            repo.updatedAt ? h('span', null, repo.updatedAt.slice(0, 10)) : null))
        }))
    }

    function Panel () {
      var gh = useGitHub()
      var status = gh.status
      var configured = status ? status.configured : false
      var connected = status ? status.connected : false
      var prefs = gh.prefs || { defaultRepo: '', pinnedRepos: [] }
      var pinned = prefs.pinnedRepos || []
      var ordered = pinned.length === 0
        ? gh.repos.slice(0, 10)
        : pinned.map(function (name) {
            for (var index = 0; index < gh.repos.length; index += 1) {
              if (gh.repos[index].fullName === name) return gh.repos[index]
            }
            return { fullName: name, htmlUrl: 'https://github.com/' + name, stars: 0, language: '', updatedAt: '', description: '' }
          })

      return h('div', { className: 'gho-panel' },
        h('div', { className: 'gho-head' },
          h('div', { className: 'gho-title' }, h(Dot, { configured: configured, connected: connected }), 'GitHub'),
          h('button', { className: 'gho-btn', type: 'button', onClick: gh.refresh, disabled: gh.busy }, gh.busy ? '…' : '刷新')),

        gh.error ? h('div', { className: 'gho-error', role: 'alert' }, gh.error) : null,

        !status && gh.busy ? h('div', { className: 'gho-muted' }, '读取连接状态…') : null,

        !configured && status
          ? h(CredentialsCard, {
              hasCredentials: false,
              masked: '',
              authSource: status ? status.authSource : 'default',
              hasCustomApp: status ? status.hasCustomApp === true : false,
              customMasked: status ? status.customClientIdMasked : '',
              onSave: gh.saveConfig,
              onUseDefault: gh.useDefaultApp,
              onUseSavedCustom: function () { return gh.saveConfig('', '') }
            })
          : null,

        configured
          ? h(AccountCard, {
              status: status,
              busy: gh.busy,
              onLogin: gh.login,
              onLogout: gh.logout,
              onSwitchAccount: gh.switchAccount
            })
          : null,

        connected
          ? h('div', { className: 'gho-card' },
              h('div', { className: 'gho-label' }, '默认仓库'),
              h('div', { className: 'gho-muted' }, prefs.defaultRepo || '未设置 — 可在 设置 → GitHub 里选择'),
              h('div', { className: 'gho-sep' }),
              h('div', { className: 'gho-label' }, pinned.length === 0 ? '最近推送' : '固定仓库'),
              h(RepoList, { repos: ordered, loading: gh.reposLoading }),
              h('div', { className: 'gho-muted' }, '凭据、账号与仓库的完整管理在 设置 → GitHub。'))
          : null,

        status
          ? h('div', { className: 'gho-muted' },
              'AES-256-GCM · 密钥来源 ' + ((status.vault || {}).keySource || 'file') + ' · agent 工具前缀 github_')
          : null,

        h(LicenseNote, { detail: false })
      )
    }

    var COMPOSER_KEY = 'dsh-github-oauth:composer-mode'
    var COMPOSER_EVENT = 'dsh-github-oauth-composer'

    function composerMode () {
      try {
        return window.localStorage.getItem(COMPOSER_KEY) === 'label' ? 'label' : 'avatar'
      } catch (error) {
        return 'avatar'
      }
    }

    function setComposerMode (value) {
      try {
        window.localStorage.setItem(COMPOSER_KEY, value === 'label' ? 'label' : 'avatar')
      } catch (error) {}
      try {
        window.dispatchEvent(new window.CustomEvent(COMPOSER_EVENT))
      } catch (error) {}
    }

    var SHADOW_KEY = 'dsh-github-oauth:composer-shadow'

    function composerShadow () {
      try {
        return window.localStorage.getItem(SHADOW_KEY) !== 'off'
      } catch (error) {
        return true
      }
    }

    function setComposerShadow (value) {
      try {
        window.localStorage.setItem(SHADOW_KEY, value ? 'on' : 'off')
      } catch (error) {}
      try {
        window.dispatchEvent(new window.CustomEvent(COMPOSER_EVENT))
      } catch (error) {}
    }

    /**
     * Tell every surface (composer menu, sidebar panel, settings) that the
     * account list changed. The payload is optional: listeners that receive it
     * can adopt the new state instead of issuing another /bootstrap.
     * @param {object|null} [payload]
     */
    function notifyAccountsChanged (payload) {
      bootstrapCache = null
      try {
        window.dispatchEvent(new window.CustomEvent(ACCOUNTS_EVENT, { detail: payload || null }))
      } catch (error) {}
    }

    /**
     * Composer tool-row control next to the permission picker: the active GitHub
     * account, a one-click switcher for every stored account and a shortcut to
     * connect another one through the same OAuth callback.
     */
    function AccountMenu () {
      var accountsHook = React.useState({ accounts: [], activeLogin: '' })
      var data = accountsHook[0]
      var setData = accountsHook[1]
      var openHook = React.useState(false)
      var open = openHook[0]
      var setOpen = openHook[1]
      var busyHook = React.useState(false)
      var busy = busyHook[0]
      var setBusy = busyHook[1]
      var waitingHook = React.useState(false)
      var waiting = waitingHook[0]
      var setWaiting = waitingHook[1]
      var errorHook = React.useState('')
      var error = errorHook[0]
      var setError = errorHook[1]
      var modeHook = React.useState(composerMode())
      var mode = modeHook[0]
      var setMode = modeHook[1]
      var shadowHook = React.useState(composerShadow())
      var shadow = shadowHook[0]
      var setShadow = shadowHook[1]
      var alive = React.useRef(true)
      var poll = React.useRef(null)
      var waitingRef = React.useRef(false)
      var openRef = React.useRef(false)

      function remember (payload) {
        if (!alive.current) return
        setData({
          accounts: payload && Array.isArray(payload.accounts) ? payload.accounts : [],
          activeLogin: payload && typeof payload.activeLogin === 'string' ? payload.activeLogin : ''
        })
      }

      /** Older hosts only expose /status: show the active account instead of a 404 banner. */
      function accountsFromStatus (payload) {
        var status = payload && payload.status ? payload.status : {}
        var account = status.account ? status.account : null
        var accounts = []
        if (account && account.login) {
          accounts.push({
            login: account.login,
            name: account.name || '',
            avatarUrl: account.avatarUrl || '',
            scopes: Array.isArray(status.scopes) ? status.scopes : [],
            active: true
          })
        }
        return { accounts: accounts, activeLogin: account && account.login ? account.login : '' }
      }

      var load = React.useCallback(function () {
        return request('/accounts')
          .then(function (payload) {
            remember(payload)
            if (alive.current) setError('')
            return payload
          })
          .catch(function (err) {
            if (err && err.status === 404) {
              return request('/status')
                .then(function (payload) {
                  remember(accountsFromStatus(payload))
                  if (alive.current) setError('')
                  return null
                })
                .catch(function (inner) {
                  if (alive.current) setError(formatError(inner))
                  return null
                })
            }
            if (alive.current) setError(formatError(err))
            return null
          })
      }, [])

      function stopPolling () {
        if (poll.current !== null) {
          clearInterval(poll.current)
          poll.current = null
        }
        waitingRef.current = false
        if (alive.current) setWaiting(false)
      }

      React.useEffect(function () {
        alive.current = true
        load()
        function onFocus () {
          // Do not hit the network on every alt-tab: only a pending
          // authorization or an open menu can be stale.
          if (waitingRef.current || openRef.current) load()
        }
        function onAccountsChanged (event) {
          var detail = event && event.detail ? event.detail : null
          if (detail && Array.isArray(detail.accounts)) {
            remember({ accounts: detail.accounts, activeLogin: detail.activeLogin })
            return
          }
          load()
        }
        function onComposerMode () {
          if (!alive.current) return
          setMode(composerMode())
          setShadow(composerShadow())
        }
        window.addEventListener('focus', onFocus)
        window.addEventListener(ACCOUNTS_EVENT, onAccountsChanged)
        window.addEventListener(COMPOSER_EVENT, onComposerMode)
        return function () {
          alive.current = false
          window.removeEventListener('focus', onFocus)
          window.removeEventListener(ACCOUNTS_EVENT, onAccountsChanged)
          window.removeEventListener('COMPOSER_EVENT', onComposerMode)
          if (poll.current !== null) clearInterval(poll.current)
        }
      }, [load])

      /** Poll /accounts while an authorization popup is open; any change ends it. */
      function startWaiting () {
        var baselineCount = data.accounts.length
        var baselineActive = data.activeLogin
        stopPolling()
        waitingRef.current = true
        setWaiting(true)
        var started = Date.now()
        poll.current = setInterval(function () {
          if (Date.now() - started > 3 * 60 * 1000) {
            stopPolling()
            return
          }
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          request('/accounts').then(function (payload) {
            var next = payload && Array.isArray(payload.accounts) ? payload.accounts : []
            var nextActive = payload && typeof payload.activeLogin === 'string' ? payload.activeLogin : ''
            if (next.length !== baselineCount || nextActive !== baselineActive) {
              stopPolling()
              remember(payload)
              if (alive.current) setError('')
              notifyAccountsChanged(payload || null)
            }
          }).catch(function (err) {
            stopPolling()
            if (alive.current) setError(formatError(err))
          })
        }, 1500)
      }

      function addAccount () {
        var popup = null
        try { popup = window.open('', '_blank') } catch (error) { popup = null }
        if (!popup) {
          setError('浏览器拦截了授权弹窗：请允许本站弹窗后重试。')
          return
        }
        setError('')
        // A blank popup must be opened inside the click; navigate it once we
        // know an OAuth App is configured, so a 409 never leaves a raw JSON tab.
        request('/status').then(function (payload) {
          var configured = payload && payload.status ? payload.status.configured !== false : false
          if (!configured) {
            try { popup.close() } catch (error) {}
            if (alive.current) setError('还没有配置 GitHub OAuth App：先填写 Client ID / Secret，或使用内置默认应用。')
            return
          }
          try { popup.location.href = BASE + '/start' } catch (error) {
            if (alive.current) setError('授权页打开失败，请重试。')
            return
          }
          try { popup.opener = null } catch (error) {}
          startWaiting()
        }).catch(function (err) {
          try { popup.close() } catch (error) {}
          if (alive.current) setError(formatError(err))
        })
      }

      function switchTo (login) {
        if (typeof login !== 'string' || login === '') return
        setBusy(true)
        setError('')
        request('/accounts/switch', { method: 'POST', body: { login: login } })
          .then(function (payload) {
            if (payload && payload.status) {
              remember(payload.status)
              notifyAccountsChanged()
            }
          })
          .catch(function (err) { if (alive.current) setError(formatError(err)) })
          .then(function () { if (alive.current) setBusy(false) })
      }

      function onSelect (id) {
        setOpen(false)
        openRef.current = false
        if (id === 'cancel-add') { stopPolling(); return }
        if (id === 'add') return addAccount()
        if (typeof id === 'string' && id.indexOf('account:') === 0) switchTo(id.slice(8))
      }

      var list = data.accounts
      var active = null
      list.forEach(function (entry) { if (entry.active) active = entry })
      var items = list.map(function (entry) {
        var label = h('span', { className: 'gho-cm-item' }, [
          h('span', { className: 'gho-cm-login' }, entry.login),
          entry.active ? h('span', { className: 'gho-pill on' }, '当前') : null,
          entry.name ? h('span', { className: 'gho-cm-name' }, entry.name) : null
        ])
        return {
          id: 'account:' + entry.login,
          icon: h('img', {
            className: 'gho-cm-avatar',
            src: entry.avatarUrl,
            alt: '',
            width: 16,
            height: 16,
            style: AVATAR_SMALL_STYLE,
            referrerPolicy: 'no-referrer'
          }),
          label: label,
          disabled: busy
        }
      })
      if (items.length > 0) items.push({ type: 'separator', id: 'accounts-separator' })
      items.push({
        id: 'add',
        icon: h('span', { className: 'gho-cm-plus', 'aria-hidden': 'true' }, '+'),
        label: list.length === 0 ? '登录 GitHub…' : '添加其他账户…',
        disabled: waiting
      })
      if (waiting) {
        items.push({
          id: 'cancel-add',
          label: '取消等待授权',
          disabled: false
        })
      }

      var compact = mode === 'avatar'
      var face = active && active.avatarUrl
        ? h('img', {
            className: 'gho-cm-avatar',
            src: active.avatarUrl,
            alt: '',
            width: 16,
            height: 16,
            style: AVATAR_SMALL_STYLE,
            referrerPolicy: 'no-referrer'
          })
        : h('span', { className: 'gho-cm-mark', 'aria-hidden': 'true' }, 'GH')
      var children = compact
        ? [face]
        : [
            face,
            h('span', { className: 'gho-cm-label' }, active ? active.login : (waiting ? '等待授权…' : '连接 GitHub')),
            h('span', { className: 'gho-cm-chevron', 'aria-hidden': 'true' },
              primitives.IconChevronDownOutlineRegular ? h(primitives.IconChevronDownOutlineRegular, {}) : null)
          ]
      var anchor = h('button', {
        type: 'button',
        className: 'gho-cm-trigger' + (compact ? ' compact' : '') + (shadow ? '' : ' flat'),
        title: active ? ('GitHub 账户：' + active.login) : '连接 GitHub 账户',
        'aria-label': active ? ('GitHub 账户 ' + active.login) : '连接 GitHub 账户',
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: function () {
          openRef.current = !open
          setOpen(!open)
          if (!open) load()
        }
      }, children)

      return h('span', { className: 'gho-cm' }, [
        h(primitives.Menu, {
          open: open,
          items: items,
          selectedId: data.activeLogin !== '' ? 'account:' + data.activeLogin : undefined,
          onSelect: onSelect,
          onClose: function () { setOpen(false) },
          side: 'top',
          portal: true,
          anchor: anchor
        }),
        waiting ? h('span', { className: 'gho-cm-status', 'aria-live': 'polite' }, '登录完成后自动刷新') : null,
        error ? h('span', { className: 'gho-cm-status', role: 'alert', title: error }, '· ' + error) : null
      ])
    }

    function apply (ctx) {
      ensureStyle()
      ctx.effect(function () {
        return ctx.sidebarRightTabs.register({
          id: '@local/github-oauth',
          kind: 'github-oauth',
          priority: 'extension',
          title: function () { return 'GitHub' },
          guide: [{
            id: 'github-oauth',
            order: 40,
            title: function () { return 'GitHub' },
            description: function () { return 'GitHub 授权状态、账号与仓库' }
          }]
        })
      }, 'github-oauth: sidebar tab')

      ctx.effect(function () {
        // The body slot is declared by the right-bar entry that is mounted for
        // the session: inject so the body returns after the sidebar is
        // closed/reopened, and so a missing declaration cannot break apply().
        return ctx.slots.inject('sidebar.right.pane.tab', function () {
          return ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: '@local/github-oauth'
          }, Panel)
        })
      }, 'github-oauth: sidebar pane')

      ctx.effect(function () {
        return ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: 'github-oauth',
            order: 60,
            label: function () { return 'GitHub' }
          }, SettingsSection)
        })
      }, 'github-oauth: settings section')

      ctx.effect(function () {
        return ctx.slots.inject('conversation.input.left', function () {
          return ctx.slots.register({
            name: 'conversation.input.left',
            id: 'github-accounts',
            order: 40
          }, AccountMenu)
        })
      }, 'github-oauth: composer account menu')
    }

    var module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = ['slots', 'sidebarRightTabs']
    return module.exports
  }
})
