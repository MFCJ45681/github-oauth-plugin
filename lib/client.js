window.__ModuleLoader__.load({
  id: '@local/github-oauth',
  factory: function (require) {
    'use strict'

    var React = require('react')
    var h = React.createElement

    var BASE = '/plugins/github-oauth'
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
      '.gho-sep{height:1px;background:var(--dsw-alias-border-l1,rgba(31,35,40,.1));margin:2px 0}'
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
            throw new Error(message + hint)
          }
          return payload
        })
      })
    }

    function formatError (error) {
      if (!error) return ''
      if (error.name === 'TypeError' && /fetch|network/i.test(error.message)) {
        return '无法连接插件后端（' + BASE + ' 路由未注册？）。确认 @local/github-oauth 已安装并重启了 dsh。'
      }
      return error.message || String(error)
    }

    function Avatar (props) {
      if (!props.src) {
        return h('div', { className: 'gho-avatar', 'aria-hidden': 'true' })
      }
      return h('img', { className: 'gho-avatar', src: props.src, alt: '', referrerPolicy: 'no-referrer' })
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

      var load = React.useCallback(function (options) {
        var silent = options && options.silent === true
        var warm = bootstrapCache !== null && Date.now() - bootstrapCache.at < BOOTSTRAP_TTL_MS
        if (!silent) setBusy(true)
        var pending = warm ? Promise.resolve(bootstrapCache.payload) : request('/bootstrap')
        return pending
          .then(function (payload) {
            if (!warm) bootstrapCache = { at: Date.now(), payload: payload }
            var next = payload && payload.status ? payload.status : null
            setStatus(next)
            setPrefs(payload && payload.preferences ? payload.preferences : null)
            if (payload && Array.isArray(payload.repos)) setRepos(payload.repos)
            setError('')
            return next
          })
          .catch(function (err) {
            setError(formatError(err))
            return null
          })
          .then(function (next) {
            if (!silent) setBusy(false)
            return next
          })
      }, [])

      var loadRepos = React.useCallback(function () {
        setReposLoading(true)
        return request('/repos?limit=100')
          .then(function (payload) {
            setRepos(payload && Array.isArray(payload.repos) ? payload.repos : [])
          })
          .catch(function (err) {
            setRepos([])
            var message = formatError(err)
            if (message.indexOf('E_NOT_CONNECTED') < 0 && message.indexOf('not connected') < 0) setError(message)
          })
          .then(function () { setReposLoading(false) })
      }, [])

      React.useEffect(function () {
        ensureStyle()
        load()
      }, [load])

      var connected = status ? status.connected : false
      React.useEffect(function () {
        if (!connected || repos.length > 0) return undefined
        loadRepos()
        return undefined
      }, [connected, repos.length, loadRepos])

      React.useEffect(function () {
        if (!status || !status.configured || status.connected) return undefined
        var started = Date.now()
        var stopped = false
        var timer = null
        function poll () {
          if (stopped) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          request('/status')
            .then(function (payload) {
              if (payload && payload.status && payload.status.connected) {
                stopped = true
                if (timer !== null) clearInterval(timer)
                bootstrapCache = null
                setStatus(payload.status)
              }
            })
            .catch(function () {})
        }
        timer = setInterval(function () {
          if (Date.now() - started > 5 * 60 * 1000) {
            stopped = true
            clearInterval(timer)
            return
          }
          poll()
        }, 2000)
        return function () {
          stopped = true
          if (timer !== null) clearInterval(timer)
        }
      }, [status && status.configured, status && status.connected])

      function login () {
        var url = BASE + '/start'
        var opened = null
        try { opened = window.open(url, '_blank') } catch (error) { opened = null }
        if (opened) {
          try { opened.opener = null } catch (error) {}
          return
        }
        window.location.assign(url)
      }

      function logout () {
        bootstrapCache = null
        setBusy(true)
        return request('/logout', { method: 'POST' })
          .then(function (payload) {
            setStatus(payload && payload.status ? payload.status : null)
            setRepos([])
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
        return logout().then(function (payload) {
          if (payload) login()
        })
      }

      function applyConfig (body) {
        bootstrapCache = null
        setError('')
        return request('/config', { method: 'POST', body: body })
          .then(function (payload) {
            if (payload && payload.status) setStatus(payload.status)
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
                placeholder: 'Client ID（Ov23li…）',
                autoComplete: 'off',
                spellCheck: false,
                value: idValue,
                onChange: function (event) { setId(event.target.value) }
              }),
              h('input', {
                className: 'gho-input',
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
        error ? h('div', { className: 'gho-error' }, error) : null
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
                    onClick: function () { removePinned(name) }
                  }, '×'))
              })),
        h('div', { className: 'gho-row' },
          h('input', {
            className: 'gho-input narrow',
            list: datalistId,
            placeholder: 'owner/name',
            autoComplete: 'off',
            spellCheck: false,
            value: pinnedInput,
            onChange: function (event) { setPinnedInput(event.target.value) }
          }),
          h('button', { className: 'gho-btn', type: 'button', disabled: busy || pinnedInput.trim() === '', onClick: addPinned }, '添加固定仓库')),
        error ? h('div', { className: 'gho-error' }, error) : null,
        note ? h('div', { className: 'gho-ok' }, note) : null
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
        gh.error ? h('div', { className: 'gho-error' }, gh.error) : null,
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
              '加密：AES-256-GCM · 密钥来源 ' + status.vault.keySource + ' · 凭据库 ',
              h('span', { className: 'gho-code' }, status.vault.path))
          : null
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

        gh.error ? h('div', { className: 'gho-error' }, gh.error) : null,

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
              'AES-256-GCM · 密钥来源 ' + status.vault.keySource + ' · agent 工具前缀 github_')
          : null
      )
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
        return ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: '@local/github-oauth'
        }, Panel)
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
    }

    var module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = ['slots', 'sidebarRightTabs']
    return module.exports
  }
})
